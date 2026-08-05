// 共享行程這一簇（ADR-0331／Phase P4 階段 1，第 4 簇）。
//
// 2 個 state：這個身分的全部行程（ADR-0263／0265），以及點日期標記後的預填草稿（ADR-0264 階段四）。
//
// ## 草稿為什麼帶著 `convo`
//
// 對話畫面以 `key={activeId}` 重掛——**但這一層的 state 不會**。草稿若只記 `{at, nonce}`，
// 換到另一個對話再回來，就會冒出上一個對話的預填表單。
//
// 🔴 那正是 Phase P4 在對付的同一種錯，只是粒度不同（那邊是「換身分」，這邊是「換對話」）。
// 所以這裡不把「比對 convo」留給呼叫端自己記得寫——`draftFor(convo)` 把它包進 API 裡，
// **拿錯對話的草稿這件事在型別上就做不到**。
//
// `reset()` 是純歸零：行程隨後端 `onCalendar` 重新灌入，草稿本來就是 session 內的東西。

import { useState } from "react";
import type { StoredCalendarEvent } from "@cinderous/engine";

/** 點日期標記後的預填（ADR-0264 階段四）。`nonce` 讓同一天可以再點一次、重新開表單。 */
export interface CalendarDraft {
  convo: string;
  at: number;
  nonce: number;
}

export interface CalendarSession {
  /** 這個身分的全部行程；交給對話畫面前才依 `activeId` 篩。 */
  events: StoredCalendarEvent[];
  /** 後端 `onCalendar`。 */
  setEvents(list: StoredCalendarEvent[]): void;
  /** 某個對話的行程。 */
  eventsFor(convo: string): StoredCalendarEvent[];
  /** 點了某對話裡的日期標記。 */
  pickDate(convo: string, at: number, nonce: number): void;
  /**
   * 某對話的預填草稿；**不是這個對話的就回 undefined**。
   * 見檔頭：把比對包進來，呼叫端無從拿錯。
   */
  draftFor(convo: string): { at: number; nonce: number } | undefined;
}

export function useCalendarSession(): CalendarSession {
  const [events, setEvents] = useState<StoredCalendarEvent[]>([]);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);

  return {
    events,
    setEvents,
    eventsFor: (convo) => events.filter((e) => e.groupId === convo || e.contact === convo),
    pickDate: (convo, at, nonce) => setDraft({ convo, at, nonce }),
    draftFor: (convo) => (draft?.convo === convo ? { at: draft.at, nonce: draft.nonce } : undefined),
  };
}
