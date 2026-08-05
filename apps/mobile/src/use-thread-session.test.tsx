// @vitest-environment jsdom
// 對話簇（ADR-0331 第 6 簇 b）。
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { useThreadSession, type ThreadSession } from "./use-thread-session.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function hook(): { get: () => ThreadSession } {
  let latest: ThreadSession;
  function Probe(): null {
    latest = useThreadSession();
    return null;
  }
  const el = document.createElement("div");
  act(() => createRoot(el).render(<Probe />));
  return { get: () => latest };
}

describe("對話簇（ADR-0331）", () => {
  it("開／關對話", () => {
    const h = hook();
    act(() => h.get().open("bob"));
    expect(h.get().activeId).toBe("bob");
    act(() => h.get().close());
    expect(h.get().activeId).toBeNull();
  });

  it("🔴 「正在輸入」自動逾時——沒有逾時它會永遠掛在那裡", () => {
    vi.useFakeTimers();
    const h = hook();
    act(() => h.get().markTyping("bob"));
    expect(h.get().typingFrom).toBe("bob");
    act(() => vi.advanceTimersByTime(6000));
    expect(h.get().typingFrom).toBeNull();
    vi.useRealTimers();
  });

  it("🔴 新訊號延後逾時，不是各自倒數（只留最近一位）", () => {
    vi.useFakeTimers();
    const h = hook();
    act(() => h.get().markTyping("bob"));
    act(() => vi.advanceTimersByTime(4000));
    act(() => h.get().markTyping("amy"));
    act(() => vi.advanceTimersByTime(4000)); // 距 bob 已 8 秒，但 amy 才 4 秒
    expect(h.get().typingFrom).toBe("amy");
    vi.useRealTimers();
  });

});
