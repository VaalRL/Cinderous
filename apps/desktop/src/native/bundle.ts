// 桌面合集打包（ADR-0355）：把使用者拖進來的一批路徑做成**單一 tar 串流**。
//
// ## 為什麼要有合集
//
// 每個檔案在傳輸層都有固定成本：一則 `file-begin`、一次 sink 開檔、一次另存互動、一則
// 聊天訊息。傳三個檔時這些成本看不見；傳三千個小檔時它們就是全部的成本——實際位元組
// 可能只有幾 MB，但使用者要等好幾分鐘，還會收到三千則訊息。
//
// ## 為什麼是 tar 而不是 zip
//
// tar 是「標頭＋內容」線性排列，**位移算得出來**，所以整個合集能實作成 `OutgoingFileStream`
// ——要哪一段就去讀哪一段，合集本身從不進記憶體，斷點續傳也天然成立。zip 的中央目錄在
// 檔尾，得先掃過一遍才知道版面；壓縮更是要把內容全讀過。合集裡多半是已壓縮的媒體檔，
// 壓縮率趨近於零，代價卻是整份都要進 CPU。
//
// ## 這一層不碰 Tauri
//
// IO 全部走 {@link BundleIo}，產線實作在檔尾。這樣打包邏輯（門檻、同名去重、路徑組合）
// 在 vitest 裡測得到，不必起一個 webview。

import { archiveBaseName, shouldArchive, tarStream, type ArchiveEntry, type OutgoingFileStream } from "@cinderous/core";

/** 一個路徑的基本資訊（對應 Rust 的 `fs_stat`）。 */
export interface BundleStat {
  isDir: boolean;
  size: number;
  /** 修改時間（Unix 秒）。 */
  mtime: number;
  /** POSIX 權限位元。 */
  mode: number;
}

/** 走訪資料夾得到的一個檔案（對應 Rust 的 `fs_list_dir`）。 */
export interface BundleWalkEntry {
  /** 相對於被走訪資料夾的路徑，以 `/` 分隔。 */
  rel: string;
  size: number;
  mtime: number;
  mode: number;
}

/** 打包需要的檔案系統能力（產線走 Tauri IPC，測試走記憶體假件）。 */
export interface BundleIo {
  /** 看一個路徑是什麼；未授權或不存在回 `null`。 */
  stat(path: string): Promise<BundleStat | null>;
  /** 攤平一個資料夾；超過上限時**拋錯**（而不是回空陣列——使用者要知道為什麼）。 */
  listDir(path: string): Promise<BundleWalkEntry[]>;
  /** 讀一個已授權檔案的某一段。 */
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** 讀一個已授權資料夾底下某相對路徑的某一段。 */
  readRangeIn(base: string, rel: string, offset: number, length: number): Promise<Uint8Array>;
}

/** 打包結果。 */
export interface Bundle {
  /** 可定位的合集串流，直接餵給 `sendFile`。 */
  stream: OutgoingFileStream;
  /** 合集裡的檔案數（供 UI 顯示「共 N 個檔案」）。 */
  fileCount: number;
  /** 合集裡的檔名（不含路徑），供 {@link bundleHasSanitizableImage} 判斷要不要先問過使用者。 */
  names: string[];
}

/** 取路徑的最後一段（跨平台分隔符）。 */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "file";
}

/** 同名去重：`note.txt` → `note (2).txt`（保留副檔名，人看得懂是同一種東西）。 */
function dedupe(taken: Set<string>, path: string): string {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  for (let n = 2; ; n += 1) {
    const candidate = `${dir}${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * 把一批路徑做成合集。
 *
 * 回 `null` 代表**不該折疊**：檔案太少又沒有資料夾（見 `shouldArchive`），或一個檔案都讀不到。
 * 呼叫端這時照舊逐檔送出。
 *
 * `force` 用於使用者明確要求打包（例如未來的「打包後傳送」選項），跳過門檻判斷。
 *
 * 讀不到的路徑（未授權、傳輸中被刪掉）**略過而不是整批失敗**——十個檔裡有一個被刪掉
 * 不該讓另外九個也送不出去。走訪失敗（超過上限）則會拋出來，因為那代表使用者選錯了東西。
 */
export async function buildBundle(
  paths: readonly string[],
  io: BundleIo,
  opts: { force?: boolean; at?: Date } = {},
): Promise<Bundle | null> {
  const entries: ArchiveEntry[] = [];
  const names: string[] = [];
  const taken = new Set<string>();
  let hasDirectory = false;

  for (const path of paths) {
    // eslint-disable-next-line no-await-in-loop -- 逐一 stat：數量少（拖放的頂層項目），且要保持順序
    const st = await io.stat(path);
    if (!st) continue; // 未授權／已不存在 → 略過
    const top = baseName(path);
    if (!st.isDir) {
      const inPath = dedupe(taken, top);
      entries.push({
        path: inPath,
        size: st.size,
        mtime: st.mtime,
        mode: st.mode,
        read: (offset, length) => io.readRange(path, offset, length),
      });
      names.push(top);
      continue;
    }
    hasDirectory = true;
    // eslint-disable-next-line no-await-in-loop -- 同上；且走訪失敗要能直接中止整批
    const walked = await io.listDir(path);
    for (const w of walked) {
      // 合集內帶上資料夾名 → 解開後是一個資料夾，不是散落一地的檔案。
      const inPath = dedupe(taken, `${top}/${w.rel}`);
      entries.push({
        path: inPath,
        size: w.size,
        mtime: w.mtime,
        mode: w.mode,
        read: (offset, length) => io.readRangeIn(path, w.rel, offset, length),
      });
      names.push(baseName(w.rel));
    }
  }

  if (entries.length === 0) return null;
  if (!opts.force && !shouldArchive({ fileCount: entries.length, hasDirectory })) return null;
  return {
    stream: tarStream(entries, archiveBaseName(opts.at ?? new Date())),
    fileCount: entries.length,
    names,
  };
}

// ── 產線 IO：走 Tauri IPC ───────────────────────────────────────────────────────

/** Rust 端 `fs_stat` 的原始形狀（snake_case，與 serde 預設一致）。 */
interface RawStat {
  is_dir: boolean;
  size: number;
  mtime: number;
  mode: number;
}

/**
 * 產線實作：全部經 ADR-0128 白名單，只讀得到使用者親自選定或親手拖進來的路徑。
 *
 * 兩個讀取 command 回傳的是 `ArrayBuffer`（Rust 用 `tauri::ipc::Response` 走原始位元組通道），
 * 不是數字陣列——64 KiB 的分塊若走 JSON，光是字串化與解析就會蓋過傳輸本身的成本。
 */
export const tauriBundleIo: BundleIo = {
  stat: async (path) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<RawStat | null>("fs_stat", { path });
    return raw ? { isDir: raw.is_dir, size: raw.size, mtime: raw.mtime, mode: raw.mode } : null;
  },
  listDir: async (path) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<BundleWalkEntry[]>("fs_list_dir", { path });
  },
  readRange: async (path, offset, length) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return new Uint8Array(await invoke<ArrayBuffer>("fs_read_range", { path, offset, length }));
  },
  readRangeIn: async (base, rel, offset, length) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return new Uint8Array(await invoke<ArrayBuffer>("fs_read_range_in", { base, rel, offset, length }));
  },
};
