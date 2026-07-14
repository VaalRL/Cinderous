import { KIND } from "./constants.js";
import { wrapForBoth, type WrappedMessage } from "./giftwrap.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/**
 * 以 NIP-09 收回（刪除）某則已送出的訊息，包成 kind 1059 Gift Wrap（隱藏雙方）。
 * rumor 為 kind 5，`e` tag 指向目標訊息 id；收件端據此移除該訊息。
 *
 * 一併包一份**自封副本**（ADR-0107）。這**不是可選的**：若只同步訊息而不同步收回，
 * 使用者在手機按了收回，訊息卻還留在自己的電腦上——那是隱私破損，不是不便。
 */
export function wrapDeletion(
  senderSk: SecretKey,
  /** 收件人；群組傳成員清單（扇出），1:1 傳單一 pubkey。 */
  recipients: PubkeyHex | PubkeyHex[],
  targetEventId: string,
  opts: { now?: number } = {},
): WrappedMessage {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return wrapForBoth(
    { kind: KIND.DELETE, created_at: nowSec, tags: [["e", targetEventId]], content: "" },
    senderSk,
    recipients,
    nowSec + DEFAULT_TTL_SECONDS,
  );
}

/** 從刪除 rumor 取出其指向的目標訊息 id（`e` tag）。 */
export function deletionTarget(rumor: Rumor): string | undefined {
  return rumor.tags.find((t) => t[0] === "e")?.[1];
}
