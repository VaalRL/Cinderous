/**
 * 中繼回給客戶端的拒收訊息（ADR-0376；SDK ADR 0038 P0-R2、SDK ADR 0040 詞元表）。
 *
 * 每一句都是「NIP-01 前綴＋英文詞元＋說明」：外站與 App v0.0.18 只看前綴（core `classifyOk`），
 * SDK 客戶端（`classifyRelayMessage`）多拿一層詞元。詞元表的單一真實來源是 SDK 的 `protocol/relay-reject.ts`。
 *
 * 🔴 這些句子與 SDK 中繼（`@cinderous/client/relay` v0.32.0／v0.34.0 的 `relay/reject-messages.ts`）**逐字相同**：
 * PR #9 把錨點切到 SDK 中繼時，客戶端看到的不變。改字要兩邊一起改（`reject-messages.test.ts` 釘住每一句）。
 * 🔴 只能在前綴**後面**加詞元，前綴不能改：已上線的 App 以前綴判斷重試或永久失敗。
 */

import type { DroppedSummary } from "./capacity.js";
import type { AddressableRejectReason } from "./message-store.js";

/** 離線留言存不下（DO 天花板滿了而這個平面不淘汰；SDK ADR 0038 P0-R1）。 */
export const OFFLINE_CEILING_REJECT = "blocked: ceiling: 本站離線留言空間已滿，這則未保存也未轉送；請改用其他中繼或稍後再試";

/** 事件自帶的 NIP-40 `expiration` 已經過了（SDK ADR 0038 P0-R1）。重送同一顆沒有用。 */
export const EXPIRED_REJECT = "invalid: expired: 事件已過期（NIP-40），未保存也未轉送";


/** 可尋址被拒的句子，依原因拆開（ADR-0376；原本全部是同一句 {@link ADDRESSABLE_REJECT_GENERIC}）。 */
export const ADDRESSABLE_REJECT: Readonly<Record<AddressableRejectReason, string>> = {
  stale: "blocked: stale: 這個位址已有較新的事件，未取代",
  "too-large": "blocked: too-large: 可尋址事件超過單顆大小上限",
  "address-quota": "blocked: quota: 這個作者在這個 kind 的位址數已達上限",
  "byte-quota": "blocked: quota: 這個作者的可尋址資料總量已達上限",
  expired: EXPIRED_REJECT,
  ceiling: "blocked: ceiling: 本站可尋址資料空間已滿，這則未保存也未轉送；請改用其他中繼或稍後再試",
};

/**
 * 自訂的 `OfflineStore` 只實作了回 boolean 的 `putAddressable`、說不出原因時用的舊句子。
 * 沒有詞元，客戶端分成 `policy`（與 v0.31 以前相同）。
 */
export const ADDRESSABLE_REJECT_GENERIC = "blocked: 取代事件遭拒（配額/大小/較舊）";

/** 其他拒收（`OK false`、`CLOSED`、`NOTICE`）。 */
export const REJECT = {
  tooManyTags: "blocked: too-many-tags: tag 數超過上限",
  tooManyRecipients: "blocked: too-many-recipients: 收件人數超過上限",
  eventTooLarge: "blocked: too-large: 事件過大",
  notAllowed: "blocked: not-allowed: 非本企業成員（allowlist）",
  kindDisabled: "blocked: kind-disabled: 此事件類型已被政策停用",
  /** 🔴 ADR 0027 的 `isFileEventsDisabledReason` 認 `MAX_FILE_MB`，這個記號要留著 */
  filesDisabled: "blocked: files-disabled: 檔案事件未啟用（MAX_FILE_MB）",
  fileChunkTooLarge: "blocked: too-large: 檔案塊過大",
  badSignature: "invalid: bad-signature: 簽章驗證失敗",
  clockSkew: "invalid: clock-skew: 時間戳超出允許範圍",
  messageTooLarge: "invalid: too-large: 訊息過大",
  vanishRelayTag: "invalid: relay-tag: relay tag 未指向本站（NIP-62）",
  /** NIP-01 的範例是 `OK true "duplicate: …"`：本站已經有這顆（SDK ADR 0038 決策 3） */
  duplicate: "duplicate: seen: 事件重複",
  eventsRateLimited: "rate-limited: events: 發送過於頻繁，請稍後再試",
  messagesRateLimited: "rate-limited: messages: 訊息過於頻繁，連線將關閉（ADR-0366）",
  ipRateLimited: "rate-limited: ip: 同一個 IP 的訊息過於頻繁，連線將關閉（PRD 3.3）",
  subscriptionsLimit: "rate-limited: subscriptions: 訂閱數已達上限",
  authRequired: "auth-required: nip42: 請先認證（NIP-42）",
  scopeStrict: "restricted: scope: 訂閱必須指定 #p（自己）或 authors（ADR-0123）",
  scopeLane:
    "restricted: scope: app lanes need a tag filter (e.g. #t, #d), authors, or #p set to yourself after NIP-42 AUTH (ADR-0366)",
  notOnWhitelist: "restricted: not-allowed: 不在這座站的白名單上",
  vanishSelfOnly: "restricted: self-only: 只能清除自己的資料（NIP-62）",
  authNoChallenge: "auth-failed: no-challenge: 尚未發出挑戰",
  authBadEvent: "auth-failed: bad-auth: 認證事件無效或挑戰不符",
  authRelayTag: "auth-failed: relay-tag: relay tag 未指向本站",
  authTooOld: "auth-failed: too-old: 認證事件已過期",
  internal: "error: internal: 內部錯誤，請稍後再試",
} as const;

