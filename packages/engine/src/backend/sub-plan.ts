// 訂閱計畫（P3／ADR-0293 §2.1、ADR-0294 §4）：讓「這個 kind 會不會在中繼上累積、
// 要怎麼續取」成為**訂閱宣告的一部分**，而不是每個 filter 各自記得加的慣例。
//
// ## 為什麼需要這一層
//
// 後端一次 `subscribe("all", filters)` 混了 13 組用途（心跳／收件匣／快照／信令／
// 檔案塊／名冊…）。續取策略靠寫的人記得加 `since`——**P1 就是這樣漏掉的**：
// FILE_WRAP 是 13 組裡唯二「會累積的儲存型 kind」，卻是唯一沒有水位的一條。
//
// 只補那一條是治標。下一個累積型 kind 加進來時，同樣會漏。
// 這裡把它變成**宣告時的必填項**：累積型 kind 沒宣告續取策略就直接爆，
// 而 `sub-plan.test.ts` 會在 CI 先抓到。
//
// （White Noise 因為同一個問題把單一 client 拆成四個 relay plane；我們不必走到那麼遠——
// 我們的每則 Gift Wrap 自足，需要的只是把策略從慣例變成契約。）

import type { Filter } from "@cinderous/core";

/**
 * 這個 kind 會在中繼上**累積**嗎（＝同一作者可以有無限多顆，中繼不會自動取代）。
 *
 * 依 NIP-01 的 kind 區間判定，**不是**手維護的名單——手維護的名單會漏，
 * 而漏掉的後果正是 P1。
 *
 * | 區間 | 類別 | 累積 |
 * | `0`、`3` | replaceable（歷史特例） | 否 |
 * | `1`–`9999` | regular | **是** |
 * | `10000`–`19999` | replaceable（每作者一顆） | 否 |
 * | `20000`–`29999` | ephemeral（中繼不存） | 否 |
 * | `30000`–`39999` | addressable（每 `(作者,d)` 一顆） | 否 |
 * | `40000`+ | 未分類 → **保守視為累積** | 是 |
 */
export function isAccumulatingKind(kind: number): boolean {
  if (kind === 0 || kind === 3) return false;
  if (kind >= 10000 && kind < 40000) return false;
  return true;
}

/**
 * 續取策略。**累積型 kind 必須明確選一個**，不得留白。
 *
 * - 函式：以水位做增量抓取（回 `{}` 代表這座中繼還沒有水位 → 本輪全量）。
 * - `"full"`：刻意每次全量。**必須在宣告處寫明理由**——這是個可以是對的選擇
 *   （例如量小、或去重成本低於漏抓風險），但不能是「忘了想」。
 * - `"n/a"`：非累積型才可用（ephemeral／replaceable／addressable 天然只有一顆或不留存）。
 */
export type ResumeStrategy = "n/a" | "full" | ((url: string | undefined) => { since?: number });

/** 一組訂閱宣告：filter ＋ 它的續取策略。 */
export interface SubDecl {
  filter: Filter;
  resume: ResumeStrategy;
}

/** 宣告一組訂閱。純粹是個具名建構子，讓呼叫端讀起來是「filter ＋ 策略」而非裸物件。 */
export function sub(filter: Filter, resume: ResumeStrategy): SubDecl {
  return { filter, resume };
}

/**
 * 檢查一組宣告是否合法；回傳違規訊息（空陣列＝合法）。
 *
 * 分成「檢查」與「建構」兩支，是為了讓測試能列舉全部違規，
 * 而不是被第一個 throw 打斷。
 */
export function violations(decls: readonly SubDecl[]): string[] {
  const out: string[] = [];
  for (const d of decls) {
    const kinds = d.filter.kinds ?? [];
    const acc = kinds.filter(isAccumulatingKind);
    if (acc.length > 0 && d.resume === "n/a") {
      out.push(`kind ${acc.join(",")} 會在中繼上累積，必須宣告續取策略（水位函式或明確的 "full"）`);
    }
    if (acc.length === 0 && typeof d.resume === "function") {
      // 不是錯誤，但是個訊號：對不累積的 kind 套水位沒有意義，通常代表誤解了那個 kind。
      out.push(`kind ${kinds.join(",")} 不會累積，卻掛了水位函式——水位對它沒有作用`);
    }
  }
  return out;
}

/**
 * 把宣告攤成實際要送出的 `Filter[]`，並套用續取策略。
 *
 * **違規直接丟**：那是程式錯誤（新增了累積型 kind 卻沒想續取），
 * 與 ADR-0122「大聲失敗，不靜默」同一個立場。CI 的 `sub-plan.test.ts` 會先抓到。
 */
export function planFilters(decls: readonly SubDecl[], url: string | undefined): Filter[] {
  const bad = violations(decls);
  if (bad.length > 0) throw new Error(`訂閱宣告不合法（P3）：\n- ${bad.join("\n- ")}`);
  return decls.map((d) => (typeof d.resume === "function" ? { ...d.filter, ...d.resume(url) } : d.filter));
}
