// 收檔串流落盤的 OPFS 實作（ADR-0347）。
//
// ## 為什麼是 OPFS 而不是「另存新檔」對話框
//
// 收檔的既有 UX 是「收齊 → 跳另存新檔 → 使用者選位置」（ADR-0093）。要一邊收一邊寫，
// 就得在**收之前**決定寫哪——那會把對話框提前到來電式的打斷，是產品層的改動。
//
// OPFS 讓兩者都成立：**先串流到 OPFS 的暫存區**（使用者無感），收齊後再走既有的另存
// 流程把它交出去。OPFS 的配額走 Storage API（通常是可用磁碟的一大部分），不是
// localStorage 那種 5–10 MB 的小額度——這正是 ADR-0111 當初選它當封存基質的理由。
//
// ## 為什麼不在 Tauri 上用原生檔案系統
//
// 原生路徑要新增 Tauri command，而 `main.rs` 是 `required-features = ["tauri-app"]` 的
// bin target——**`cargo test` 與 CI 都不編譯它**（見 `partfile.rs` 檔頭）。在那裡加程式碼
// ＝加一段沒有任何地方驗證得到的程式。OPFS 在 Tauri 的 webview 裡同樣可用，所以兩邊
// 共用這一份實作；原生路徑另案（見 ADR-0347 §後續行動）。

import type { FileSink, FileSinkResult, OpenFileSink } from "@cinderous/core";
import { hasOpfs } from "./opfs-archive.js";

/** 暫存區目錄名（與 ADR-0111 的封存區分開，清理策略不同）。 */
const INBOX_DIR = "cinder-inbox";

/** 暫存檔名：傳輸 id 已是本地產生的短 ASCII，但仍消毒以杜絕路徑穿越。 */
function safeName(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  return `${clean || "f"}.part`;
}

async function inboxDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(INBOX_DIR, { create: true });
}

/**
 * 取回串流落盤的檔案本體。
 *
 * 回傳的是 `File`——**不是位元組**。`URL.createObjectURL(file)` 對它是零複製，瀏覽器
 * 下載時直接從磁碟串流；把它 `arrayBuffer()` 出來就等於把剛剛省下的記憶體又吃回去。
 */
export async function readInboxFile(handle: string): Promise<File | null> {
  if (!hasOpfs()) return null;
  try {
    const dir = await inboxDir();
    const fh = await dir.getFileHandle(handle);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/**
 * 開機清理：刪掉超過 `maxAgeMs` 的暫存檔，回傳刪除數。
 *
 * 為什麼需要它：收檔是**先落盤再另存**，使用者在另存前關掉分頁，那份 `.part` 就留下了。
 * 單檔有上限，但它會累積——而 OPFS 的配額是整個來源共用的，撐爆了連封存（ADR-0111）
 * 都寫不進去。桌面那側早就有對應的 `inbox_sweep`（ADR-0349），這是瀏覽器這側的同一件事。
 *
 * 只認 `.part` 後綴、只看修改時間，且**任何一步失敗都不拋**——清理失敗不該擋住開機。
 */
export async function sweepInboxFiles(maxAgeMs = 24 * 3600 * 1000, now = Date.now()): Promise<number> {
  if (!hasOpfs()) return 0;
  let removed = 0;
  try {
    const dir = await inboxDir();
    // OPFS 的目錄列舉是非同步迭代器；型別未必包含它，故取到再用。
    const entries = (dir as unknown as { keys?: () => AsyncIterable<string> }).keys?.();
    if (!entries) return 0;
    const names: string[] = [];
    for await (const name of entries) if (name.endsWith(".part")) names.push(name);
    for (const name of names) {
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        if (now - file.lastModified < maxAgeMs) continue;
        await dir.removeEntry(name);
        removed += 1;
      } catch {
        /* 這一個清不掉就算了，別讓它擋住其他的 */
      }
    }
  } catch {
    /* 沒有暫存區、或配額拒絕：忽略 */
  }
  return removed;
}

/** 刪掉暫存檔（使用者已另存、或放棄）。失敗不拋——清理失敗不該影響流程。 */
export async function removeInboxFile(handle: string): Promise<void> {
  if (!hasOpfs()) return;
  try {
    const dir = await inboxDir();
    await dir.removeEntry(handle);
  } catch {
    /* 已不在、或配額拒絕：忽略 */
  }
}

/**
 * 建立 OPFS 落盤工廠。**不支援 OPFS 時回 `undefined`** ——呼叫端據此完全不掛 sink，
 * 收檔退回記憶體路徑（既有行為）。
 *
 * ⚠ 刻意不回「什麼都不做的替身」：那會讓大檔看似收成功、實際上什麼都沒寫（同
 * `openOpfsArchive` 的理由）。
 */
export function opfsFileSink(): OpenFileSink | undefined {
  if (!hasOpfs()) return undefined;
  return async (meta): Promise<FileSink | null> => {
    let handle: string;
    let writable: FileSystemWritableFileStream;
    try {
      handle = safeName(meta.id);
      const dir = await inboxDir();
      const fh = await dir.getFileHandle(handle, { create: true });
      writable = await fh.createWritable();
    } catch {
      return null; // 私密模式／配額拒絕 → 退回記憶體，而不是讓收檔失敗
    }
    return {
      // ⚠ 用 `seek` 寫指定位移而不是依賴到達順序：`chunkSize` 在手時分塊可以亂序
      // （ADR-0345 保留的既有契約），依序寫會把亂序的那些寫到錯的地方。
      async write(offset, chunk) {
        // `new Uint8Array(chunk)` 複製一份、且型別收斂成 `Uint8Array<ArrayBuffer>`
        //（`FileSystemWritableFileStream.write` 不收 SharedArrayBuffer 支撐的檢視）。
        // 一塊 16 KiB 的複製與寫入本身的 memcpy 同一個量級，不值得為它加型別斷言。
        await writable.write({ type: "write", position: offset, data: new Uint8Array(chunk) });
      },
      async close(): Promise<FileSinkResult> {
        await writable.close();
        return { handle };
      },
      abort() {
        // 兩段都盡力而為：中止路徑本身不得再拋（core 的 `fail()` 假設它安全）。
        void writable.abort?.().catch(() => undefined);
        void removeInboxFile(handle);
      },
    };
  };
}
