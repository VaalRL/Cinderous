// 收檔另存（ADR-0093）：收到 P2P 檔案位元組後，讓使用者選擇儲存位置。
// App **不保管檔案本體**——位元組交給 OS 檔案系統，只把使用者選定的路徑回填顯示。
//
// - Tauri 桌面：位元組逐塊寫進暫存區，再由原生「另存新檔」對話框選位置並**移動**過去
//   （ADR-0349／0362），回傳選定路徑。
// - 瀏覽器/web preview：無任意檔案系統存取，退回瀏覽器下載（最終路徑不可知），回傳可再下載的 URL。

import { invoke, isTauri } from "@tauri-apps/api/core";
import { readInboxFile, removeInboxFile, needsBytesToSend } from "@cinderous/engine"; // ADR-0347；ADR-0273/0102
import type { OutgoingFileStream } from "@cinderous/core";
import { tauriBundleIo } from "./bundle.js"; // fs_stat / fs_read_range（ADR-0355 已備好的逐塊讀）

/** 另存結果：`savedPath`＝Tauri 選定路徑；`url`＝瀏覽器下載用物件 URL；皆無＝使用者取消。 */
export interface SaveResult {
  savedPath?: string;
  url?: string;
}

/**
 * IPC 一次載運的上限。
 *
 * Tauri 的 `invoke` 把 `Vec<u8>` 參數當成 **JSON 數字陣列**序列化——一個位元組在
 * 傳輸途中是「`255,`」這樣的四個字元，加上 JS 端那個每格 8 bytes 的陣列。1 MiB 一塊
 * 的峰值約十餘 MB，可以接受；整份檔案則沒有上限可言（見 `saveViaInbox`）。
 */
const IPC_CHUNK_BYTES = 1024 * 1024;

/**
 * 經暫存區另存（ADR-0362）：**位元組逐塊過 IPC，整份不做一次性序列化**。
 *
 * ## 為什麼不直接 `invoke("save_file", { bytes })`
 *
 * 那條路要先 `Array.from(bytes)` 造出一個**每格一個 JS number** 的陣列，再由 Tauri
 * 整份序列化成 JSON。收檔那一側還算有界（超過 8 MiB 就走 sink 落盤，ADR-0347），
 * 但**匯出紀錄那條路完全沒有上限**：`exportRecords` 產出的文字要多大有多大，
 * 用了幾年的人匯出 JSON 輕易就是上百 MB——`Array.from` 到那個尺寸是必掛的。
 *
 * ## 為什麼是暫存區而不是新的 raw IPC command
 *
 * ADR-0349 已經為收檔做好了整條機制（`inbox_begin`／`inbox_write`／`save_from_inbox`），
 * 而且 `save_from_inbox` 是**原生移動**暫存檔，零位元組過 IPC。再發明一條平行路徑
 * 沒有任何好處，只會多一個要維護的守衛（`valid_handle` 是路徑穿越的唯一防線）。
 *
 * 使用者取消即丟棄暫存檔——收檔那側刻意保留（「他可能想再存一次」），但這裡的暫存檔
 * 是我們剛剛才造出來的，取消就是放棄，沒有什麼好留的。
 */
async function saveViaInbox(name: string, bytes: Uint8Array): Promise<SaveResult> {
  // `valid_handle`（Rust）只收 `[A-Za-z0-9._-]` 且必須以 `.part` 結尾、長度 ≤128。
  const handle = `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.part`;
  await invoke("inbox_begin", { handle });
  try {
    for (let off = 0; off < bytes.length; off += IPC_CHUNK_BYTES) {
      const chunk = bytes.subarray(off, Math.min(off + IPC_CHUNK_BYTES, bytes.length));
      // eslint-disable-next-line no-await-in-loop -- 逐塊寫入必須依序（offset 有意義）
      await invoke("inbox_write", { handle, offset: off, bytes: Array.from(chunk) });
    }
    const savedPath = await invoke<string | null>("save_from_inbox", { name, handle });
    if (savedPath) return { savedPath };
  } catch (e) {
    await invoke("inbox_discard", { handle }).catch(() => {});
    throw e;
  }
  await invoke("inbox_discard", { handle }).catch(() => {}); // 取消 → 不留垃圾
  return {};
}

/**
 * 收檔另存：跳「另存新檔」讓使用者選位置並寫入。
 * @returns Tauri：`{ savedPath }`（取消回 `{}`）；瀏覽器：`{ url }`（已觸發下載）。
 */
