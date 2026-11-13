// 行動端本機錯誤紀錄（ADR-0421）：存 WebView 的 localStorage，只存在這台裝置、從不上傳；
// 使用者在設定頁按「複製」才會交出去（寫入前已遮罩金鑰與身分）。
import { createDiagLog, webDiagStore, type DiagLog } from "@cinderous/engine";
import { APP_VERSION } from "../version.js";

/** 裝置層（不分身分）。 */
export const DIAG_KEY = "cinder.diag.v1";

export const diagLog: DiagLog = createDiagLog({ store: webDiagStore(DIAG_KEY), version: APP_VERSION });

export async function diagExportText(log: DiagLog = diagLog): Promise<string> {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return log.exportText({ platform: `mobile ${ua}` });
}
