// @提及 Mention（ADR-0050）：以 NIP-01 `p` tag 攜帶於加密 rumor 內層。
//
// 解析為純函式，名稱→公鑰對應由呼叫端（UI）提供候選清單。與 reactions/deletions
// 的引用機制同源；提及結構隨 Gift Wrap 加密，中繼看不到社交圖譜。

import type { PubkeyHex } from "./keys.js";
import type { Rumor } from "./nip59.js";

/** 提及候選：顯示名稱 → 公鑰（由 UI 以群成員名冊／聯絡人提供）。 */
export interface MentionCandidate {
  pubkey: PubkeyHex;
  name: string;
}

/** `@` 後名稱的結尾詞界：字串結尾、空白或標點才算命中（避免 substring 誤配）。 */
function boundaryOk(ch: string): boolean {
  return ch === "" || /[\s\p{P}\p{S}]/u.test(ch);
}

function mentionsName(lowerText: string, lowerName: string): boolean {
  const target = `@${lowerName}`;
  let from = 0;
  for (;;) {
    const idx = lowerText.indexOf(target, from);
    if (idx < 0) return false;
    const before = idx === 0 ? "" : lowerText[idx - 1]!;
    const afterIdx = idx + target.length;
    const after = afterIdx >= lowerText.length ? "" : lowerText[afterIdx]!;
    // `@` 前需為字串開頭或空白（避免 email 如 a@bob）；名稱後需為詞界。
    if ((before === "" || /\s/.test(before)) && boundaryOk(after)) return true;
    from = idx + 1;
  }
}

/**
 * 解析文字中的 @提及，回傳去重公鑰。名稱最長優先（避免短名稱遮蔽長名稱）、
 * 詞界結尾、拉丁大小寫不敏感。空名稱候選略過。
 */
export function parseMentions(text: string, candidates: MentionCandidate[]): PubkeyHex[] {
  const lowerText = text.toLowerCase();
  const sorted = candidates
    .filter((c) => c.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const out: PubkeyHex[] = [];
  const seen = new Set<PubkeyHex>();
  for (const c of sorted) {
    if (seen.has(c.pubkey)) continue;
    if (mentionsName(lowerText, c.name.toLowerCase())) {
      seen.add(c.pubkey);
      out.push(c.pubkey);
    }
  }
  return out;
}

/** 提及公鑰 → rumor `p` tags（去重）。 */
export function mentionTags(pubkeys: PubkeyHex[]): string[][] {
  const seen = new Set<PubkeyHex>();
  const out: string[][] = [];
  for (const pk of pubkeys) {
    if (seen.has(pk)) continue;
    seen.add(pk);
    out.push(["p", pk]);
  }
  return out;
}

/**
 * 讀出 rumor 內層被提及的公鑰（`p` tag）。
 *
 * 等於 `to`（1:1 的對話對象）的不算：1:1 訊息帶標準的 `["p", 收件人]` 表示對話歸屬（NIP-17，ADR-0382 §8），
 * 不是「提及了你」。
 */
export function mentionedPubkeys(rumor: Rumor): PubkeyHex[] {
  const peer = rumor.tags.find((t) => t[0] === "to")?.[1];
  return rumor.tags.filter((t) => t[0] === "p" && typeof t[1] === "string" && t[1] !== peer).map((t) => t[1]!);
}

/** 該 rumor 是否提及某公鑰。 */
export function isMentioned(rumor: Rumor, pubkey: PubkeyHex): boolean {
  return mentionedPubkeys(rumor).includes(pubkey);
}