export async function saveIncomingFile(name: string, mime: string, bytes: Uint8Array): Promise<SaveResult> {
  if (isTauri()) return await saveViaInbox(name, bytes); // ADR-0362：逐塊過 IPC
  // 瀏覽器後備：以 <a download> 觸發瀏覽器下載（路徑由瀏覽器決定、不可知）。
  return browserDownload(name, mime, bytes);
}

/**
 * 串流落盤的檔案另存（ADR-0347，瀏覽器版）。
 *
 * 🔴 **不把它讀成位元組**：`URL.createObjectURL(file)` 對 OPFS 取回的 `File` 是**零複製**，
 * 下載直接從磁碟串流。`await file.arrayBuffer()` 會把剛剛省下的記憶體全部吃回去。
 *
 * ADR-0349：Tauri 走另一條——`save_from_inbox` 由 Rust 原生移動暫存檔，同樣零位元組過 IPC。
 */
export async function saveStreamedFile(name: string, handle: string): Promise<SaveResult> {
  if (isTauri()) {
    // ADR-0349：原生另存——對話框選位置後由 Rust **移動**暫存檔，零位元組過 IPC。
    const savedPath = await invoke<string | null>("save_from_inbox", { name, handle });
    return savedPath ? { savedPath } : {};
  }
  const file = await readInboxFile(handle);
  if (!file) return {};
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  void removeInboxFile(handle); // 使用者已拿到檔案 ⇒ 暫存區不必再留
  return { url };
}

/** 導出文字紀錄另存（ADR-0094）：Tauri 跳原生另存、瀏覽器下載。回傳路徑（Tauri）或 url（瀏覽器）。 */
export async function saveTextFile(name: string, mime: string, text: string): Promise<SaveResult> {
  const bytes = new TextEncoder().encode(text);
  // ADR-0362：匯出的文字**沒有上限**（用了幾年的人匯出 JSON 輕易上百 MB），
  // 一次性序列化是這個檔案裡最確定會炸的一條路。
  if (isTauri()) return await saveViaInbox(name, bytes);
  return browserDownload(name, mime, bytes);
}

/** 由副檔名猜 mime（原生選檔只給路徑，沒有 File 物件的 `type`）。 */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  mp4: "video/mp4",
};
function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** 送出端選檔的結果（ADR-0103）：**含原檔路徑**。 */
export interface PickedFile {
  path: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/**
 * 以**原生選檔對話框**挑要送出的檔案（ADR-0103）——這是拿得到**完整路徑**的唯一方式：
 * 瀏覽器的 `<input type=file>` 基於安全**不給**完整路徑，所以送出端一直沒有 `savedPath`，
 * 導致自己送出的圖片重載後只剩縮圖、看不了原圖。
 *
 * 非 Tauri（瀏覽器）回 null，由呼叫端退回 `<input type=file>`（照舊，只是沒有路徑）。
 */
export async function pickFileToSend(): Promise<PickedSource | null> {
  if (!isTauri()) return null;
  const path = await invoke<string | null>("pick_existing_file", { name: "" });
  return path ? await openFileAtPath(path) : null;
}

/**
 * 由**真實路徑**讀出檔案（ADR-0103/0104）：原生選檔與原生拖放共用。
 * 讀不到（路徑不存在/是資料夾）回 null。
 */
export async function readFileAtPath(path: string): Promise<PickedFile | null> {
  if (!isTauri()) return null;
  const bytes = await invoke<number[] | null>("read_saved_file", { path });
  if (!bytes) return null;
  const name = baseName(path);
  return { path, name, mime: mimeOf(name), bytes: new Uint8Array(bytes) };
}

/** 由路徑取出檔名（Windows 反斜線與 POSIX 斜線都吃）。 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || "file";
}

/**
 * 原生選檔／拖放的結果：需要位元組的給位元組，其餘給惰性來源。
 *
 * 兩個變體都帶 `path`，因為原生端**總是**拿得到真實路徑（ADR-0103），重載後要靠它讀回原圖。
 */
export type PickedSource =
  | { kind: "bytes"; file: PickedFile }
  | { kind: "stream"; path: string; stream: OutgoingFileStream };

/**
 * 由**真實路徑**開啟一個要送出的檔案，**大檔不進 RAM**（ADR-0346 補完 Tauri 這一側）。
 *
 * ## 為什麼需要它
 *
 * `readFileAtPath` 走的是 `read_saved_file`，那個 command 把整份檔案序列化成 **JSON 數字
 * 陣列**過 IPC——峰值約檔案大小的數倍 heap，而且在反序列化完成前一個位元組都還沒上網。
 * 瀏覽器那一側早就靠 `blobStream` 惰性讀了（ADR-0346），Tauri 的迴紋針與原生拖放卻仍走
 * 整檔讀，而收端上限已放寬到 1 GiB。於是打包版按迴紋針選一個大檔＝當場 OOM，
 * 而**桌面版正是最可能被拿來傳大檔的那一個**。
 *
 * ## 判準沿用既有的那一條
 *
 * `needsBytesToSend`＝要做縮圖（ADR-0102）或清 EXIF（ADR-0273）才需要位元組，兩者都只對
 * **32 MiB 以下的圖片**有意義。其餘一律 `fs_read_range` 逐塊讀。
 *
 * @returns 讀不到、或路徑是資料夾（由合集路徑處理，ADR-0355）時回 `null`。
 */
export async function openFileAtPath(path: string): Promise<PickedSource | null> {
  if (!isTauri()) return null;
  const name = baseName(path);
  const mime = mimeOf(name);
  const st = await tauriBundleIo.stat(path);
  if (!st || st.isDir) return null;
  if (needsBytesToSend(mime, st.size)) {
    const file = await readFileAtPath(path);
    return file ? { kind: "bytes", file } : null;
  }
  return {
    kind: "stream",
    path,
    stream: {
      name,
      mime,
      size: st.size,
      slice: (offset, length) => tauriBundleIo.readRange(path, offset, length),
    },
  };
}

/** 讀回原檔的結果（ADR-0102）。 */
export type ReadOriginalResult =
  | { ok: true; url: string }
  /** `missing`＝原檔已不在 `savedPath`（被搬走/刪除）；`unsupported`＝此平台無法讀回原檔（瀏覽器）。 */
  | { ok: false; reason: "missing" | "unsupported" };

function bytesToUrl(bytes: number[], mime: string): string {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes) as BlobPart], { type: mime || "application/octet-stream" }));
}

