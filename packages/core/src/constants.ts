/** Nostr 事件 Kind 常數（對應 ARCHITECTURE.md §5 事件契約）。 */
export const KIND = {
  /** 離線留言：NIP-17/59 Gift Wrap。 */
  OFFLINE_DM_GIFT_WRAP: 1059,
  /** 好友上線/離線心跳（Ephemeral）。 */
  HEARTBEAT: 20000,
  /** 正在輸入中（Ephemeral）。 */
  TYPING: 20001,
  /** 正在聆聽音樂（Ephemeral）。 */
  MUSIC: 20002,
} as const;

/** WebRTC SDP 信令使用的 Ephemeral kind 區間（NIP-59 包封）。 */
export const SDP_KIND_RANGE = { min: 21000, max: 21999 } as const;

/** 心跳發送間隔（毫秒）。 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 連續未收到心跳超過此時間（毫秒）即判定離線。 */
export const OFFLINE_TIMEOUT_MS = 60_000;
