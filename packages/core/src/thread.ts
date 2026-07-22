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

// ── 串回覆「同時傳到主對話」（ADR-0232，仿 Slack「也傳到頻道」）──
// 附加的 app 專屬 tag；reply e-tag 照舊保留（NIP-10 相容），tag 攜於加密 rumor 內層、中繼看不到。

const ALSO_MAIN = "also-main";

/** 產生「同時傳到主對話」旗標 tag。 */
export function alsoMainTag(): string[] {
  return [ALSO_MAIN];
}

/** 讀出旗標：僅對「有 reply e-tag 的回覆」有意義（非回覆一律 false）。 */
export function alsoMain(rumor: Rumor): boolean {
  return threadRoot(rumor) !== undefined && rumor.tags.some((t) => t[0] === ALSO_MAIN);
}
