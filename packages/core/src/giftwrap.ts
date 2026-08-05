import { getEventHash } from "nostr-tools/pure";

import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import { getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { mentionTags } from "./mention.js";
import { openWrap, sealAndWrap, type Rumor, type RumorInput } from "./nip59.js";
import { withEkHint } from "./subkey.js";
import { alsoMainTag, replyTag } from "./thread.js";

const KIND_CHAT = 14;
const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/**
 * 收件人標記（ADR-0107）：寫在 **rumor 內層**，供**自封副本**抵達自己的其他裝置時，
 * 判斷這則訊息原本是發給誰的（否則無從歸檔到正確對話）。
 *
 * **不可用 `p` tag**：`mentionedPubkeys()` 會把 rumor 內所有 `p` tag 當成 @提及
 * （見 `mention.ts`），用了會讓每則訊息都「提及」收件人。
 */
const TO_TAG = "to";

/**
 * 一則訊息包出來的所有 Gift Wrap（ADR-0107）。
 *
 * - `id`：**內層 rumor 的 id**。這是訊息的正典 id——它對「給對方的 wrap」與「自封副本」
 *   是**同一個**（外層 wrap id 則各不相同），因此也是三方（發送裝置、自己的其他裝置、
 *   收件人）唯一能共同指涉的識別。回條／回應／收回一律以此為 target。
 * - `events`：**定址給對方**的 wrap（1:1 為一顆；群訊為每位其他成員一顆）。送出狀態只追蹤這些。
 * - `selfCopy`：**定址給自己**的 wrap，讓自己的其他裝置也收得到。best-effort，不計入送出狀態。
 */
export interface WrappedMessage {
  id: string;
  events: NostrEvent[];
  selfCopy: NostrEvent;
}

/** 讀出 rumor 內層的收件人標記（ADR-0107）；群訊與非 1:1 訊息回傳 null。 */
export function selfCopyTarget(rumor: Rumor): PubkeyHex | null {
  return rumor.tags.find((t) => t[0] === TO_TAG)?.[1] ?? null;
}

/**
 * 把**同一個 rumor** 包給「對方」與「自己」兩份（ADR-0107 決策 1）。
 *
 * rumor 只建一次 → 兩份 wrap 的內層 rumor 完全相同 → `rumor.id` 相同。
 * 外層 `p` tag 各自指向該 wrap 真正的收件人（自封副本即自己），這樣它才會落進自己的收件箱。
 */
export function wrapForBoth(
  input: RumorInput,
  senderSk: SecretKey,
  /**
   * 收件人。**可以是多位**——群組的回應/收回必須扇給每位成員（群組**無共用金鑰**，ADR-0027）。
   * 過去這裡只收單一 pubkey，於是 UI 把 `groupId` 直接丟進來 → NIP-44 加密拋
   * `second arg must be public key` → **群組裡按回應或收回訊息直接爆**（ADR-0119）。
   */
  recipients: PubkeyHex | PubkeyHex[],
  outerExpiration: number,
  /** ADR-0245：把某身分要**加密到的 pk**（其 EK）；省略＝加密到身分本身（現況/向後相容）。 */
  opts: { encryptToFor?: (identityPk: PubkeyHex) => PubkeyHex } = {},
): WrappedMessage {
  const senderPk = getPublicKey(senderSk);
  const id = getEventHash({ ...input, pubkey: senderPk });
  const encryptTo = opts.encryptToFor ?? ((pk) => pk);
  const wrapFor = (pk: PubkeyHex): NostrEvent =>
    // 外層 `#p` 仍為身分 pk（供路由/收件匣）；加密對象為其 EK（FS）或身分（退回）。
    sealAndWrap(input, senderSk, encryptTo(pk), {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", pk],
        ["expiration", String(outerExpiration)],
      ],
    });
  const to = Array.isArray(recipients) ? recipients : [recipients];
  return { id, events: to.map(wrapFor), selfCopy: wrapFor(senderPk) };
}

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
  /** 串回覆同時顯示於主對話（ADR-0232，仿 Slack）：僅與 replyTo 併用時寫入旗標 tag。 */
  alsoMain?: boolean;
  /**
   * 前向保密（ADR-0245）：啟用後**加密到收件人當前 EK**（而非身分金鑰），並在 rumor 內嵌自己的
   * 當前 EK（`myEk`，供對方即時學到）。`encryptToFor(身分pk)` 回該身分要加密到的 pk——收件人的 EK
   * （不知時退回身分 pk＝向後相容）、自我副本的自己 EK。外層 `#p` 仍為身分（供路由）。
   */
  fs?: { encryptToFor: (identityPk: PubkeyHex) => PubkeyHex; myEk: PubkeyHex };
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
): WrappedMessage {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const outerExpiration = opts.expiration ?? opts.disappearAt ?? nowSec + DEFAULT_TTL_SECONDS;
  let rumorTags: string[][] = [
    [TO_TAG, recipientPk],
    ...(opts.disappearAt !== undefined ? [["expiration", String(opts.disappearAt)]] : []),
    ...(opts.relayHint ? [["relay", opts.relayHint]] : []),
    ...(opts.mentions && opts.mentions.length > 0 ? mentionTags(opts.mentions) : []),
    ...(opts.replyTo ? [replyTag(opts.replyTo)] : []),
    ...(opts.replyTo && opts.alsoMain ? [alsoMainTag()] : []),
  ];
  // ADR-0245：FS 時在 rumor 內嵌自己的當前 EK（對方解開即學到）。
  if (opts.fs) rumorTags = withEkHint(rumorTags, opts.fs.myEk);
  return wrapForBoth(
    { kind: KIND_CHAT, created_at: nowSec, tags: rumorTags, content },
    senderSk,
    recipientPk,
    outerExpiration,
    opts.fs ? { encryptToFor: opts.fs.encryptToFor } : {},
  );
}

