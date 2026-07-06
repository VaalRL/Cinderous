import { describe, expect, it, vi } from "vitest";
import { createRinger, cycleDurationMs, ringCycle } from "./ringtone.js";

describe("ringtone 節拍（M8）", () => {
  it("鈴響週期為 響-停-響-長停", () => {
    expect(ringCycle().map((s) => s.on)).toEqual([true, false, true, false]);
  });

  it("週期總長 3 秒", () => {
    expect(cycleDurationMs(ringCycle())).toBe(3000);
  });
});

describe("createRinger", () => {
  it("無 AudioContext 時回傳 no-op（不丟例外）", () => {
    const r = createRinger(); // 測試環境無 AudioContext
    expect(() => {
      r.start();
      r.stop();
    }).not.toThrow();
  });

  it("以注入的 AudioContext 啟動時建立音源、停止時關閉", () => {
    vi.useFakeTimers();
    const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const close = vi.fn();
    const FakeCtx = vi.fn().mockImplementation(() => ({
      currentTime: 0,
      createOscillator: () => osc,
      createGain: () => gain,
      resume: vi.fn(),
      close,
      destination: {},
    })) as unknown as { new (): AudioContext };

    const r = createRinger(FakeCtx);
    r.start();
    vi.advanceTimersByTime(10); // 觸發第一個 on 節拍的 beep
    expect(osc.start).toHaveBeenCalled();
    r.stop();
    expect(close).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
