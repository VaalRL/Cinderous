// 一個身分的全部 session state（ADR-0332／Phase P4 階段 2a）。
//
// 階段 1（ADR-0331）把 41 個 per-identity state 收進 6 個功能簇。這裡再把那 6 個聚合成一個
// **「一個身分的 session」**，理由不是為了少打幾個字：
//
//   1. 階段 2b 要把登入後的 UI 抽成子元件。傳 6 個 hook 物件過去，介面會隨著日後加簇而變；
//      傳 1 個 `session` 則不會。
//   2. 「什麼算一個身分的 session」目前散在 `MobileApp` 的 6 行宣告裡，沒有一個地方說得清楚。
//      放在這裡，`IdentitySession` 這個型別本身就是答案。
//   3. 階段 2c 把它掛上 `key={pubkey}` 時，**要重掛的東西恰好就是這個物件**——
//      一個 hook 呼叫，而不是六個。
//
// ⚠ 這一步**刻意不改任何語意**：只是把 6 個呼叫包成 1 個。`reset` 仍由呼叫端逐簇呼叫
// （階段 2c 才會因為 `key` 而整批消失）。
//
// 🔴 **不提供 `resetAll()`**。看起來很順手，但那會讓「切身分要做什麼」又變回一份清單——
// 而各簇的 `reset` 需要各自不同的種子（歸零／捆包精華／從後端重讀，見 ADR-0331 §7），
// 包成一個只會逼出一個什麼都收的參數物件。階段 2c 的正解是**讓它們一起消失**，不是把它們併成一行。

import { useCalendarSession, type CalendarSession } from "./use-calendar-session.js";
import { useCallSession, type CallSession } from "./use-call-session.js";
import { useIdentitySettings, type IdentitySettings } from "./use-identity-settings.js";
import { useOrgSession, type OrgSession } from "./use-org-session.js";
import { useRosterSession, type RosterSession } from "./use-roster-session.js";
import { useSelfSession, type SelfSession } from "./use-self-session.js";
import { useThreadSession, type ThreadSession } from "./use-thread-session.js";

/** 一個身分在這台裝置上的全部 session state。 */
export interface IdentitySession {
  /** 我自己：身分本體＋上線狀態＋與中繼的連線。 */
  self: SelfSession;
  /** 名冊：誰。 */
  roster: RosterSession;
  /** 對話：說了什麼、現在看著哪一則。 */
  threads: ThreadSession;
  /** 共享行程。 */
  cal: CalendarSession;
  /** 企業脈絡。 */
  org: OrgSession;
  /** 設定頁上的身分層開關。 */
  settings: IdentitySettings;
  /** 通話。 */
  call: CallSession;
}

export function useIdentitySession(): IdentitySession {
  return {
    self: useSelfSession(),
    roster: useRosterSession(),
    threads: useThreadSession(),
    cal: useCalendarSession(),
    org: useOrgSession(),
    settings: useIdentitySettings(),
    call: useCallSession(),
  };
}
