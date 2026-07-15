// 收檔另存（ADR-0093）：收到 P2P 檔案位元組後，讓使用者選擇儲存位置。
// App **不保管檔案本體**——位元組交給 OS 檔案系統，只把使用者選定的路徑回填顯示。
//
// - Tauri 桌面：跳原生「另存新檔」對話框（Rust `save_file` command），寫入選定路徑、回傳路徑。
// - 瀏覽器/web preview：無任意檔案系統存取，退回瀏覽器下載（最終路徑不可知），回傳可再下載的 URL。

import { invoke, isTauri } from "@tauri-apps/api/core";

/** 另存結果：`savedPath`＝Tauri 選定路徑；`url`＝瀏覽器下載用物件 URL；皆無＝使用者取消。 */
export interface SaveResult {
  savedPath?: string;
  url?: string;
}

/**
 * 收檔另存：跳「另存新檔」讓使用者選位置並寫入。
 * @returns Tauri：`{ savedPath }`（取消回 `{}`）；瀏覽器：`{ url }`（已觸發下載）。
 */
export async function saveIncomingFile(name: string, mime: string, bytes: Uint8Array): Promise<SaveResult> {
  if (isTauri()) {
    // Rust 端開原生對話框並寫檔；使用者取消回 null。位元組以一般陣列過 IPC。
    const savedPath = await invoke<string | null>("save_file", {
      name,
      bytes: Array.from(bytes),
    });
    return savedPath ? { savedPath } : {};
  }
  // 瀏覽器後備：以 <a download> 觸發瀏覽器下載（路徑由瀏覽器決定、不可知）。
  return browserDownload(name, mime, bytes);
}

/** 導出文字紀錄另存（ADR-0094）：Tauri 跳原生另存、瀏覽器下載。回傳路徑（Tauri）或 url（瀏覽器）。 */
export async function saveTextFile(name: string, mime: string, text: string): Promise<SaveResult> {
  const bytes = new TextEncoder().encode(text);
  if (isTauri()) {
    const savedPath = await invoke<string | null>("save_file", { name, bytes: Array.from(bytes) });
    return savedPath ? { savedPath } : {};
  }
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
export async function pickFileToSend(): Promise<PickedFile | null> {
  if (!isTauri()) return null;
  const path = await invoke<string | null>("pick_existing_file", { name: "" });
  return path ? await readFileAtPath(path) : null;
}

/**
 * 由**真實路徑**讀出檔案（ADR-0103/0104）：原生選檔與原生拖放共用。
 * 讀不到（路徑不存在/是資料夾）回 null。
 */
export async function readFileAtPath(path: string): Promise<PickedFile | null> {
  if (!isTauri()) return null;
  const bytes = await invoke<number[] | null>("read_saved_file", { path });
  if (!bytes) return null;
  const name = path.split(/[\\/]/).pop() || "file";
  return { path, name, mime: mimeOf(name), bytes: new Uint8Array(bytes) };
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
