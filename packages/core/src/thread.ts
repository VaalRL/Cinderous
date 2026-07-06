// 對話串 Thread（ADR-0051）：NIP-10 reply-marked e-tag，攜於加密 rumor 內層。
//
// 回覆＝kind 14 聊天 rumor 加 `["e", rootId, "", "reply"]`；隨 Gift Wrap 加密，
// 中繼看不到串結構。串一律扁平掛在根訊息下（比照 Slack 非巢狀）。

import type { Rumor } from "./nip59.js";

/** NIP-10 回覆標記 e-tag：指向對話串根訊息。 */
export function replyTag(rootId: string): string[] {
  return ["e", rootId, "", "reply"];
}

/** 讀出 rumor 的對話串根 id（NIP-10 reply-marked e-tag）；非回覆回傳 undefined。 */
export function threadRoot(rumor: Rumor): string | undefined {
  return rumor.tags.find((t) => t[0] === "e" && t[3] === "reply")?.[1];
}
