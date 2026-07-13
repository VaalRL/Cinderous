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
  const blob = new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  if (typeof document !== "undefined") {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return { url };
}
