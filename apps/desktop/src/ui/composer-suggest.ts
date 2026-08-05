// Composer 建議聚合（ADR-0308）：把四種「輸入即建議」比對收斂成**單一**判別聯集。
//
// 過去主 composer 與串內回覆各自維護建議狀態且能力不同（串內少了短碼與觸發字），
// 三種比對又各自渲染一列 bar、各自佔一段鍵盤分支。這裡定下固定優先序、同時只回一個建議，
// 讓兩個 composer（與 ADR-0309 的斜線指令）共用同一條路徑。
//
// 純函式、零 React 依賴。比對全在本機已解密的草稿上進行，不外送（同 `calc.ts`／`date-detect.ts`）。

import {
  activeEmojiQuery,
  suggestMentions,
  suggestSlash,
  type MentionCandidate,
  type MentionSuggest,
  type SlashCommand,
  type SlashSuggest,
} from "@cinderous/core";
import type { CustomSticker } from "./sticker-library.js";
import { matchTriggers, type TriggerEntry, type TriggerIndex, type TriggerMatch } from "./sticker-triggers.js";

/** 短碼建議列上限（沿用既有行為）。 */
export const EMOJI_SUGGEST_MAX = 8;

export interface SuggestContext {
  /** 草稿全文（游標視為在結尾——沿用既有三個比對器的慣例）。 */
  text: string;
  mentionCandidates?: MentionCandidate[];
  emojiLibrary?: CustomSticker[];
  slashCommands?: SlashCommand[];
  triggers?: TriggerEntry[];
  triggerIndex?: TriggerIndex;
  /** 觸發字指向的貼圖是否還在（懸空參照不顯示，ADR-0037）。 */
  triggerResolvable?: (m: TriggerMatch) => boolean;
  /**
   * 企業政策停用貼圖／自訂 emoji（ADR-0048）：短碼補全**與貼圖觸發字**都不建議（ADR-0310）。
   * 觸發字資料本身不動——政策解除即完全恢復。
   */
  stickersDisabled?: boolean;
  /** 已按 Esc 關閉（至下次輸入變化）。 */
  dismissed?: boolean;
}

export type ActiveSuggest =
  | { kind: "mention"; mention: MentionSuggest; items: MentionCandidate[] }
  | { kind: "emoji"; start: number; items: CustomSticker[] }
  | { kind: "slash"; slash: SlashSuggest; items: SlashCommand[] }
  | { kind: "trigger"; items: TriggerMatch[] };

/**
 * 依固定優先序取出**單一**進行中的建議：
 * `@提及` → `:短碼` → 斜線 → 貼圖觸發字。無命中回 null。
 */
export function activeSuggest(ctx: SuggestContext): ActiveSuggest | null {
  if (ctx.dismissed) return null;
  const { text } = ctx;

  const men = ctx.mentionCandidates ? suggestMentions(text, ctx.mentionCandidates) : null;
  if (men) return { kind: "mention", mention: men, items: men.candidates };

  if (!ctx.stickersDisabled) {
    const eq = activeEmojiQuery(text);
    if (eq) {
      const q = eq.query.toLowerCase();
      const items = (ctx.emojiLibrary ?? [])
        .filter((a) => a.shortcode !== undefined && a.shortcode.toLowerCase().startsWith(q))
        .slice(0, EMOJI_SUGGEST_MAX);
      if (items.length > 0) return { kind: "emoji", start: eq.start, items };
    }
  }

  const slash = ctx.slashCommands?.length ? suggestSlash(text, ctx.slashCommands) : null;
  if (slash) return { kind: "slash", slash, items: slash.commands };

  // ADR-0310：觸發字與短碼補全同一個政策閘門——接受觸發字＝送出一則貼圖訊息，
  // 政策說要藏的動作不能還留著一條鍵盤捷徑。
  if (!ctx.stickersDisabled && ctx.triggers?.length) {
    const resolvable = ctx.triggerResolvable ?? (() => true);
    const items = matchTriggers(text, ctx.triggers, ctx.triggerIndex).filter(resolvable);
    if (items.length > 0) return { kind: "trigger", items };
  }

  return null;
}

/** 候選數（無建議＝0）。 */
export function suggestCount(s: ActiveSuggest | null): number {
  return s ? s.items.length : 0;
}

/**
 * 這列建議可否用 Enter 接受。
 * 貼圖觸發字「接受即送出訊息」＝不可逆，維持 ADR-0037 的 Tab-only。
 */
export function suggestAcceptOnEnter(s: ActiveSuggest | null): boolean {
  return s !== null && s.kind !== "trigger";
}

/** 把選取索引夾在有效範圍（候選變少時不越界）。 */
export function clampSel(sel: number, len: number): number {
  return Math.min(sel, Math.max(len - 1, 0));
}

/** 環狀移動選取索引。 */
export function moveSel(sel: number, delta: number, len: number): number {
  return len === 0 ? 0 : (sel + delta + len) % len;
}
