import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { mentionTags } from "./mention.js";
import { openWrap, sealAndWrap, type Rumor } from "./nip59.js";
import { replyTag } from "./thread.js";

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
  /** 外層 Gift Wrap 的 NIP-40 過期時間（unix 秒）；省略時為 now + 7 天。 */
  expiration?: number;
  /**
   * 限時訊息（閱後即焚）到期時間（unix 秒）。設定後會把 NIP-40 `expiration`
   * tag 寫進 **rumor 內層**（供收件端解密後得知何時隱藏），並將外層 wrap 過期
   * 縮短為同一時間以利中繼清除。
   */
  disappearAt?: number;
  /**
   * 寄件人的 home relay（ADR-0035）：寫進 **rumor 內層** `relay` tag，
   * 經加密只有收件人可見，供對方自動學習路由 hint。
   */
  relayHint?: string;
  /** @提及（ADR-0050）：寫進 **rumor 內層** `p` tag，隨加密僅收件人可見。 */
  mentions?: PubkeyHex[];
  /** 對話串回覆（ADR-0051）：寫進 **rumor 內層** NIP-10 reply e-tag，指向串根訊息。 */
  replyTo?: string;
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
  const outerExpiration = opts.expiration ?? opts.disappearAt ?? nowSec + DEFAULT_TTL_SECONDS;
  const rumorTags: string[][] = [
    ...(opts.disappearAt !== undefined ? [["expiration", String(opts.disappearAt)]] : []),
    ...(opts.relayHint ? [["relay", opts.relayHint]] : []),
    ...(opts.mentions && opts.mentions.length > 0 ? mentionTags(opts.mentions) : []),
    ...(opts.replyTo ? [replyTag(opts.replyTo)] : []),
  ];
  return sealAndWrap(
    { kind: KIND_CHAT, created_at: nowSec, tags: rumorTags, content },
    senderSk,
    recipientPk,
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", recipientPk],
        ["expiration", String(outerExpiration)],
      ],
    },
  );
}

/** 檔案 metadata（ADR-0093）：位元組走 P2P，另發一則加密 rumor 帶此 metadata，
 *  讓收件人**所有裝置**都知道有檔案。`tid` 對應 P2P 傳輸 id，供關聯位元組與此訊息。 */
export interface FileMeta {
  tid: string;
  name: string;
  size: number;
  mime: string;
}

/**
 * 送出檔案 metadata 訊息（ADR-0093）：與一般訊息同樣包成 kind 1059 Gift Wrap，
 * 但 rumor 內層帶一個 `file` tag（`["file", tid, name, size, mime]`）。metadata 全在
 * 加密內層，中繼看不到（與明文訊息無異）；位元組本體不在此、仍走 P2P。
 */
export function wrapFileMessage(
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  meta: FileMeta,
  opts: { now?: number; expiration?: number; relayHint?: string } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const outerExpiration = opts.expiration ?? nowSec + DEFAULT_TTL_SECONDS;
  const rumorTags: string[][] = [
    ["file", meta.tid, meta.name, String(meta.size), meta.mime],
    ...(opts.relayHint ? [["relay", opts.relayHint]] : []),
  ];
  return sealAndWrap(
    { kind: KIND_CHAT, created_at: nowSec, tags: rumorTags, content: "" },
    senderSk,
    recipientPk,
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", recipientPk],
        ["expiration", String(outerExpiration)],
      ],
    },
  );
}

/** 讀出 rumor 內層的檔案 metadata（ADR-0093）；非檔案訊息回傳 null。 */
export function parseFileMeta(rumor: Rumor): FileMeta | null {
  const t = rumor.tags.find((x) => x[0] === "file");
  if (!t) return null;
  const tid = t[1];
  const name = t[2];
  if (!tid || !name) return null;
  const size = Number(t[3]);
  return { tid, name, size: Number.isFinite(size) ? size : 0, mime: t[4] || "application/octet-stream" };
}

/** 讀出限時訊息 rumor 內的到期時間（NIP-40 `expiration`，unix 秒）；無則回傳 undefined。 */
export function messageExpiry(rumor: Rumor): number | undefined {
  const raw = rumor.tags.find((t) => t[0] === "expiration")?.[1];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** 讀出 rumor 內層的寄件人 relay hint（ADR-0035）；無則回傳 undefined。 */
export function relayHintOf(rumor: Rumor): string | undefined {
  return rumor.tags.find((t) => t[0] === "relay")?.[1];
}

/** 解開離線留言並驗證寄件人真實性。 */
export function unwrapMessage(wrap: NostrEvent, recipientSk: SecretKey): UnwrappedMessage {
  return openWrap(wrap, recipientSk);
}
