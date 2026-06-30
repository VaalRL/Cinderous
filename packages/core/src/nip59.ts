import { getEventHash, type NostrEvent } from "./event.js";
import { generateSecretKey, getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { decryptDM, encryptDM } from "./nip44.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

const KIND_SEAL = 13;
const TIMESTAMP_JITTER_SECONDS = 2 * 86_400;

/** 要被封裝的內層事件（未簽章）。 */
export interface RumorInput {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** 內層事件加上 id 與作者後的形態。 */
export interface Rumor extends RumorInput {
  id: string;
  pubkey: PubkeyHex;
}

export interface Opened {
  /** 經身分驗證的寄件人公鑰。 */
  sender: PubkeyHex;
  rumor: Rumor;
}

/** 外層 Gift Wrap 的設定。 */
export interface WrapSpec {
  /** 外層事件 kind（如 1059 離線私訊、21000-21999 信令）。 */
  kind: number;
  tags: string[][];
  /** 外層時間戳；省略時隨機提前最多兩天以抗時間相關性分析。 */
  created_at?: number;
}

function jitteredPast(nowSec: number): number {
  return nowSec - Math.floor(Math.random() * TIMESTAMP_JITTER_SECONDS);
}

/**
 * NIP-59 通用封裝：rumor → seal(kind 13，寄件人簽) → 外層 wrap（一次性
 * 金鑰簽）。中繼站僅見「指向收件人臨時金鑰的密文」，無法還原寄件人。
 */
export function sealAndWrap(
  rumorInput: RumorInput,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  wrap: WrapSpec,
): NostrEvent {
  const base = { ...rumorInput, pubkey: getPublicKey(senderSk) };
  const rumor: Rumor = { id: getEventHash(base), ...base };

  const seal = finalizeEvent(
    {
      kind: KIND_SEAL,
      created_at: jitteredPast(rumorInput.created_at),
      tags: [],
      content: encryptDM(JSON.stringify(rumor), senderSk, recipientPk),
    },
    senderSk,
  );

  const wrapSk = generateSecretKey();
  return finalizeEvent(
    {
      kind: wrap.kind,
      created_at: wrap.created_at ?? jitteredPast(rumorInput.created_at),
      tags: wrap.tags,
      content: encryptDM(JSON.stringify(seal), wrapSk, recipientPk),
    },
    wrapSk,
  );
}

/**
 * 解開 NIP-59 封裝並驗證寄件人真實性：
 * 1. 解外層 → seal，驗 seal 簽章。
 * 2. 解 seal → rumor。
 * 3. rumor 作者必須等於 seal 簽章者，否則視為偽造。
 */
export function openWrap(wrapEvent: NostrEvent, recipientSk: SecretKey): Opened {
  const seal = JSON.parse(decryptDM(wrapEvent.content, recipientSk, wrapEvent.pubkey)) as NostrEvent;
  if (!verifyEvent(seal)) {
    throw new Error("NIP-59：seal 簽章無效");
  }

  const rumor = JSON.parse(decryptDM(seal.content, recipientSk, seal.pubkey)) as Rumor;
  if (rumor.pubkey !== seal.pubkey) {
    throw new Error("NIP-59：寄件人不一致，可能為偽造");
  }

  return { sender: seal.pubkey, rumor };
}
