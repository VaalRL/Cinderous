import { getEventHash, type NostrEvent } from "./event.js";
import { generateSecretKey, getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { decryptDM, encryptDM } from "./nip44.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

const KIND_SEAL = 13;
/**
 * NIP-59 外層時戳抖動窗（秒）：seal 與 wrap 的 `created_at` 會被隨機往前推最多這麼久，
 * 以免中繼從時戳關聯出社交圖譜。
 *
 * **匯出是必要的**：收件箱增量抓取（`since`，ADR-0109）必須退讓這麼多，否則剛發出、
 * 外層時戳卻落在兩天前的訊息會被濾掉而**靜默漏訊**。
 */
export const TIMESTAMP_JITTER_SECONDS = 2 * 86_400;

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
  /**
   * seal（kind 13）層的 tags（ADR-0326）。
   *
   * **只有解得開 wrap 的收件人看得到**——seal 被加密在 wrap 內層，中繼與其他人都讀不到。
   * 用途：夾帶「不能進 rumor」的逐收件人資訊（如寄件人當前 EK），
   * 因為 `rumor.id` 是跨成員一致的識別碼，放進去會讓每次輪替都產生不同的 id（ADR-0318）。
   */
  sealTags: string[][];
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
  /**
   * seal 層 tags（ADR-0326）：**只有收件人看得到**（seal 加密在 wrap 內），且不影響 `rumor.id`。
   * 預設空＝與 NIP-59 慣例一致。
   */
  sealTags: string[][] = [],
): NostrEvent {
  const base = { ...rumorInput, pubkey: getPublicKey(senderSk) };
  const rumor: Rumor = { id: getEventHash(base), ...base };

  const seal = finalizeEvent(
    {
      kind: KIND_SEAL,
      created_at: jitteredPast(rumorInput.created_at),
      tags: sealTags,
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
  // 核對 rumor.id 為其內容的正確雜湊（防偽造 id 污染去重鍵）。
  const { id, ...unsigned } = rumor;
  if (id !== getEventHash(unsigned)) {
    throw new Error("NIP-59：rumor id 與內容不符");
  }

  return { sender: seal.pubkey, rumor, sealTags: seal.tags };
}
