// 解開合集（ADR-0355）：把收到的 `.tar` 攤回一個資料夾。
//
// ## 為什麼有兩套落地端
//
// tar 的解析在 `@cinderous/core`（桌面與瀏覽器共用同一份，zip-slip 守衛因此只有一份），
// 差別只在「寫到哪裡」：
//   - **桌面**走 Tauri command，寫到使用者以原生對話框選定的資料夾（ADR-0128 白名單）；
//   - **瀏覽器**走 File System Access API 的 `showDirectoryPicker`。
//
// 🔴 後者**不是每個瀏覽器都有**：Chromium 系有，Firefox 與 Safari 沒有。所以能力要**問過
// 再顯示**（`canExtractHere()`），沒有的平台顯示「請用系統工具解開」而不是一顆壞掉的按鈕。
// 「瀏覽器沒有檔案系統寫入能力」是過時的說法，照著它做就會讓 Chrome 使用者少一個功能。

import { listTar, safeArchivePath, type RangeReader, type TarListEntry } from "@cinderous/core";
import { isTauri } from "@tauri-apps/api/core";

/** 合集的判定：副檔名或 MIME 任一命中即可（對方的 MIME 不一定可信）。 */
export function isBundleFile(name: string, mime: string): boolean {
  return name.toLowerCase().endsWith(".tar") || mime === "application/x-tar";
}

/**
 * 做一個隨機讀取器，讀的是**已另存的那份合集**。
 *
 * 只認已另存的路徑（ADR-0093：App 不保管檔案本體）。使用者按了取消沒存下來，就沒有
 * 東西可以列、也沒有東西可以解——那是他自己的選擇，不是一個要補的缺口。
 *
 * 走 IPC 的原始位元組通道（不是 JSON 數字陣列），列標頭因此只是幾次 512 位元組的讀取。
 */
export function tauriReader(path: string): RangeReader {
  return async (offset, length) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return new Uint8Array(await invoke<ArrayBuffer>("fs_read_range", { path, offset, length }));
  };
}

/** 列出合集內容（只讀標頭，不解開、不連網）。 */
export function listBundle(read: RangeReader, total: number): Promise<TarListEntry[]> {
  return listTar(read, total);
}

/** 解包結果（兩個平台共用的形狀）。 */
export interface ExtractOutcome {
  files: number;
  bytes: number;
  /** 因路徑不安全被跳過的項目（原樣回報，供 UI 說明）。 */
  skipped: string[];
  /** 合集被截斷而沒收齊的項目。 */
  truncated: string[];
}

/**
 * 桌面解包：**內容一個位元組都不經過 IPC**。
 *
 * 先用 `listTar` 讀標頭（每項只讀 512 位元組，很便宜），再讓 Rust 直接從合集檔案複製到
 * 目的檔案。走 `ExtractTarget` 那條路會把每個位元組轉成 JSON 數字再轉回來——一個 1 GB
 * 的合集會變成 4～5 GB 的字串，那是這個功能唯一真正的效能陷阱。
 *
 * zip-slip 守衛有兩層：這裡的 `safeArchivePath`（合集內容不可信）與 Rust 的 `safe_join`
 * （webview 不可信）。兩層都不能省——前者擋合集，後者擋 XSS。
 */
export async function extractWithTauri(
  path: string,
  dest: string,
  entries: readonly TarListEntry[],
  onProgress?: (files: number, total: number) => void,
): Promise<ExtractOutcome> {
  const { invoke } = await import("@tauri-apps/api/core");
  const out: ExtractOutcome = { files: 0, bytes: 0, skipped: [], truncated: [] };
  for (const e of entries) {
    const rel = safeArchivePath(e.path);
    if (rel === null) {
      out.skipped.push(e.path);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- 逐檔複製：要回報進度，也不該同時開幾千個檔案把手
    const copied = await invoke<number>("extract_copy", { path, dest, rel, at: e.at, len: e.size });
    if (copied < e.size) out.truncated.push(e.path);
    // eslint-disable-next-line no-await-in-loop -- 同上
    await invoke("extract_finalize", { dest, rel, mtime: e.mtime, mode: e.mode });
    out.files += 1;
    out.bytes += copied;
    onProgress?.(out.files, entries.length);
  }
  return out;
}

/** 選解包目的地（桌面：原生資料夾對話框，選定即授權）。取消回 null。 */
export async function pickExtractDest(): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke<string | null>("pick_folder")) ?? null;
}

/**
 * 目的地所在磁碟的可用空間；問不到回 null（**問不到就不要擋**）。
 * 只有 Windows 問得到，其他平台靠作業系統在寫入時報錯。
 */
export async function freeSpaceAt(dest: string): Promise<number | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke<number | null>("fs_free_space", { path: dest })) ?? null;
}

/**
 * 這個環境能不能解包。
 *
 * 桌面（Tauri）可以。瀏覽器的能力偵測住在 engine 的 `canExtractToDirectory`，由行動端
 * 那條路徑使用——這裡的合集卡片本來就只在有 `savedPath` 時出現，而那只有 Tauri 給得出來。
 */
export function canExtractHere(): boolean {
  return isTauri();
}
