import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { getEventHash, type EventTemplate, type NostrEvent } from "./event.js";
import { getPublicKey, type SecretKey } from "./keys.js";

/** 以私鑰補上 pubkey、計算 id 並 Schnorr 簽章，產出完整事件。 */
export function finalizeEvent(template: EventTemplate, sk: SecretKey): NostrEvent {
  const pubkey = getPublicKey(sk);
  const id = getEventHash({ ...template, pubkey });
  const sig = bytesToHex(schnorr.sign(id, sk));
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
    return schnorr.verify(event.sig, event.id, event.pubkey);
  } catch {
    return false;
  }
}