/** 檔案 metadata（ADR-0093）：位元組走 P2P，另發一則加密 rumor 帶此 metadata，
 *  讓收件人**所有裝置**都知道有檔案。`tid` 對應 P2P 傳輸 id，供關聯位元組與此訊息。 */
export interface FileMeta {
  tid: string;
  name: string;
  size: number;
  mime: string;
  /**
   * 公司儲存槽存放（ADR-0161）：值＝來源對話標註。帶此欄位的檔案是「存進企業主
   * 儲存槽」的位元組，**兩端都不建立聊天訊息**；企業主端收齊位元組後直接落盤。
   */
  slot?: string;
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
  opts: {
    now?: number;
    expiration?: number;
    relayHint?: string;
    /**
     * FS retarget（ADR-0318）：身分 pk → 其 EK。省略＝加密到身分本身（現況）。
     *
     * ⚠ **刻意不收 `myEk`**——1:1 會在 rumor 內嵌 `ek` hint，但檔案 metadata 的 `rumor.id`
     * 是跨成員/跨時間的識別（ADR-0095），把會輪替的值放進去會讓識別碼變成非決定性。
     * hint 的功能由 kind 10040 公告承擔（ADR-0313 讓它每 7 天刷新）。
     */
    encryptToFor?: (identityPk: PubkeyHex) => PubkeyHex;
  } = {},
): WrappedMessage {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const outerExpiration = opts.expiration ?? nowSec + DEFAULT_TTL_SECONDS;
  const rumorTags: string[][] = [
    [TO_TAG, recipientPk],
    ["file", meta.tid, meta.name, String(meta.size), meta.mime],
    ...(meta.slot !== undefined ? [["slot", meta.slot]] : []), // ADR-0161：儲存槽存放標記
    ...(opts.relayHint ? [["relay", opts.relayHint]] : []),
  ];
  return wrapForBoth(
    { kind: KIND_CHAT, created_at: nowSec, tags: rumorTags, content: "" },
    senderSk,
    recipientPk,
    outerExpiration,
    opts.encryptToFor ? { encryptToFor: opts.encryptToFor } : {},
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
  const slot = rumor.tags.find((x) => x[0] === "slot")?.[1]; // ADR-0161：儲存槽存放標記
  return {
    tid,
    name,
    size: Number.isFinite(size) ? size : 0,
    mime: t[4] || "application/octet-stream",
    ...(slot !== undefined ? { slot } : {}),
  };
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
