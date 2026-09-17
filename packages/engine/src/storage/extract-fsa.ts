// 瀏覽器端解開合集（ADR-0355）：File System Access API。
//
// ## 「瀏覽器沒有檔案系統寫入能力」是過時的說法
//
// `showDirectoryPicker()` 讓使用者親自選一個資料夾並授權寫入，Chromium 系（Chrome、Edge、
// Opera、Brave）都有；Firefox 與 Safari 沒有。所以正確的作法不是「瀏覽器一律不能解包」，
// 而是**問過能力再決定顯示什麼**：有的顯示解包按鈕，沒有的顯示「請用系統工具解開」。
// 照著那句過時的話做，就是讓一大半的使用者少一個本來做得到的功能。
//
// ## 為什麼住在 engine 而不是某一個 app
//
// 桌面版的瀏覽器預覽與行動端都要用，而 tar 的解析在 core——這裡只是「寫到哪裡」那一層。

import { extractTar, type ExtractTarget, type RangeReader } from "@cinderous/core";

/** File System Access API 用得到的最小形狀（不綁完整 lib.dom，Node 測試也載得動）。 */
export interface DirHandleLike {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
}
export interface FileHandleLike {
  createWritable(opts?: { keepExistingData?: boolean }): Promise<WritableLike>;
}
export interface WritableLike {
  write(data: { type: "write"; position: number; data: Uint8Array }): Promise<void>;
  close(): Promise<void>;
}

/** 這個瀏覽器能不能把檔案解開到使用者選的資料夾。 */
export function canExtractToDirectory(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/** 讓使用者選一個資料夾；取消、被拒或不支援皆回 null。 */
export async function pickExtractDirectory(): Promise<DirHandleLike | null> {
  const picker = (globalThis as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandleLike> })
    .showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    return await picker({ mode: "readwrite" });
  } catch {
    return null; // 使用者取消，或權限被拒
  }
}

/**
 * 以一個資料夾把手當落地端。
 *
 * 每個檔案**只開一次可寫串流**，在 `finalize` 才關閉：`createWritable` 的實作多半是寫到
 * 一個暫存檔、關閉時才落地，所以逐塊開關會讓後一塊覆蓋掉前一塊，解出來只剩最後一塊。
 *
 * 修改時間與權限**還原不了**——這個 API 沒有那兩個東西。是平台限制，不是省略；要保留
 * 時間戳的人該用桌面版或系統的解壓縮工具。
 */
export function directoryTarget(root: DirHandleLike): ExtractTarget {
  const open = new Map<string, WritableLike>();
  const writableFor = async (rel: string): Promise<WritableLike> => {
    const existing = open.get(rel);
    if (existing) return existing;
    const parts = rel.split("/");
    const name = parts.pop() ?? rel;
    let dir = root;
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create: true });
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    open.set(rel, w);
    return w;
  };
  return {
    write: async (rel, offset, bytes) => {
      await (await writableFor(rel)).write({ type: "write", position: offset, data: bytes });
    },
    finalize: async (rel) => {
      // 空檔案不會經過 write ⇒ 這裡才第一次建立它（否則零位元組的檔案會整個消失）。
      const w = await writableFor(rel);
      open.delete(rel);
      await w.close();
    },
  };
}

/** 把 `File`／`Blob` 包成隨機讀取器——**不整份讀進記憶體**（`slice` 是零複製的把手）。 */
export function blobReader(blob: Blob): RangeReader {
  return async (offset, len) => new Uint8Array(await blob.slice(offset, offset + len).arrayBuffer());
}

/** 把一個 `File` 形式的合集解到使用者選定的資料夾。使用者取消回 null。 */
export async function extractBlobToDirectory(
  blob: Blob,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<{ files: number; bytes: number; skipped: string[] } | null> {
  const dir = await pickExtractDirectory();
  if (!dir) return null;
  return await extractTar(blobReader(blob), blob.size, directoryTarget(dir), opts);
}