/**
 * 讀回已另存的原檔（ADR-0102）——**不彈任何對話框**（點縮圖不該無預警跳檔案總管）。
 * 原檔不由 App 保存，它在使用者當初選的 `savedPath`；讀不到就回 `missing`，
 * 由 UI 顯示「重新指定位置」讓使用者**主動**觸發 {@link relocateOriginal}。
 */
export async function readOriginal(savedPath: string | undefined, mime: string): Promise<ReadOriginalResult> {
  if (!isTauri()) return { ok: false, reason: "unsupported" }; // 瀏覽器無任意檔案系統存取
  if (!savedPath) return { ok: false, reason: "missing" };
  const bytes = await invoke<number[] | null>("read_saved_file", { path: savedPath });
  return bytes ? { ok: true, url: bytesToUrl(bytes, mime) } : { ok: false, reason: "missing" };
}

/**
 * 使用者把原檔搬走後，**主動**重新指定新位置（ADR-0102）：開「選擇檔案」對話框，
 * 讀回內容並回傳新路徑供更新 `savedPath`。取消或讀不到回 null。
 */
export async function relocateOriginal(name: string, mime: string): Promise<{ url: string; newPath: string } | null> {
  if (!isTauri()) return null;
  const newPath = await invoke<string | null>("pick_existing_file", { name });
  if (!newPath) return null;
  const bytes = await invoke<number[] | null>("read_saved_file", { path: newPath });
  return bytes ? { url: bytesToUrl(bytes, mime), newPath } : null;
}

/**
 * 檔名消毒（ADR-0128）：收到的檔名來自對方（遠端可控）。瀏覽器對 `<a download>` 本身會消毒，
 * 但為求與桌面原生路徑一致、且不依賴各瀏覽器實作，這裡也收斂成乾淨 basename。
 * 規則與 Rust `sanitize_filename` 一致：只取最後一段、移除控制字元與 Windows 保留字元、
 * 去開頭的點、空的退回 `"file"`。
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // 丟掉控制字元（codepoint <= 0x1f）與 Windows 保留字元；以 codepoint 過濾避免在正則裡放
  // 控制字元（會讓原始碼變 binary、且易寫錯範圍）。
  const cleaned = [...base]
    .filter((c) => (c.codePointAt(0) ?? 0) > 0x1f && !'<>:"|?*'.includes(c))
    .join("")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return cleaned.slice(0, 255) || "file";
}

/** 瀏覽器下載共用：以 <a download> 觸發，回傳可再下載的物件 URL。 */
function browserDownload(name: string, mime: string, bytes: Uint8Array): SaveResult {
  const blob = new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  if (typeof document !== "undefined") {
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFilename(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return { url };
}
