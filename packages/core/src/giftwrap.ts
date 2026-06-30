import { KIND } from "./constants.js";
import { getEventHash, type NostrEvent } from "./event.js";
import { generateSecretKey, getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { decryptDM, encryptDM } from "./nip44.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

const KIND_SEAL = 13;
const KIND_CHAT = 14;
const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;
const TIMESTAMP_JITTER_SECONDS = 2 * DAY_SECONDS;

/** NIP-17 rumor：未簽章的聊天訊息（kind 14）。 */
export interface Rumor {
  id: string;
  pubkey: PubkeyHex;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

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

/** 將外層時間戳隨機提前最多兩天，降低時間相關性分析。 */
function jitteredPast(nowSec: number): number {
  return nowSec - Math.floor(Math.random() * TIMESTAMP_JITTER_SECONDS);
}

/**
 * 以 NIP-17/59 將明文包成 kind 1059 Gift Wrap：
 * rumor(kind14) → seal(kind13，寄件人簽) → wrap(kind1059，一次性金鑰簽)。
 * 中繼站只見到「指向收件人臨時金鑰的密文」，無法還原寄件人與社交圖譜。
 */
export function wrapMessage(
  content: string,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: WrapOptions = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const senderPk = getPublicKey(senderSk);

  const rumorBase = {
    pubkey: senderPk,
    created_at: nowSec,
    kind: KIND_CHAT,
    tags: [] as string[][],
    content,
  };
  const rumor: Rumor = { id: getEventHash(rumorBase), ...rumorBase };

  const seal = finalizeEvent(
    {
      kind: KIND_SEAL,
      created_at: jitteredPast(nowSec),
      tags: [],
      content: encryptDM(JSON.stringify(rumor), senderSk, recipientPk),
    },
    senderSk,
  );

  const wrapSk = generateSecretKey();
  const expiration = opts.expiration ?? nowSec + DEFAULT_TTL_SECONDS;
  return finalizeEvent(
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      created_at: jitteredPast(nowSec),
      tags: [
        ["p", recipientPk],
        ["expiration", String(expiration)],
      ],
      content: encryptDM(JSON.stringify(seal), wrapSk, recipientPk),
    },
    wrapSk,
  );
}

/**
 * 解開 Gift Wrap 並驗證寄件人真實性：
 * 1. 以收件人私鑰解外層 → seal，驗 seal 簽章。
 * 2. 解 seal → rumor。
 * 3. rumor 作者必須等於 seal 簽章者，否則視為偽造。
 */
export function unwrapMessage(wrap: NostrEvent, recipientSk: SecretKey): UnwrappedMessage {
  const seal = JSON.parse(decryptDM(wrap.content, recipientSk, wrap.pubkey)) as NostrEvent;
  if (!verifyEvent(seal)) {
    throw new Error("Gift Wrap：seal 簽章無效");
  }

  const rumor = JSON.parse(decryptDM(seal.content, recipientSk, seal.pubkey)) as Rumor;
  if (rumor.pubkey !== seal.pubkey) {
    throw new Error("Gift Wrap：寄件人不一致，可能為偽造");
  }

  return { sender: seal.pubkey, rumor };
}
