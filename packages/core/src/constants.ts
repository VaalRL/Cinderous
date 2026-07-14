/** Nostr 事件 Kind 常數（對應 ARCHITECTURE.md §5 事件契約）。 */
export const KIND = {
  /** NIP-01 個人檔（顯示名稱）——作為 rumor kind，加密廣播給聯絡人（ADR-0061）。 */
  PROFILE: 0,
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

/**
 * 心跳間隔（毫秒）——**自適應**（ADR-0109）。
 *
 * 心跳原本佔中繼 request 的 **92%**（30 秒固定 → 2,880 次/日/人），而其中絕大多數是在
 * **對空氣廣播**：多數時間，使用者的聯絡人一個都不在線。
 *
 * - `ACTIVE`：有任一聯絡人在線。
 * - `IDLE`：無人在線 → 放慢到 5 分鐘。
 *
 * **這不會讓「顯示上線」變慢**：收心跳不計中繼 request（中繼→客戶端免費），所以對方一連線
 * 就會立刻發心跳、我免費收到，並在 IDLE→ACTIVE 的**轉換**時立刻補發一次 → 對方一個 RTT
 * 內看到我。詳見 ADR-0109。
 */
export const HEARTBEAT_ACTIVE_MS = 60_000;
export const HEARTBEAT_IDLE_MS = 300_000;

/**
 * 判定離線的容忍窗＝ `2.5 × 對方自報的心跳間隔`（ADR-0109）。
 *
 * 必須依**對方自報的節奏**計算，不能用固定值：閒置者每 5 分鐘才發一次，用固定的短窗會把
 * 「在線但閒置」的人誤判為離線（單向聯絡人時真的會發生——他加了我、我沒加他，我看不到他的
 * 心跳所以保持 IDLE，但他一直在看我）。
 */
export const PRESENCE_TOLERANCE_FACTOR = 2.5;

/** 對方未自報心跳節奏時（舊版客戶端）的容忍窗（毫秒）。 */
export const OFFLINE_TIMEOUT_MS = 150_000;

/** 收到「正在輸入中」後維持顯示的時間（毫秒），逾時即清除。 */
export const TYPING_TIMEOUT_MS = 6_000;
