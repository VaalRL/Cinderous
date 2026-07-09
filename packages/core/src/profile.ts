import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/**
 * 顯示名稱（個人檔）以**加密 Gift Wrap 廣播給聯絡人**，而非公開 kind 0（ADR-0061）——
 * 只有聯絡人看得到你的暱稱，中繼站看到的是密文，維持隱私鐵則。rumor 為 kind 0、
 * content 為 `{name}`（NIP-01 個人檔子集）。
 */
export function wrapProfile(
  name: string,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { now?: number; relayHint?: string } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  // relayHint（ADR-0066）：寫入 rumor 內層（加密、外層不可見），收端以既有 learnRelayHint 學路由。
  const tags = opts.relayHint ? [["relay", opts.relayHint]] : [];
  return sealAndWrap(
    { kind: KIND.PROFILE, created_at: nowSec, tags, content: JSON.stringify({ name }) },
    senderSk,
    recipientPk,
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", recipientPk],
        ["expiration", String(nowSec + DEFAULT_TTL_SECONDS)],
      ],
    },
  );
}

/** 從個人檔 rumor 取出顯示名稱（kind 0，content JSON 的 name）；非個人檔或無有效名則 undefined。 */
export function parseProfile(rumor: Rumor): string | undefined {
  if (rumor.kind !== KIND.PROFILE) return undefined;
  try {
    const name = (JSON.parse(rumor.content) as { name?: unknown }).name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}
