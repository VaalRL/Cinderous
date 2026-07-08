import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/** 回條類型：已送達裝置 / 已讀（ADR-0058）。 */
export type ReceiptType = "delivered" | "read";

/**
 * 送達/已讀回條：kind RECEIPT 的 rumor，`e` tag 指向目標訊息 id
 * （已讀採水位語意＝「已讀到此訊息」），`receipt` tag 標類型；包進 kind 1059 Gift Wrap
 * （隱藏雙方、E2E）。方向為收件人→原寄件人。
 */
export function wrapReceipt(
  type: ReceiptType,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  targetEventId: string,
  opts: { now?: number } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return sealAndWrap(
    {
      kind: KIND.RECEIPT,
      created_at: nowSec,
      tags: [
        ["e", targetEventId],
        ["receipt", type],
      ],
      content: "",
    },
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

/** 從回條 rumor 取出類型與目標訊息 id；非回條或缺 tag 回 undefined。 */
export function receiptOf(rumor: Rumor): { type: ReceiptType; messageId: string } | undefined {
  if (rumor.kind !== KIND.RECEIPT) return undefined;
  const messageId = rumor.tags.find((t) => t[0] === "e")?.[1];
  const type = rumor.tags.find((t) => t[0] === "receipt")?.[1];
  if (!messageId || (type !== "delivered" && type !== "read")) return undefined;
  return { type, messageId };
}
