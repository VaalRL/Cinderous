// 桌面版本機錯誤紀錄（ADR-0421）：WebView 這份存 localStorage，原生 panic 那份由 Rust 寫在
// App 的 log 資料夾。兩份都只存在這台裝置；只有使用者按「複製」才會合併成一段文字交出去。
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createDiagLog, webDiagStore, type DiagLog } from "@cinderous/engine";
import { APP_VERSION } from "../version.js";

/** 裝置層（不分身分）：錯誤跟「哪台裝置」有關，跟「哪個身分」無關，紀錄裡也不含身分資訊。 */
export const DIAG_KEY = "cinder.diag.v1";

export const diagLog: DiagLog = createDiagLog({ store: webDiagStore(DIAG_KEY), version: APP_VERSION });

async function nativeLog(): Promise<string> {
  if (!isTauri()) return "";
  try {
    return ((await invoke("diag_native_log")) as string) ?? "";
  } catch {
    return "";
  }
}

/** 匯出文字：WebView 紀錄＋原生 panic 紀錄（有的話）。 */
export async function diagExportText(log: DiagLog = diagLog): Promise<string> {
  const native = await nativeLog();
  return log.exportText({
    platform: `desktop ${navigator.userAgent}`,
    ...(native.trim() ? { extra: `--- native ---\n${native.trim()}` } : {}),
  });
}

/** 兩份一起清。 */
export async function diagClearAll(log: DiagLog = diagLog): Promise<void> {
  log.clear();
  if (!isTauri()) return;
  try {
    await invoke("diag_native_clear");
  } catch {
    /* 清不掉原生那份不影響 WebView 這份 */
  }
}
