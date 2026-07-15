// @提及 composer 建議（ADR-0050）：從輸入中的進行中 @token 過濾候選。
//
// 純函式，沿用 ADR-0037 尾端建議列的體驗；名稱→公鑰解析交給 parseMentions（mention.ts）。
// 放在 core 讓桌面與行動端**共用同一份**（ADR-0133）——過去只有桌面有，行動端無從提及。

import type { MentionCandidate } from "./mention.js";

/** 建議列上限。 */
export const MENTION_SUGGEST_MAX = 6;

export interface MentionSuggest {
  /** `@` 在文字中的索引（供替換）。 */
  at: number;
  /** `@` 後已輸入的片段（不含 `@`）。 */
  query: string;
  /** 過濾後的候選（名稱前綴命中）。 */
  candidates: MentionCandidate[];
}

/**
 * 從 composer 文字（游標於結尾）擷取進行中的 `@提及` token 並過濾候選：
 * `@` 須位於開頭或空白後、其後到結尾不含空白/`@`。無命中回傳 null。
 */
export function suggestMentions(text: string, candidates: MentionCandidate[]): MentionSuggest | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  if (!m) return null;
  const query = m[1] ?? "";
  const at = text.length - query.length - 1; // `@` 的位置
  const q = query.toLowerCase();
  const list = candidates
    .filter((c) => c.name.length > 0 && c.name.toLowerCase().startsWith(q))
    .slice(0, MENTION_SUGGEST_MAX);
  if (list.length === 0) return null;
  return { at, query, candidates: list };
}

/** 接受某候選：把進行中的 `@token` 換成 `@名稱 `（尾隨空白便於續打）。 */
export function applyMention(text: string, s: MentionSuggest, cand: MentionCandidate): string {
  return `${text.slice(0, s.at)}@${cand.name} ${text.slice(s.at + 1 + s.query.length)}`;
}
