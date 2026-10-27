// 可選的公開聯絡方式（ADR-0382）：讓第三方 Nostr 客戶端只憑 npub 找到我、看到我的名稱。
//
// 三種標準事件，全部**公開、明文**——只有使用者自己打開開關時才發布：
// - kind 10050（NIP-17）：私訊收件中繼。第三方照著寄，就落在我讀收件匣的那座。
// - kind 10002（NIP-65）：write 中繼。outbox 模型的客戶端靠它找到我的 kind 0。
// - kind 0（NIP-01）：只放 `name`。頭像、簡介、狀態一律不放（使用者 2026-10-14 決定；那些仍只走加密個人檔，ADR-0061）。
//
// 關掉＝發一顆較新的空清單／`{}` 取代舊的（可取代事件只留最新一顆）。content 為空的 10050／10002
// 要靠錨點的 purge 修正才存得住（ADR-0382 §7，錨點 2026-10-14 已部署）。

import type { NostrEvent } from "./event.js";
import type { SecretKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";

/** NIP-17 私訊收件中繼清單。 */
export const INBOX_RELAY_LIST_KIND = 10050;
/** NIP-65 中繼清單（這裡只用 write）。 */
export const OUTBOX_RELAY_LIST_KIND = 10002;
/** NIP-01 公開個人檔。 */
export const PUBLIC_PROFILE_KIND = 0;

const nowSec = (): number => Math.floor(Date.now() / 1000);
const isRelayUrl = (url: string): boolean => /^wss?:\/\/\S+$/i.test(url);

/** kind 10050：`urls` 每座一個 `relay` 標籤；空陣列＝清空（不讓人寄）。 */
export function buildInboxRelayList(sk: SecretKey, urls: readonly string[], now = nowSec()): NostrEvent {
  return finalizeEvent(
    { kind: INBOX_RELAY_LIST_KIND, created_at: now, tags: urls.map((u) => ["relay", u]), content: "" },
    sk,
  );
}

/** 讀 kind 10050 的中繼清單（去重、只留 ws/wss）；不是 10050 回 null。 */
export function readInboxRelayList(event: NostrEvent): string[] | null {
  if (event.kind !== INBOX_RELAY_LIST_KIND) return null;
  const out: string[] = [];
  for (const t of event.tags) {
    const url = t[0] === "relay" ? t[1] : undefined;
    if (url !== undefined && isRelayUrl(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

/** kind 10002：`writeUrls` 標 write（我的 kind 0 放在那裡）；不列 read——私訊收件看 10050。 */
export function buildOutboxRelayList(sk: SecretKey, writeUrls: readonly string[], now = nowSec()): NostrEvent {
  return finalizeEvent(
    { kind: OUTBOX_RELAY_LIST_KIND, created_at: now, tags: writeUrls.map((u) => ["r", u, "write"]), content: "" },
    sk,
  );
}

/** kind 0：只放 `name`；`null`＝清空（`{}`）。 */
export function buildPublicName(sk: SecretKey, name: string | null, now = nowSec()): NostrEvent {
  const trimmed = name?.trim();
  return finalizeEvent(
    { kind: PUBLIC_PROFILE_KIND, created_at: now, tags: [], content: JSON.stringify(trimmed ? { name: trimmed } : {}) },
    sk,
  );
}

/** 讀 kind 0 的 `name`（去前後空白）；沒有、不是字串、不是 JSON、不是 kind 0 都回 null。 */
export function readPublicName(event: NostrEvent): string | null {
  if (event.kind !== PUBLIC_PROFILE_KIND) return null;
  try {
    const name = (JSON.parse(event.content) as { name?: unknown }).name;
    return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
  } catch {
    return null;
  }
}
