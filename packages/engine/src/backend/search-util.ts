// 清單搜尋（ADR-0256 階段 4）：桌面三欄/經典與行動端聊天清單共用的比對邏輯
// （自桌面 deck-sidebar 上移，比照 thread-util 前例——消除桌面/行動重複）。
import type { ChatMessage } from "./types.js";

/** 名稱或任一則訊息內容命中查詢（空查詢＝全中；大小寫不敏感）。 */
export function nameOrMessagesMatch(
  name: string,
  id: string,
  query: string,
  convos: Record<string, ChatMessage[]>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (name.toLowerCase().includes(q)) return true;
  const msgs = convos[id];
  return !!msgs && msgs.some((m) => m.text?.toLowerCase().includes(q));
}
