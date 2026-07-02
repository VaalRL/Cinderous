import type { Status } from "../backend/types.js";

/**
 * 閒置自動「離開」的純狀態機（無 DOM／計時器依賴，方便單元測試）。
 *
 * 規則（貼近 MSN）：
 * - 僅在使用者「手動狀態為 online」時，閒置逾時才自動切為 away。
 * - 自動離開期間一偵測到活動，立即還原成使用者的手動狀態。
 * - 使用者手動改狀態（busy／offline／away…）永遠優先，不會被自動邏輯覆蓋。
 */

/** 預設閒置門檻：5 分鐘無活動即自動離開。 */
export const DEFAULT_IDLE_MS = 5 * 60_000;

export interface IdleState {
  /** 使用者最後一次「手動」選定的狀態（自動邏輯以此為還原目標）。 */
  manual: Status;
  /** 目前是否處於「自動離開」。 */
  auto: boolean;
  /** 最後一次活動時間（ms）。 */
  lastActivity: number;
}

export type IdleEvent =
  | { type: "activity"; at: number }
  | { type: "tick"; at: number }
  | { type: "manual"; status: Status; at: number };

export interface IdleResult {
  state: IdleState;
  /** 需要套用到後端／UI 的新狀態；null 表示不變。 */
  setStatus: Status | null;
}

export function initIdle(now: number, manual: Status = "online"): IdleState {
  return { manual, auto: false, lastActivity: now };
}

export function reduceIdle(state: IdleState, ev: IdleEvent, idleMs: number = DEFAULT_IDLE_MS): IdleResult {
  switch (ev.type) {
    case "manual":
      // 手動狀態為新的真實來源；取消自動離開追蹤（UI 端已自行套用，故不重複 setStatus）
      return { state: { manual: ev.status, auto: false, lastActivity: ev.at }, setStatus: null };

    case "activity": {
      const next: IdleState = { ...state, lastActivity: ev.at };
      if (state.auto) {
        // 自動離開中偵測到活動 → 還原成手動狀態
        return { state: { ...next, auto: false }, setStatus: state.manual };
      }
      return { state: next, setStatus: null };
    }

    case "tick": {
      if (!state.auto && state.manual === "online" && ev.at - state.lastActivity >= idleMs) {
        return { state: { ...state, auto: true }, setStatus: "away" };
      }
      return { state, setStatus: null };
    }
  }
}
