// 通話鈴聲（M8）：以 Web Audio 產生循環鈴響，無外部音檔（符合離線/CSP）。
//
// - 來電鈴聲（incoming）：短雙響 + 停頓（響-停-響-長停）。
// - 外撥回鈴音（ringback）：長單響 + 長停頓，模擬「等待對方接聽」的回鈴，音色/節拍與來電有別。
// 節拍為純函式（可測）；實際發聲的 Ringer 以 AudioContext 播放（瀏覽器限定，薄封裝）。

/** 來電雙音鈴聲頻率（經典電話鈴的和聲近似）。 */
export const RING_FREQ_A = 440;
export const RING_FREQ_B = 480;
/** 外撥回鈴音頻率（較低單音，與來電有別）。 */
export const RINGBACK_FREQ = 420;

/** 一個鈴響週期的節拍：on＝發聲、off＝停頓，循環播放。 */
export interface RingStep {
  on: boolean;
  ms: number;
}

/** 來電鈴響週期（響 0.4s、停 0.2s、響 0.4s、長停 2s）。 */
export function ringCycle(): RingStep[] {
  return [
    { on: true, ms: 400 },
    { on: false, ms: 200 },
    { on: true, ms: 400 },
    { on: false, ms: 2000 },
  ];
}

/** 外撥回鈴音週期（響 1s、停 3s；等待對方接聽的長回鈴）。 */
export function ringbackCycle(): RingStep[] {
  return [
    { on: true, ms: 1000 },
    { on: false, ms: 3000 },
  ];
}

/** 週期總長（毫秒）。 */
export function cycleDurationMs(steps: RingStep[]): number {
  return steps.reduce((sum, s) => sum + s.ms, 0);
}

/** 播放循環鈴聲的介面（供 App 於通話狀態變化時啟停）。 */
export interface Ringer {
  start(): void;
  stop(): void;
}

type AudioCtor = { new (): AudioContext };

function resolveCtor(ctor?: AudioCtor): AudioCtor | undefined {
  return (
    ctor ??
    (typeof AudioContext !== "undefined"
      ? AudioContext
      : (typeof globalThis !== "undefined" && (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext) ||
        undefined)
  );
}

/**
 * 建立以 Web Audio 播放的循環鈴聲。無 AudioContext（測試/不支援）時回傳 no-op Ringer。
 * `cycle` 為節拍、`freqs` 為和聲頻率；`ctor` 可注入以利測試。
 */
function makeRinger(cycle: RingStep[], freqs: number[], ctor?: AudioCtor): Ringer {
  const Ctor = resolveCtor(ctor);
  if (!Ctor) return { start() {}, stop() {} };

  const period = cycleDurationMs(cycle);
  let ctx: AudioContext | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let looping = false;

  const beep = (durationMs: number): void => {
    if (!ctx) return;
    const now = ctx.currentTime;
    const end = now + durationMs / 1000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.setValueAtTime(0.15, end - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(ctx.destination);
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now);
      osc.stop(end);
    }
  };

  const playCycle = (): void => {
    let offset = 0;
    for (const step of cycle) {
      if (step.on) {
        const at = offset;
        timers.push(setTimeout(() => beep(step.ms), at));
      }
      offset += step.ms;
    }
  };

  return {
    start() {
      if (looping) return;
      looping = true;
      try {
        ctx = new Ctor();
        void ctx.resume?.();
      } catch {
        looping = false;
        return;
      }
      playCycle();
      timers.push(setInterval(playCycle, period) as unknown as ReturnType<typeof setTimeout>);
    },
    stop() {
      looping = false;
      for (const tt of timers) {
        clearTimeout(tt);
        clearInterval(tt as unknown as ReturnType<typeof setInterval>);
      }
      timers = [];
      if (ctx) {
        void ctx.close?.();
        ctx = null;
      }
    },
  };
}

/** 來電鈴聲（短雙響）。 */
export function createRinger(ctor?: AudioCtor): Ringer {
  return makeRinger(ringCycle(), [RING_FREQ_A, RING_FREQ_B], ctor);
}

/** 外撥回鈴音（長單響，等待對方接聽）。 */
export function createRingback(ctor?: AudioCtor): Ringer {
  return makeRinger(ringbackCycle(), [RINGBACK_FREQ], ctor);
}
