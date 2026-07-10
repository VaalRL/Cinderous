import { describe, expect, it, vi } from "vitest";
import { createRinger, createRingback, cycleDurationMs, playChime, ringbackCycle, ringCycle } from "./ringtone.js";

describe("ringtone 節拍（M8）", () => {
  it("來電鈴響週期為 響-停-響-長停", () => {
    expect(ringCycle().map((s) => s.on)).toEqual([true, false, true, false]);
  });

  it("來電週期總長 3 秒", () => {
    expect(cycleDurationMs(ringCycle())).toBe(3000);
  });

  it("外撥回鈴音為 響-長停（與來電節拍有別）", () => {
    expect(ringbackCycle().map((s) => s.on)).toEqual([true, false]);
    expect(cycleDurationMs(ringbackCycle())).toBe(4000);
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

  it("createRingback 亦以注入 AudioContext 發聲", () => {
    vi.useFakeTimers();
    const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    const FakeCtx = vi.fn().mockImplementation(() => ({
      currentTime: 0,
      createOscillator: () => osc,
      createGain: () => gain,
      resume: vi.fn(),
      close: vi.fn(),
      destination: {},
    })) as unknown as { new (): AudioContext };

    const r = createRingback(FakeCtx);
    r.start();
    vi.advanceTimersByTime(10);
    expect(osc.start).toHaveBeenCalled();
    r.stop();
    vi.useRealTimers();
  });
});

describe("playChime 通知提示音（ADR-0076）", () => {
  it("無 AudioContext 時安全 no-op（不丟例外）", () => {
    expect(() => playChime()).not.toThrow(); // 測試環境無 AudioContext
  });

  it("以注入的 AudioContext 發一次上行雙音、排程關閉", () => {
    vi.useFakeTimers();
    const osc = {
      type: "",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    const close = vi.fn();
    const FakeCtx = vi.fn().mockImplementation(() => ({
      currentTime: 0,
      createOscillator: () => osc,
      createGain: () => gain,
      resume: vi.fn(),
      close,
      destination: {},
    })) as unknown as { new (): AudioContext };

    playChime(FakeCtx);
    expect(osc.start).toHaveBeenCalledTimes(1);
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledTimes(2); // 起音＋中段上行
    vi.advanceTimersByTime(500);
    expect(close).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
