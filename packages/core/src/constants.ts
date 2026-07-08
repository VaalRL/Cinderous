/** Nostr 事件 Kind 常數（對應 ARCHITECTURE.md §5 事件契約）。 */
export const KIND = {
  /** NIP-09 事件刪除（收回訊息，作為 rumor kind）。 */
  DELETE: 5,
  /** NIP-25 訊息回應（作為 rumor kind，包進 Gift Wrap）。 */
  REACTION: 7,
  /** NIP-17 聊天訊息（rumor kind）。 */
  CHAT: 14,
  /** 群組控制訊息（建立/加入/移除/離開；app 內部 rumor kind，經 Gift Wrap）。 */
  GROUP_CONTROL: 40,
  /** 送達/已讀回條（app 內部 rumor kind，經 Gift Wrap；ADR-0058）。 */
  RECEIPT: 41,
  /** 離線留言：NIP-17/59 Gift Wrap。 */
  OFFLINE_DM_GIFT_WRAP: 1059,
  /** 好友上線/離線心跳（Ephemeral）。 */
  HEARTBEAT: 20000,
  /** 正在輸入中（Ephemeral）。 */
  TYPING: 20001,
  /** 正在聆聽音樂（Ephemeral）。 */
  MUSIC: 20002,
} as const;

/** 引導 relay 清單事件（ADR-0039，維護者簽章、可取代）。 */
export const RELAY_LIST_KIND = 10037;

/** 企業組織名冊事件（ADR-0047，管理者簽章、可取代）。 */
export const ORG_ROSTER_KIND = 10038;

/** WebRTC SDP 信令使用的 Ephemeral kind 區間（NIP-59 包封）。 */
export const SDP_KIND_RANGE = { min: 21000, max: 21999 } as const;

/** 心跳發送間隔（毫秒）。 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 連續未收到心跳超過此時間（毫秒）即判定離線。 */
export const OFFLINE_TIMEOUT_MS = 60_000;

/** 收到「正在輸入中」後維持顯示的時間（毫秒），逾時即清除。 */
export const TYPING_TIMEOUT_MS = 6_000;
