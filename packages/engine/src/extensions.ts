// 前端擴充縫（ADR-0074 K4，實驗性——僅預留註冊機制）。
//
// 這裡只提供「行程內、第一方」的擴充註冊表：前端可在啟動時登記自訂能力
// （例如自訂訊息內容型別的處理器、自訂指令），由前端自行決定如何呈現。
//
// ⚠️ **尚未包含**「載入第三方/遠端程式碼」的機制——那涉及沙箱與信任邊界的安全
// 決策，將由 K4 專屬 ADR 定案。在那之前請只用於自家程式的組合，勿載入不受信任者。

/** 一個前端擴充。`id` 唯一；其餘欄位開放，具體契約待 K4 ADR 收斂。 */
export interface FrontendExtension {
  id: string;
  /** 人類可讀名稱（可選）。 */
  name?: string;
  [capability: string]: unknown;
}

const registry = new Map<string, FrontendExtension>();

/** 登記一個擴充（同 id 覆蓋）。回傳取消登記的函式。 */
export function registerExtension(ext: FrontendExtension): () => void {
  registry.set(ext.id, ext);
  return () => registry.delete(ext.id);
}

/** 取得已登記的擴充（無則 undefined）。 */
export function getExtension(id: string): FrontendExtension | undefined {
  return registry.get(id);
}

/** 列出所有已登記的擴充（快照）。 */
export function listExtensions(): FrontendExtension[] {
  return [...registry.values()];
}
