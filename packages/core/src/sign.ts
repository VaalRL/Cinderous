import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { getEventHash, type EventTemplate, type NostrEvent } from "./event.js";
import { getPublicKey, type SecretKey } from "./keys.js";

/** 以私鑰補上 pubkey、計算 id 並 Schnorr 簽章，產出完整事件。 */
export function finalizeEvent(template: EventTemplate, sk: SecretKey): NostrEvent {
  const pubkey = getPublicKey(sk);
  const id = getEventHash({ ...template, pubkey });
  // noble 2.x 只收 bytes（1.x 會自動把 hex 轉掉）；位元組相同 ⇒ 簽章相同（ADR-0374 黃金向量）。
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...template, pubkey, id, sig };
}

/**
 * 驗證事件：
 * 1. id 必須等於重新計算的 hash（防止欄位竄改）。
 * 2. Schnorr 簽章對 (id, pubkey) 必須有效。
 */
export function verifyEvent(event: NostrEvent): boolean {
  if (getEventHash(event) !== event.id) return false;
  try {
    // hex 轉換放在 try 裡：格式錯誤的 sig／pubkey（奇數長度、非 hex）一律視為驗章失敗，
    // 與 1.x 行為相同（1.x 在 verify 內部轉換，錯誤同樣被這裡接住）。
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}
