// 行事曆視圖純邏輯（ADR-0269）。時間全用固定 unix 秒，避免依賴當下時鐘。
import { describe, expect, it } from "vitest";
import type { StoredCalendarEvent } from "@cinderous/engine";
import { addDays, addMonths, CAL_VIEWS, dayCell, listEvents, monthGrid, weekGrid } from "./calendar-view.js";

// 以本機時區建構「某年某月某日 hh:mm」的 unix 秒（測試與被測同一時區，跨機一致）。
const at = (y: number, mo: number, d: number, h = 12): number =>
  Math.floor(new Date(y, mo - 1, d, h).getTime() / 1000);

const ev = (id: string, start: number, end?: number): StoredCalendarEvent =>
  ({ id, title: id, organizer: "me", start, ...(end !== undefined ? { end } : {}) }) as StoredCalendarEvent;

describe("calendar-view（ADR-0269）", () => {
  it("四視圖常數齊備", () => {
    expect(CAL_VIEWS).toEqual(["month", "week", "day", "list"]);
  });

  it("addDays／addMonths：本機時區平移；月底夾限（1/31 +1 月＝2/28|29）", () => {
    expect(new Date(addDays(at(2026, 3, 10), 5) * 1000).getDate()).toBe(15);
    const feb = new Date(addMonths(at(2026, 1, 31), 1) * 1000);
    expect(feb.getMonth()).toBe(1); // 2 月（0-indexed）
    expect(feb.getDate()).toBe(28); // 2026 非閏年 → 夾到 28，不溢位成 3/3
  });

  it("monthGrid：每列完整一週（總格數為 7 的倍數）、含當月全部日期、標記 inMonth/isToday", () => {
    const focus = at(2026, 8, 15); // 2026-08
    const now = at(2026, 8, 20);
    const grid = monthGrid(focus, [], now, 0);
    expect(grid.length % 7).toBe(0);
    const inMonth = grid.filter((c) => c.inMonth);
    expect(inMonth.length).toBe(31); // 八月 31 天全在
    expect(inMonth[0]!.date).toBe(1);
    expect(inMonth.at(-1)!.date).toBe(31);
    expect(grid.filter((c) => c.isToday).length).toBe(1); // 只有一格今天
    expect(grid.find((c) => c.isToday)!.date).toBe(20);
  });

  it("monthGrid：行程分到正確日格；跨日行程同時出現在起訖兩天", () => {
    const start = at(2026, 8, 10, 22);
    const spanning = ev("overnight", start, addDays(start, 1) + 3600); // 8/10 22:00 → 8/11 23:00
    const single = ev("lunch", at(2026, 8, 12, 12));
    const grid = monthGrid(at(2026, 8, 1), [spanning, single], at(2026, 8, 1), 0);
    const day10 = grid.find((c) => c.inMonth && c.date === 10)!;
    const day11 = grid.find((c) => c.inMonth && c.date === 11)!;
    const day12 = grid.find((c) => c.inMonth && c.date === 12)!;
    expect(day10.events.map((e) => e.id)).toEqual(["overnight"]);
    expect(day11.events.map((e) => e.id)).toEqual(["overnight"]); // 跨日 → 兩天都在
    expect(day12.events.map((e) => e.id)).toEqual(["lunch"]);
  });

  it("weekGrid：7 格、含 focus 當天、週起日可設", () => {
    const focus = at(2026, 8, 19); // 週三
    const wSun = weekGrid(focus, [], focus, 0);
    expect(wSun.length).toBe(7);
    expect(new Date(wSun[0]!.startSec * 1000).getDay()).toBe(0); // 週日起
    expect(wSun.some((c) => c.startSec === weekGrid(focus, [], focus, 0).find((x) => x.date === 19)?.startSec)).toBe(true);
    const wMon = weekGrid(focus, [], focus, 1);
    expect(new Date(wMon[0]!.startSec * 1000).getDay()).toBe(1); // 週一起
  });

  it("dayCell：單日、只含當天行程", () => {
    const focus = at(2026, 8, 12);
    const cell = dayCell(focus, [ev("a", at(2026, 8, 12, 9)), ev("b", at(2026, 8, 13, 9))], focus);
    expect(cell.date).toBe(12);
    expect(cell.events.map((e) => e.id)).toEqual(["a"]);
  });

  it("listEvents：依 start 排序（過去在前）", () => {
    const out = listEvents([ev("late", at(2026, 8, 20)), ev("early", at(2026, 8, 1))]);
    expect(out.map((e) => e.id)).toEqual(["early", "late"]);
  });
});
