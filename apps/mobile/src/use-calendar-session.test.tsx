// @vitest-environment jsdom
// 行程簇（ADR-0331 第 4 簇）。
import { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import type { StoredCalendarEvent } from "@cinderous/engine";
import { useCalendarSession, type CalendarSession } from "./use-calendar-session.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hook(): { get: () => CalendarSession } {
  let latest: CalendarSession;
  function Probe(): null {
    latest = useCalendarSession();
    return null;
  }
  const el = document.createElement("div");
  act(() => createRoot(el).render(<Probe />));
  return { get: () => latest };
}

const ev = (id: string, over: Partial<StoredCalendarEvent>): StoredCalendarEvent =>
  ({ id, title: id, at: 1, createdAt: 1, organizer: "me", rsvps: {}, ...over }) as StoredCalendarEvent;

describe("行程簇（ADR-0331）", () => {
  it("依對話篩：1:1 看 contact、群組看 groupId", () => {
    const h = hook();
    act(() => h.get().setEvents([ev("a", { contact: "bob" }), ev("b", { groupId: "g1" }), ev("c", { contact: "amy" })]));
    expect(h.get().eventsFor("bob").map((e) => e.id)).toEqual(["a"]);
    expect(h.get().eventsFor("g1").map((e) => e.id)).toEqual(["b"]);
    expect(h.get().eventsFor("nobody")).toEqual([]);
  });

  it("🔴 草稿只屬於當初點的那個對話——換對話回來不得冒出別人的預填表單", () => {
    const h = hook();
    act(() => h.get().pickDate("bob", 1_700_000_000, 42));
    expect(h.get().draftFor("bob")).toEqual({ at: 1_700_000_000, nonce: 42 });
    expect(h.get().draftFor("amy")).toBeUndefined(); // 這正是把比對包進 API 的理由
  });

  it("再點一次同一天：`nonce` 換掉，表單會重新開", () => {
    const h = hook();
    act(() => h.get().pickDate("bob", 5, 1));
    act(() => h.get().pickDate("bob", 5, 2));
    expect(h.get().draftFor("bob")?.nonce).toBe(2);
  });

});
