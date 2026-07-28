// 行事曆視圖純邏輯（ADR-0269）：月/週/日/清單四視圖的日期計算與行程分桶。
// 純函式、無 DOM、本機時區（用 Date 的本地方法，不碰 UTC）——可測、與 UI 分離。
import type { StoredCalendarEvent } from "@cinderous/engine";

export type CalView = "month" | "week" | "day" | "list";
export const CAL_VIEWS: readonly CalView[] = ["month", "week", "day", "list"] as const;

/** 一格日期（月/週視圖的格子、日視圖的單日）。 */
export interface DayCell {
  /** 該日 00:00 的 unix 秒（本機時區）。 */
  startSec: number;
  /** 幾號（1–31）。 */
  date: number;
  /** 是否屬於當前聚焦的月份（月視圖的前後補格＝false，淡化顯示）。 */
  inMonth: boolean;
  /** 是否為今天。 */
  isToday: boolean;
  /** 落在這一天的行程（依開始時間排序）。 */
  events: StoredCalendarEvent[];
}

/** 本機時區的當日 00:00（unix 秒）。 */
function startOfDay(sec: number): number {
  const d = new Date(sec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** 平移 n 天（本機時區、跨月/跨年由 Date 處理）。 */
export function addDays(sec: number, n: number): number {
  const d = new Date(sec * 1000);
  d.setDate(d.getDate() + n);
  return Math.floor(d.getTime() / 1000);
}

/** 平移 n 個月（聚焦月份切換用；日期夾到月底避免溢位，如 1/31 +1 個月＝2/28）。 */
export function addMonths(sec: number, n: number): number {
  const d = new Date(sec * 1000);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** 行程是否落在某一天（跨日行程只要與該日有交集即算；本機時區）。 */
function eventOnDay(e: StoredCalendarEvent, dayStart: number): boolean {
  const dayEnd = addDays(dayStart, 1);
  const evStart = e.start;
  const evEnd = e.end ?? e.start;
  return evStart < dayEnd && evEnd >= dayStart;
}

/** 把行程分到各日格（每格內依 start 排序）。 */
function fillEvents(cells: Omit<DayCell, "events">[], events: StoredCalendarEvent[]): DayCell[] {
  return cells.map((c) => ({
    ...c,
    events: events.filter((e) => eventOnDay(e, c.startSec)).sort((a, b) => a.start - b.start),
  }));
}

function baseCell(startSec: number, focusMonth: number, todayStart: number): Omit<DayCell, "events"> {
  const d = new Date(startSec * 1000);
  return { startSec, date: d.getDate(), inMonth: d.getMonth() === focusMonth, isToday: startSec === todayStart };
}

/**
 * 月視圖格陣（含前後補格湊滿整週）。`weekStartsOn`＝0 週日、1 週一（預設 0）。
 * 回傳 6×7＝42 或 5×7＝35 格，保證每列完整一週。
 */
export function monthGrid(
  focusSec: number,
  events: StoredCalendarEvent[],
  nowSec: number,
  weekStartsOn: 0 | 1 = 0,
): DayCell[] {
  const focus = new Date(focusSec * 1000);
  const focusMonth = focus.getMonth();
  const todayStart = startOfDay(nowSec);
  const first = new Date(focus.getFullYear(), focusMonth, 1);
  const firstSec = Math.floor(new Date(first.getFullYear(), first.getMonth(), 1).getTime() / 1000);
  // 回捲到該週開頭。
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const gridStart = addDays(firstSec, -lead);
  // 到月底、再補到整週。
  const daysInMonth = new Date(focus.getFullYear(), focusMonth + 1, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => baseCell(addDays(gridStart, i), focusMonth, todayStart));
  return fillEvents(cells, events);
}

/** 週視圖：含 focus 那天的整週 7 格。 */
export function weekGrid(
  focusSec: number,
  events: StoredCalendarEvent[],
  nowSec: number,
  weekStartsOn: 0 | 1 = 0,
): DayCell[] {
  const focusStart = startOfDay(focusSec);
  const focusMonth = new Date(focusStart * 1000).getMonth();
  const todayStart = startOfDay(nowSec);
  const dow = new Date(focusStart * 1000).getDay();
  const weekStart = addDays(focusStart, -((dow - weekStartsOn + 7) % 7));
  const cells = Array.from({ length: 7 }, (_, i) => baseCell(addDays(weekStart, i), focusMonth, todayStart));
  return fillEvents(cells, events);
}

/** 日視圖：單日一格。 */
export function dayCell(focusSec: number, events: StoredCalendarEvent[], nowSec: number): DayCell {
  const focusStart = startOfDay(focusSec);
  const focusMonth = new Date(focusStart * 1000).getMonth();
  const todayStart = startOfDay(nowSec);
  return fillEvents([baseCell(focusStart, focusMonth, todayStart)], events)[0]!;
}

/** 清單視圖：所有行程依 start 排序（過去在前、未來在後，與既有面板一致）。 */
export function listEvents(events: StoredCalendarEvent[]): StoredCalendarEvent[] {
  return [...events].sort((a, b) => a.start - b.start);
}
