// 網頁／行動端的靜態加密（ADR-0112）。
//
// 桌面的儲存早就是加密的（`encstore`，AES-256-GCM，金鑰在 OS 金鑰庫，ADR-0054）。
// 但 **localStorage 與 OPFS 是明文**——訊息、聯絡人、群組全都躺在磁碟上可直接讀。
//
// ## 為什麼是同步的 AES-GCM，不是 WebCrypto
//
// `localStorage.setItem` 是**同步**的，而 `crypto.subtle` 是**非同步**的——直接打架。
// 本專案已有 `@noble/ciphers` 的同步 AES-256-GCM（`encryptBundle`／`decryptBundle`，
// 配對搬家在用），直接複用即可，不引入新機制。
//
// ## 金鑰從哪來：nsec
//
// DEK = HKDF-SHA256(nsec)。**不引入新的金鑰材料**——nsec 本來就是使用者的根秘密。
//
// **關鍵推論**：這個加密只有在 **nsec 不明文落盤**時才是真的。若 nsec 就躺在同一個
// localStorage 裡，金鑰等於附在鎖旁邊——那是演戲，不是加密。故 ADR-0112 同時規定
// **web/mobile 一律不明文儲存 nsec**（要記住就設密碼，見 `passlock-web.ts`）。

import { decryptBundle, encryptBundle } from "./pairing.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToUtf8, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";

/** HKDF 的 info（版本化：日後換演算法可平行共存）。 */
const INFO = "cinder-storage-v1";

/**
 * 密文前綴。用來**區分舊的明文值**——ADR-0112 之前存下的資料沒有前綴，
 * 必須照常讀得出來（否則升級＝資料全毀），並在下次寫入時自動轉成密文。
 */
const PREFIX = "c1:";

/** 由 nsec 導出儲存金鑰（32 bytes）。 */
export function deriveStorageKey(secretKey: Uint8Array): Uint8Array {
  return hkdf(sha256, secretKey, undefined, INFO, 32);
}

/** 加密一個儲存值（`c1:` ＋ base64(`nonce || ciphertext`)）。 */
export function sealValue(key: Uint8Array, plaintext: string): string {
  return PREFIX + base64.encode(encryptBundle(key, utf8ToBytes(plaintext)));
}

/**
 * 解密一個儲存值。
 *
 * - 無前綴 → **舊的明文值**，原樣回傳（遷移路徑；下次寫入會自動加密）。
 * - 有前綴但解不開（金鑰錯／遭竄改）→ `null`。**不可**當成明文回傳，否則竄改就變成靜默的
 *   資料污染。
 */
export function openValue(key: Uint8Array, stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    return bytesToUtf8(decryptBundle(key, base64.decode(stored.slice(PREFIX.length))));
  } catch {
    return null;
  }
}

/** 這個值是否已是密文（供測試與遷移檢查）。 */
export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
