import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/**
 * 以 NIP-09 收回（刪除）某則已送出的訊息，包成 kind 1059 Gift Wrap（隱藏雙方）。
 * rumor 為 kind 5，`e` tag 指向目標訊息 id；收件端據此移除該訊息。
 */
export function wrapDeletion(
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  targetEventId: string,
  opts: { now?: number } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return sealAndWrap(
    { kind: KIND.DELETE, created_at: nowSec, tags: [["e", targetEventId]], content: "" },
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

/** 從刪除 rumor 取出其指向的目標訊息 id（`e` tag）。 */
export function deletionTarget(rumor: Rumor): string | undefined {
  return rumor.tags.find((t) => t[0] === "e")?.[1];
}