/** `pow: difficulty: 需要難度 N` */
export function powRejectMessage(minPow: number): string {
  return `pow: difficulty: 需要難度 ${minPow}`;
}

/** 同一把公鑰的已認證連線超過上限（SDK ADR 0013） */
export function tooManyConnectionsMessage(max: number): string {
  return `restricted: too-many-connections: 同一把公鑰最多 ${max} 條連線`;
}

/** 解析不了的客戶端訊息（`NOTICE`）；`reason` 是解析器給的英文短句 */
export function malformedMessage(reason: string): string {
  return `invalid: malformed: ${reason}`;
}

// ── 收下了、但附帶條件：`OK true "warning: …"` 與 `NOTICE "warning: …"`（SDK ADR 0042；ADR 0040 詞元表）──────
// NIP-01 允許 `OK true` 帶訊息；不認得的客戶端照舊當成功。`warning` 不是 NIP-01 的標準前綴，但形狀相同（單字＋冒號），
// 我們的客戶端（`classifyRelayMessage`）依詞元分類；第三方客戶端只看到一段說明。

/** 秒數寫成人讀的長度（`7200` → `2 小時`）。 */
function humanSeconds(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} 小時`;
  if (sec % 60 === 0) return `${sec / 60} 分鐘`;
  return `${sec} 秒`;
}

/** 收進溢位帶（ADR 0039 B1）：`warning: borrowed: <秒>: …`。客戶端取秒數（`parseBorrowedWarning`），算即時送達、不算耐久收下。 */
export function borrowedWarning(ttlSec: number): string {
  return `warning: borrowed: ${ttlSec}: 本站空間暫時不足，這則只保存 ${humanSeconds(ttlSec)}、會最先被刪除；要長期保存請另存一份到其他中繼`;
}

/** 接近天花板（ADR 0038 決策 5，粗分級）：`warning: near-full: <級>: …`。級只有站方設定的一級與 95。 */
export function nearFullWarning(percent: number): string {
  return `warning: near-full: ${percent}: 本站這一類資料的空間已用 ${percent}% 以上；建議另存一份到其他中繼`;
}

/**
 * 丟棄計數（ADR 0038 M8）：收件人讀自己的收件匣時，在 EOSE 之前送一則 `NOTICE`。
 * `warning: dropped: <則數>: <最早 created_at>: <最晚 created_at>: …`——只有數量與時間範圍，沒有寄件人、沒有內容、沒有事件 id。
 * 用 `NOTICE` 而不是自訂訊息型別：NIP-01 客戶端對 `NOTICE` 只會記錄或顯示，不認得的訊息型別有的會報錯。
 */
export function droppedNotice(d: DroppedSummary): string {
  return `warning: dropped: ${d.count}: ${d.since}: ${d.until}: 本站因空間不足刪掉了 ${d.count} 則寄給你、還沒送到的留言；可向你的其他裝置或寄件人索取`;
}

