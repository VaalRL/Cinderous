import { KIND, OFFLINE_TIMEOUT_MS } from "./constants.js";
import type { PubkeyHex } from "./keys.js";

/** Nostr 訂閱 filter（最小子集，足以訂閱心跳）。 */
export interface Filter {
  kinds?: number[];
  authors?: PubkeyHex[];
  since?: number;
  until?: number;
  limit?: number;
}

/** 依好友 pubkey 清單建構心跳（上線狀態）訂閱 filter。 */
export function buildPresenceFilter(authors: PubkeyHex[]): Filter {
  return { kinds: [KIND.HEARTBEAT], authors };
}

export type PresenceStatus = "online" | "offline";

/**
 * 依收到的心跳判定好友上線/離線。
 * - `observe` 記錄某 pubkey 的最新心跳（Nostr created_at，秒）。
 * - `statusOf` 在指定時間點（毫秒）判定狀態：距最後心跳未逾
 *   {@link OFFLINE_TIMEOUT_MS} 即為上線。
 */
export class PresenceTracker {
  private readonly lastSeenMs = new Map<PubkeyHex, number>();

  observe(pubkey: PubkeyHex, createdAtSec: number): void {
    const ms = createdAtSec * 1000;
    const prev = this.lastSeenMs.get(pubkey);
    if (prev === undefined || ms > prev) {
      this.lastSeenMs.set(pubkey, ms);
    }
  }

  lastSeenAt(pubkey: PubkeyHex): number | undefined {
    return this.lastSeenMs.get(pubkey);
  }

  statusOf(pubkey: PubkeyHex, nowMs: number): PresenceStatus {
    const seen = this.lastSeenMs.get(pubkey);
    if (seen === undefined) return "offline";
    return nowMs - seen <= OFFLINE_TIMEOUT_MS ? "online" : "offline";
  }
}
