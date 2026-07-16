import { describe, expect, it, vi } from "vitest";
import {
  CHIME_PRESETS,
  DEFAULT_CHIME_ID,
  chimeDurationMs,
  chimePreset,
  createRinger,
  createRingback,
  cycleDurationMs,
  playChime,
  ringbackCycle,
  ringCycle,
} from "./ringtone.js";

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

/** 每次呼叫都產生獨立 osc/gain 的假 AudioContext，回傳可查數量的紀錄。 */
function makeFakeCtx() {
  const oscs: { type: string; frequency: { setValueAtTime: ReturnType<typeof vi.fn> }; start: ReturnType<typeof vi.fn> }[] = [];
  const close = vi.fn();
  const FakeCtx = vi.fn().mockImplementation(() => ({
    currentTime: 0,
    createOscillator: () => {
      const osc = {
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscs.push(osc);
      return osc;
    },
    createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
    resume: vi.fn(),
    close,
    destination: {},
  })) as unknown as { new (): AudioContext };
  return { FakeCtx, oscs, close };
}

describe("playChime 通知提示音（ADR-0076）", () => {
  it("無 AudioContext 時安全 no-op（不丟例外）", () => {
    expect(() => playChime()).not.toThrow(); // 測試環境無 AudioContext
  });

  it("預設（classic）以注入的 AudioContext 發一次上行雙音、排程關閉", () => {
    vi.useFakeTimers();
    const { FakeCtx, oscs, close } = makeFakeCtx();
    playChime(undefined, FakeCtx);
    expect(oscs).toHaveLength(1);
    expect(oscs[0]!.start).toHaveBeenCalledTimes(1);
    expect(oscs[0]!.frequency.setValueAtTime).toHaveBeenCalledTimes(2); // 起音＋中段上行
    vi.advanceTimersByTime(500);
    expect(close).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("通知音效預設集（ADR-0149）", () => {
  it("至少 5 種預設、id 不重複、節拍資料合法（freq>0、at>=0、dur>0）", () => {
    expect(CHIME_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = CHIME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CHIME_PRESETS) {
      expect(p.notes.length).toBeGreaterThan(0);
      for (const n of p.notes) {
        expect(n.freq).toBeGreaterThan(0);
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.dur).toBeGreaterThan(0);
      }
    }
  });

  it("chimePreset：未給/未知 id 一律退回預設 classic（設定損壞也不失聲）", () => {
    expect(chimePreset().id).toBe(DEFAULT_CHIME_ID);
    expect(chimePreset("不存在的音效").id).toBe(DEFAULT_CHIME_ID);
    expect(chimePreset("triple").id).toBe("triple");
  });

  it("chimeDurationMs＝最後一顆音符結束的時刻", () => {
    const p = chimePreset("triple");
    const lastEnd = Math.max(...p.notes.map((n) => n.at + n.dur));
    expect(chimeDurationMs(p)).toBe(Math.ceil(lastEnd * 1000));
  });

  it("playChime('triple') 每顆音符各建一個振盪器；未知 id 退回 classic 仍發聲", () => {
    vi.useFakeTimers();
    const a = makeFakeCtx();
    playChime("triple", a.FakeCtx);
    expect(a.oscs).toHaveLength(chimePreset("triple").notes.length);
    const b = makeFakeCtx();
    playChime("已被移除的預設", b.FakeCtx);
    expect(b.oscs).toHaveLength(1); // classic 單音符
    vi.advanceTimersByTime(1000);
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
