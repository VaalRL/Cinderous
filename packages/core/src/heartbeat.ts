import { KIND } from "./constants.js";
import { createEphemeralEvent } from "./ephemeral.js";
import type { NostrEvent } from "./event.js";
import type { SecretKey } from "./keys.js";

/** 心跳自報節奏的 tag 名（ADR-0109）：`["hb", "<間隔秒>"]`。 */
const CADENCE_TAG = "hb";

export interface HeartbeatOptions {
  /** Unix 秒；省略時填入現在。 */
  created_at?: number;
  /** 可選狀態字串（如正在聆聽音樂）；省略時 content 為空。 */
  status?: string;
  /**
   * 自報的心跳間隔（毫秒，ADR-0109）。觀察端據此算出容忍窗（`2.5 ×`），
   * 才不會把「在線但閒置」（5 分鐘一次）的人誤判為離線。
   *
   * **不構成新的元數據洩漏**：心跳節奏本來就能從事件時戳直接觀察出來，
   * 明寫只是把已可推得的資訊講清楚。
   */
  cadenceMs?: number;
}

/** 建立一筆已簽章的 Kind 20000 心跳事件（Ephemeral）。 */
export function createHeartbeat(sk: SecretKey, opts: HeartbeatOptions = {}): NostrEvent {
  return createEphemeralEvent(sk, KIND.HEARTBEAT, {
    created_at: opts.created_at,
    content: opts.status ?? "",
    ...(opts.cadenceMs !== undefined
      ? { tags: [[CADENCE_TAG, String(Math.round(opts.cadenceMs / 1000))]] }
      : {}),
  });
}

/** 讀出心跳自報的間隔（毫秒，ADR-0109）；未自報（舊版客戶端）回傳 undefined。 */
export function heartbeatCadenceMs(event: NostrEvent): number | undefined {
  const raw = event.tags.find((t) => t[0] === CADENCE_TAG)?.[1];
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds * 1000;
}

/**
 * 對心跳間隔加入隨機抖動（F5：分散中繼站負載尖峰、並降低精確時序可觀測性）。
 * 回傳 `base ± base*ratio` 範圍內的毫秒值（下限夾在 base 的一半，避免過於頻繁）。
 * `rand` 預設 `Math.random`，測試可注入。
 */
export function jitter(baseMs: number, ratio = 0.2, rand: () => number = Math.random): number {
  const delta = baseMs * ratio * (rand() * 2 - 1);
  return Math.max(Math.floor(baseMs / 2), Math.round(baseMs + delta));
}
