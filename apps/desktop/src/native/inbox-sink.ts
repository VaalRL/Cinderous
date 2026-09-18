// Tauri 原生的收檔串流落盤（ADR-0349）。
//
// ADR-0347 讓收檔端來一塊寫一塊，但把 Tauri 排除在外——它的另存走 Rust `save_file`，
// 需要**整份位元組過 IPC**。這裡補上原生路徑：位元組逐塊落到 app 資料夾的暫存區，
// 另存時只做一次原生 `rename`，**零位元組過 IPC**。
//
// 路徑解析、檔名白名單、寫入、移動、清理全部住在 Rust lib（`cinder_desktop::inbox`，
// 有測試）。這一層只是把 `FileSink` 的三個方法接到四個 command 上。

import { invoke, isTauri } from "@tauri-apps/api/core";
import { sweepInboxFiles } from "@cinderous/engine"; // 瀏覽器那一側的暫存區清理（ADR-0347）
import type { FileSink, OpenFileSink } from "@cinderous/core";

/**
 * 暫存檔名。**Rust 端會再驗一次**（`inbox::valid_handle`）——前端不可信，webview 裡的
 * 任何 XSS 都能呼叫 command，所以路徑穿越的守衛必須在原生側。這裡只是先給個乾淨的名字。
 */
function handleFor(id: string): string {
    const clean = id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
    return `${clean || "f"}.part`;
}

/**
 * 建立 Tauri 落盤工廠。非 Tauri 環境回 `undefined`（呼叫端據此改用 OPFS 或不掛）。
 *
 * ⚠ 刻意不回「什麼都不做的替身」：那會讓大檔看似收成功、實際什麼都沒寫
 * （同 `openOpfsArchive`／`opfsFileSink` 的理由）。
 */
export function tauriFileSink(): OpenFileSink | undefined {
  if (!isTauri()) return undefined;
  return async (meta): Promise<FileSink | null> => {
    const handle = handleFor(meta.id);
    try {
      await invoke("inbox_begin", { handle });
    } catch {
      return null; // 建不了暫存檔（權限/磁碟滿）→ 退回記憶體，而不是讓收檔失敗
    }
    return {
      async write(offset, chunk) {
        // ⚠ 一塊 16 KiB 過 IPC。這**不是**原本那個災難——災難是整份檔案一次過去
        // （`Array.from` 把 Uint8Array 變成 JS number 陣列，100 MiB ⇒ 約 800 MB）。
        await invoke("inbox_write", { handle, offset, bytes: Array.from(chunk) });
      },
      close() {
        // 另存由 UI 觸發（`saveStreamedFile` → `save_from_inbox`）；這裡只交出 handle。
        return { handle };
      },
      abort() {
        void invoke("inbox_discard", { handle }).catch(() => undefined);
      },
    };
  };
}

/**
 * 開機清理暫存區（ADR-0347 §後果列的殘餘）：使用者在另存前關掉 app 就會留下 `.part`。
 * 非 Tauri 或失敗皆靜默——清理失敗不該影響啟動。
 */
export async function sweepInbox(): Promise<void> {
  // 🔴 **兩種平台各有自己的暫存區**，不能只掃一邊。
  //
  // 這個檔案同一份程式碼會跑在 Tauri 殼裡，也會跑在**瀏覽器**裡（統一節點模式與官網的
  // 網頁版）。先前這裡是 `if (!isTauri()) return;`，於是瀏覽器那一側的 OPFS 暫存檔
  // **永遠不會被回收**——使用者每次在「另存」之前關掉分頁就留下一份 `.part`，累積到
  // OPFS 配額爆掉，連封存（ADR-0111）都寫不進去。
  //
  // engine 早就備好了 `sweepInboxFiles()` 且有測試，只是從來沒有人在桌面這側呼叫它。
  if (!isTauri()) {
    await sweepInboxFiles();
    return;
  }
  try {
    await invoke("inbox_sweep");
  } catch {
    /* 清理是加分項，不是啟動條件 */
  }
}
