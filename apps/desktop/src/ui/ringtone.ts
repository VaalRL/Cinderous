// 通話鈴聲（M8）：以 Web Audio 產生循環鈴響，無外部音檔（符合離線/CSP）。
//
// - 來電鈴聲（incoming）：短雙響 + 停頓（響-停-響-長停）。
// - 外撥回鈴音（ringback）：長單響 + 長停頓，模擬「等待對方接聽」的回鈴，音色/節拍與來電有別。
// 節拍為純函式（可測）；實際發聲的 Ringer 以 AudioContext 播放（瀏覽器限定，薄封裝）。

import type { MessageKey } from "@cinder/i18n";

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

/** 通知提示音頻率（上行「叮咚」兩音）。 */
export const CHIME_FREQ_LOW = 880;
export const CHIME_FREQ_HIGH = 1174;

/** 預設集中的一顆音符：`at`/`dur` 為秒；`glide` 設定時於音長中點切至該頻率（叮咚式滑音）。 */
export interface ChimeNote {
  freq: number;
  at: number;
  dur: number;
  glide?: number;
}

/** 通知音效預設（ADR-0149）：純資料配方，由 `playChime` 以 Web Audio 合成，無外部音檔。 */
export interface ChimePreset {
  id: string;
  /** i18n 顯示名鍵（型別鎖住 Messages，避免鍵漏加）。 */
  nameKey: MessageKey;
  notes: ChimeNote[];
}

/**
 * 內建通知音效預設集（ADR-0149）。
 * 全部為合成配方——零資產、離線/CSP 相容，可測（純資料）。
 */
export const CHIME_PRESETS: ChimePreset[] = [
  // 經典叮咚（ADR-0076 原音色）：上行兩音。
  { id: "classic", nameKey: "chime_classic", notes: [{ freq: CHIME_FREQ_LOW, at: 0, dur: 0.2, glide: CHIME_FREQ_HIGH }] },
  // 咚叮：下行兩音，與經典相反。
  { id: "descend", nameKey: "chime_descend", notes: [{ freq: CHIME_FREQ_HIGH, at: 0, dur: 0.2, glide: CHIME_FREQ_LOW }] },
  // 三連音：短-短-揚。
  {
    id: "triple",
    nameKey: "chime_triple",
    notes: [
      { freq: 988, at: 0, dur: 0.08 },
      { freq: 988, at: 0.12, dur: 0.08 },
      { freq: 1319, at: 0.24, dur: 0.14 },
    ],
  },
  // 鐘聲：低音單響、餘韻較長。
  { id: "bell", nameKey: "chime_bell", notes: [{ freq: 523, at: 0, dur: 0.4 }] },
  // 水滴：高音急落。
  {
    id: "drop",
    nameKey: "chime_drop",
    notes: [
      { freq: 1760, at: 0, dur: 0.06 },
      { freq: 1175, at: 0.08, dur: 0.14 },
    ],
  },
  // 叩叩：低音兩短響。
  {
    id: "knock",
    nameKey: "chime_knock",
    notes: [
      { freq: 220, at: 0, dur: 0.06 },
      { freq: 220, at: 0.14, dur: 0.06 },
    ],
  },
];

/** 預設音效 id（未設定/設定損壞時的後備）。 */
export const DEFAULT_CHIME_ID = "classic";

/** 依 id 取預設；未給或查無（例如舊設定指向已移除的 id）一律退回 classic，確保永遠發得出聲。 */
export function chimePreset(id?: string): ChimePreset {
  return CHIME_PRESETS.find((p) => p.id === id) ?? CHIME_PRESETS.find((p) => p.id === DEFAULT_CHIME_ID)!;
}

/** 整段音效的長度（毫秒）＝最後一顆音符結束時刻，供關閉 AudioContext 排程。 */
export function chimeDurationMs(preset: ChimePreset): number {
  return Math.ceil(Math.max(...preset.notes.map((n) => n.at + n.dur)) * 1000);
}

/**
 * 一次性通知提示音（ADR-0076／0149）：以 Web Audio 合成指定預設（`preset` 為 id，
 * 未給/未知退回經典叮咚），無外部音檔（離線/CSP 相容）。
 * 無 AudioContext（測試/不支援）時安全 no-op。`ctor` 可注入以利測試。
 */
export function playChime(preset?: string, ctor?: AudioCtor): void {
  const Ctor = resolveCtor(ctor);
  if (!Ctor) return;
  const recipe = chimePreset(preset);
  try {
    const ctx = new Ctor();
    void ctx.resume?.();
    const now = ctx.currentTime;
    for (const note of recipe.notes) {
      const start = now + note.at;
      const end = start + note.dur;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, start);
      if (note.glide) osc.frequency.setValueAtTime(note.glide, start + note.dur / 2); // 中點滑音（叮咚）
      osc.connect(gain);
      osc.start(start);
      osc.stop(end);
    }
    setTimeout(() => void ctx.close?.(), chimeDurationMs(recipe) + 50);
  } catch {
    /* 忽略發聲失敗 */
  }
}
