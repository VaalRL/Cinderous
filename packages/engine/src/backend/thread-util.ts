// 對話串聚合（ADR-0051）：純函式，供主頻道／串面板切分與回覆數彙整。
// ADR-0183：由桌面 ui/ 上移共用引擎——桌面與行動端右欄/串面板共用同一份，消除重複。

import type { ChatMessage } from "./types.js";

/** 訊息所屬串的根 id：回覆取 replyTo，否則自身即為根。 */
export const rootIdOf = (m: ChatMessage): string => m.replyTo ?? m.id;

/** 主頻道訊息（排除串回覆，回覆只在面板顯示）。 */
export function mainMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.replyTo === undefined);
}

/** 各根訊息 id → 回覆數。 */
export function replyCounts(messages: ChatMessage[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of messages) {
    if (m.replyTo !== undefined) map.set(m.replyTo, (map.get(m.replyTo) ?? 0) + 1);
  }
  return map;
}

/** 某串的訊息：根（若在清單中）＋所有回覆，依時間排序。 */
export function threadMessages(messages: ChatMessage[], rootId: string): ChatMessage[] {
  const root = messages.find((m) => m.id === rootId && m.replyTo === undefined);
  const replies = messages.filter((m) => m.replyTo === rootId).sort((a, b) => a.at - b.at);
  return root ? [root, ...replies] : replies;
}
