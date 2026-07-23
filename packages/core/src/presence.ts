import { KIND, OFFLINE_TIMEOUT_MS, PRESENCE_TOLERANCE_FACTOR } from "./constants.js";
import type { PubkeyHex } from "./keys.js";
import { LatestPerKey } from "./tracker.js";

/**
 * Nostr 訂閱 filter（NIP-01 子集，含 `#<tag>` 標籤 filter）。
 *
 * 契約同步：此型別與 relay 端的 `RelayFilter`（`relay/src/protocol.ts`）
 * 形狀相同（core 不可依賴 relay 故分別定義）。修改欄位時兩處須同步更新。
 */
export interface Filter {
  ids?: string[];
  kinds?: number[];
  authors?: PubkeyHex[];
  since?: number;
  until?: number;
  limit?: number;
  /** 標籤 filter，如 `#p`（收件人）。 */
  [tag: `#${string}`]: string[] | undefined;
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
  /** 值＝對方自報的心跳間隔（毫秒，ADR-0109）；舊版客戶端未自報則為 undefined。 */
  private readonly seen = new LatestPerKey<number | undefined>();

  observe(pubkey: PubkeyHex, createdAtSec: number, cadenceMs?: number): void {
    this.seen.observe(pubkey, createdAtSec * 1000, cadenceMs);
  }

  /** 清空所有觀察記錄（ADR-0240 真隱身）：之後 `statusOf` 一律回 `offline`，直到重新收到心跳。 */
  clear(): void {
    this.seen.clear();
  }

  lastSeenAt(pubkey: PubkeyHex): number | undefined {
    return this.seen.at(pubkey);
  }

  /**
   * 容忍窗依**對方自報的心跳節奏**計算（ADR-0109）：`2.5 × 間隔`。
   *
   * 不能用固定值——閒置者每 5 分鐘才發一次心跳，固定的短窗會把「在線但閒置」的人誤判為離線。
   * 未自報（舊版客戶端）則退回 {@link OFFLINE_TIMEOUT_MS}。
   */
  statusOf(pubkey: PubkeyHex, nowMs: number): PresenceStatus {
    const seen = this.seen.at(pubkey);
    if (seen === undefined) return "offline";
    const cadence = this.seen.value(pubkey);
    const tolerance = cadence !== undefined ? cadence * PRESENCE_TOLERANCE_FACTOR : OFFLINE_TIMEOUT_MS;
    return nowMs - seen <= tolerance ? "online" : "offline";
  }
}
