import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { openWrap, sealAndWrap, type Rumor } from "./nip59.js";

const KIND_CHAT = 14;
const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

export interface UnwrappedMessage {
  /** 經身分驗證的寄件人公鑰。 */
  sender: PubkeyHex;
  rumor: Rumor;
}

export interface WrapOptions {
  /** 訊息實際時間（unix 秒）；省略時為現在。 */
  now?: number;
  /** NIP-40 過期時間（unix 秒）；省略時為 now + 7 天。 */
  expiration?: number;
}

/**
 * 以 NIP-17/59 將明文聊天訊息（rumor kind 14）包成 kind 1059 Gift Wrap，
 * 帶 `#p` 收件人與 NIP-40 過期，供離線留言使用。
 */
export function wrapMessage(
  content: string,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: WrapOptions = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const expiration = opts.expiration ?? nowSec + DEFAULT_TTL_SECONDS;
  return sealAndWrap(
    { kind: KIND_CHAT, created_at: nowSec, tags: [], content },
    senderSk,
    recipientPk,
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", recipientPk],
        ["expiration", String(expiration)],
      ],
    },
  );
}

/** 解開離線留言並驗證寄件人真實性。 */
export function unwrapMessage(wrap: NostrEvent, recipientSk: SecretKey): UnwrappedMessage {
  return openWrap(wrap, recipientSk);
}
