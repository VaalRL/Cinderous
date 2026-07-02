import { KIND } from "./constants.js";
import { createEphemeralEvent } from "./ephemeral.js";
import type { NostrEvent } from "./event.js";
import type { SecretKey } from "./keys.js";

export interface HeartbeatOptions {
  /** Unix 秒；省略時填入現在。 */
  created_at?: number;
  /** 可選狀態字串（如正在聆聽音樂）；省略時 content 為空。 */
  status?: string;
}

/** 建立一筆已簽章的 Kind 20000 心跳事件（Ephemeral）。 */
export function createHeartbeat(sk: SecretKey, opts: HeartbeatOptions = {}): NostrEvent {
  return createEphemeralEvent(sk, KIND.HEARTBEAT, {
    created_at: opts.created_at,
    content: opts.status ?? "",
  });
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
