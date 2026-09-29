// 網頁／行動端的密碼包裹（ADR-0112）：Argon2id KEK 包裹 nsec。
//
// 桌面把 nsec 託給 **OS 金鑰庫**（ADR-0053），並可再加一層本地密碼（ADR-0067 `passlock.rs`）。
// **瀏覽器沒有金鑰庫**——桌面在瀏覽器模式下是直接把 nsec **明文寫進 localStorage** 的。
//
// 那讓 ADR-0112 的儲存加密變成**演戲**：DEK 由 nsec 導出，而 nsec 就躺在同一個 localStorage
// 裡——金鑰附在鎖旁邊。
//
// 故：web/mobile **一律不明文存 nsec**。要「記住我」就得設密碼，由本模組以 Argon2id 包裹。
// 參數與桌面 `passlock.rs` **刻意一致**（m=19456 KiB、t=2、p=1，OWASP 建議值）——同一套
// 威脅模型，不該因平台而漂移。

import { decryptBundle, encryptBundle } from "./pairing.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";

/** 與桌面 `passlock.rs` 相同的 Argon2id 參數。 */
const M_COST_KIB = 19_456;
const T_COST = 2;
const P_COST = 1;
const KEY_LEN = 32;
const SALT_LEN = 32;

/** 上限（拒收惡意/毀損 blob 宣告的荒謬參數，避免解鎖時被 DoS）。 */
const M_COST_MAX = 1_048_576; // 1 GiB
const T_COST_MAX = 16;
const P_COST_MAX = 16;

interface Blob {
  v: 1;
  kdf: "argon2id";
  m: number;
  t: number;
  p: number;
  salt: string;
  data: string;
}

/** Argon2 版本 0x13（v1.3，RFC 9106；桌面 `passlock.rs` 的 `Version::V0x13`）。 */
const ARGON2_VERSION = 0x13;

/**
 * 🔴 **每個會影響輸出的參數都明確傳入，不依賴函式庫預設值**（ADR-0374）。
 *
 * `@noble/hashes` 2.4 改了 argon2 的預設值（`t: 3`、`m: 1 GiB`、`maxmem: 1 GiB`；1.x 的
 * `maxmem` 是 2^32−1）。只要有一個參數靠預設，升級相依就會導出**不同的 KEK** ⇒
 * 使用者**再也打不開**自己的密碼鎖，而且沒有任何錯誤訊息，只會看起來像「密碼錯」。
 * `version` 兩版預設都是 0x13，仍寫明，免得下一次改預設時又得重查一遍。
 * `maxmem` 設成本檔自己的上限（`M_COST_MAX` KiB）：凡是 `unwrapSecret` 會接受的 blob，
 * 記憶體檢查都不會擋——與 1.x 可解開的範圍相同。
 */
function deriveKek(password: string, salt: Uint8Array, m: number, t: number, p: number): Uint8Array {
  return argon2id(utf8ToBytes(password), salt, {
    m,
    t,
    p,
    dkLen: KEY_LEN,
    version: ARGON2_VERSION,
    maxmem: M_COST_MAX * 1024,
  });
}

/** 以密碼包裹祕密（nsec）。鹽每次隨機——同輸入兩次包裹會產生不同密文。 */
export function wrapSecret(password: string, plaintext: string): string {
  const salt = randomBytes(SALT_LEN);
  const kek = deriveKek(password, salt, M_COST_KIB, T_COST, P_COST);
  const blob: Blob = {
    v: 1,
    kdf: "argon2id",
    m: M_COST_KIB,
    t: T_COST,
    p: P_COST,
    salt: base64.encode(salt),
    data: base64.encode(encryptBundle(kek, utf8ToBytes(plaintext))),
  };
  return JSON.stringify(blob);
}

/** 這個值是不是密碼包裹的 blob（而不是明文 nsec）。 */
export function isWrapped(value: string): boolean {
  try {
    const b = JSON.parse(value) as Partial<Blob>;
    return b.v === 1 && b.kdf === "argon2id" && typeof b.salt === "string" && typeof b.data === "string";
  } catch {
    return false;
  }
}

/** 以密碼解開；密碼錯誤、遭竄改或參數荒謬皆回 `null`（不區分——不給攻擊者可用的訊號）。 */
export function unwrapSecret(password: string, wrapped: string): string | null {
  let blob: Blob;
  try {
    blob = JSON.parse(wrapped) as Blob;
  } catch {
    return null;
  }
  if (blob.v !== 1 || blob.kdf !== "argon2id") return null;
  // 拒收荒謬的 KDF 參數：毀損或惡意的 blob 不該讓解鎖吃掉 GB 級記憶體。
  if (!(blob.m > 0 && blob.m <= M_COST_MAX)) return null;
  if (!(blob.t > 0 && blob.t <= T_COST_MAX)) return null;
  if (!(blob.p > 0 && blob.p <= P_COST_MAX)) return null;
  try {
    const kek = deriveKek(password, base64.decode(blob.salt), blob.m, blob.t, blob.p);
    return new TextDecoder().decode(decryptBundle(kek, base64.decode(blob.data)));
  } catch {
    return null; // GCM 驗證失敗＝密碼錯或遭竄改
  }
}
