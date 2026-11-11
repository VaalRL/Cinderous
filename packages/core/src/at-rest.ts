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
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
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
  // noble 2.x 的 info 只收 bytes（1.x 會自動 UTF-8 編碼字串）——同樣的位元組 ⇒ 同一把金鑰（ADR-0374）。
  return hkdf(sha256, secretKey, undefined, utf8ToBytes(INFO), 32);
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
    return new TextDecoder().decode(decryptBundle(key, base64.decode(stored.slice(PREFIX.length))));
  } catch {
    return null;
  }
}

/** 這個值是否已是密文（供測試與遷移檢查）。 */
export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

// ── 封存塊金鑰（ADR-0413；ADR-0298 §2 的第一階段）────────────────────────────
//
// 封存的每一塊各用一把**隨機**金鑰加密，那把金鑰再用根金鑰包起來另外存。
// 刪除＝銷毀那份包裹：塊金鑰不是導出的，所以沒有包裹就沒有任何辦法重建——
// 介質上殘留的塊變成解不開的亂數，即使對方有根金鑰（nsec）。
//
// ⚠ 一定要是**隨機**的。若寫成 `hkdf(root, 塊編號)`，有根金鑰的人隨時能重新導出，
// 「銷毀」什麼都沒達成（ADR-0298 §2 初版就錯在這裡）。

/** 封存塊金鑰的包裹前綴（與值的 `c1:` 分開，避免把一般值誤當成金鑰包裹）。 */
const WRAP_PREFIX = "k1:";
const SEGMENT_KEY_BYTES = 32;

/** 產生一把新的封存塊金鑰（隨機 32 bytes）。 */
export function newSegmentKey(): Uint8Array {
  return randomBytes(SEGMENT_KEY_BYTES);
}

/** 用根金鑰包起一把塊金鑰（`k1:` ＋ base64(`nonce || ciphertext`)）。 */
export function wrapSegmentKey(root: Uint8Array, segmentKey: Uint8Array): string {
  return WRAP_PREFIX + base64.encode(encryptBundle(root, segmentKey));
}

/** 解開包裹；根金鑰錯、遭竄改、格式不對、或解出來不是 32 bytes 都回 `null`。 */
export function unwrapSegmentKey(root: Uint8Array, stored: string): Uint8Array | null {
  if (!stored.startsWith(WRAP_PREFIX)) return null;
  try {
    const key = decryptBundle(root, base64.decode(stored.slice(WRAP_PREFIX.length)));
    return key.length === SEGMENT_KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}
