// 混合式金鑰封裝：古典 ECDH ＋ ML-KEM-768（後量子 EK，Phase 2）。
//
// ## 為什麼需要它
//
// NIP-44 的對話金鑰是 `ECDH(寄件者私鑰, 收件者公鑰)`，而收件者公鑰**就是 npub**——
// 公開在每一個中繼站上。一個有量子電腦的攻擊者要解開側錄的密文，只需要**密文與 npub**，
// 不需要偷任何私鑰。
//
// ⚠ **而 ADR-0238 的前向保密對這種攻擊完全不生效**：它靠的是收件人**刪掉** `priv(EK_e)`，
// 那防的是「失竊」；量子攻擊者不需要你那一份，他從公開的 `pub(EK_e)`（kind 10040 明文公告）
// **算出來**。⇒ 我們二十多份 FS 的 ADR 在這個威脅模型下價值是零。
//
// 詳見 `docs/research/post-quantum-ek-plan.md` 與 `signal-triple-ratchet-applicability.md`。
//
// ## 🔴 這個檔案是整個計畫風險最高的地方
//
// 混合式 KDF 若把**古典那一半接錯**（域分離寫錯、某條路徑漏掉 `ssClassic`），
// 結果是**降低了古典安全性**去換一個還沒人需要的後量子性質——
// 而且**不會有任何測試會紅**：兩邊照樣算得出同一把金鑰，訊息一切正常。
//
// ⇒ 本檔的每一個決定都寫出理由，並以測試釘住「少任何一半就導不出同一把金鑰」。
// ⚠ 但測試擋不住設計層的錯誤，**外部密碼學審計仍是唯一的解**（ADR-0306）。
//
// ## 這一層**不**做什麼
//
// - 不碰 NIP-44 的線路格式：`nip44.encrypt(明文, 對話金鑰)` 的第二個參數是**參數**，
//   我們只改「怎麼算出那把金鑰」，payload 仍是 NIP-44 v2。
// - 不做棘輪、不持有狀態：每則訊息各自封裝一次（見計畫 §2.3 為何無狀態）。

import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

/** ML-KEM-768 封裝金鑰（公鑰）長度。 */
export const PQ_PUBLIC_KEY_BYTES = 1184;
/** ML-KEM-768 解封裝金鑰（私鑰）長度。 */
export const PQ_SECRET_KEY_BYTES = 2400;
/** ML-KEM-768 密文長度。**每則訊息要多帶這麼多**（base64 後 1452）。 */
export const PQ_CIPHERTEXT_BYTES = 1088;

/**
 * 混合式金鑰導出的域分離字串。
 *
 * 版本字串寫死在這裡是刻意的：日後若換 KEM 參數集或改組合方式，**必須**同時改這個字串，
 * 否則新舊兩版會導出同一把金鑰而沒有人發現。
 */
const HYBRID_LABEL = "cinder-ek-pq-v1";

/** 一對 ML-KEM-768 金鑰。 */
export interface PqKeyPair {
  /** 解封裝金鑰（私鑰），2400 bytes。 */
  sk: Uint8Array;
  /** 封裝金鑰（公鑰），1184 bytes。公告在 kind 10040 的 `pq` 欄位。 */
  pk: Uint8Array;
}

/** 產生一對 ML-KEM-768 金鑰（與古典 EK 同壽命：每週一把、grace 7 天）。 */
export function generatePqKey(): PqKeyPair {
  const kp = ml_kem768.keygen();
  return { sk: kp.secretKey, pk: kp.publicKey };
}

/** 封裝（寄件端）：對收件人的 `pk` 產生一份密文與共享祕密。 */
export function pqEncapsulate(pk: Uint8Array): { ct: Uint8Array; ss: Uint8Array } {
  const r = ml_kem768.encapsulate(pk);
  return { ct: r.cipherText, ss: r.sharedSecret };
}

/**
 * 解封裝（收件端）。
 *
 * ⚠ **ML-KEM 用的是隱式拒絕**：密文被竄改或金鑰不對時**不會拋錯**，而是回一把
 * 偽隨機的共享祕密 ⇒ 最終在 NIP-44 那層以 MAC 驗證失敗呈現（落進 ADR-0316 的
 * `maybeEkLoss` 桶）。這是**期望行為**，不是缺陷——但讀這段程式的人要知道
 * 「`pqDecapsulate` 成功回傳」**不代表**密文是好的。
 */
export function pqDecapsulate(sk: Uint8Array, ct: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(ct, sk);
}

/**
 * 由古典與後量子兩個共享祕密導出 NIP-44 的對話金鑰（32 bytes）。
 *
 * ```
 * K = HKDF-SHA256(
 *       ikm  = ssClassic ‖ ssPq,          // 🔴 兩半都要，少一半就導不出同一把
 *       salt = SHA256(HYBRID_LABEL),      // 固定域分離
 *       info = layer ‖ ct,                // 綁定「哪一層」與「這份 KEM 密文」
 *     )
 * ```
 *
 * ### 為什麼是這個形狀
 *
 * - **串接兩個祕密再過 KDF**：這是 Signal／Apple／OpenSSH／TLS 混合部署的共同做法。
 *   性質是「攻擊者要同時打破古典與後量子兩邊才有用」——只破一邊，`ikm` 仍有另一半的熵。
 * - **古典那半排在前面且永不省略**：`ssClassic` 是 `undefined` 時**直接拋**（見下），
 *   不是靜默退回純後量子。那個靜默正是本檔頭警告的失敗模式。
 * - **`ct` 進 `info`（綁定 transcript）**：ML-KEM 是 IND-CCA2，`ss` 本就綁著 `ct`，
 *   這一步是保守的額外綁定（同 X-Wing 等組合器的做法），成本為零。
 * - **`layer` 進 `info`**：seal 與 wrap 兩層共用同一份 `ssPq`（只帶一份 `ct` 省 1452 bytes），
 *   靠這個標籤做域分離 ⇒ 兩層導出的金鑰不同。
 *
 * ⚠ **我們沒有照搬任何一個已發表的組合器**（X-Wing 綁的是 X25519，我們是 secp256k1，
 * 且 NIP-44 要的是 HKDF 輸出）。這個構造是依標準做法組出來的，**尚未經過外部審計**。
 *
 * @throws 任一半缺少或長度為 0 時拋——**fail-closed，絕不靜默降級**。
 */
export function hybridConversationKey(args: {
  /** 古典 ECDH 的共享祕密（32 bytes）。 */
  ssClassic: Uint8Array;
  /** ML-KEM 的共享祕密（32 bytes）。 */
  ssPq: Uint8Array;
  /** 這則訊息的 KEM 密文（綁定用）。 */
  ct: Uint8Array;
  /** 層別標籤：`"seal"` 或 `"wrap"`（NIP-59 的兩層各自導出不同金鑰）。 */
  layer: "seal" | "wrap";
}): Uint8Array {
  const { ssClassic, ssPq, ct, layer } = args;
  // 🔴 fail-closed：任一半缺席就拋。靜默退回單邊＝本檔頭警告的那個失敗模式，
  //    而它在測試裡看起來一切正常（兩端照樣算得出同一把金鑰）。
  if (ssClassic.length === 0) throw new Error("hybrid-kem：缺少古典共享祕密（拒絕只用後量子）");
  if (ssPq.length === 0) throw new Error("hybrid-kem：缺少後量子共享祕密（拒絕只用古典）");
  if (ct.length !== PQ_CIPHERTEXT_BYTES) throw new Error("hybrid-kem：KEM 密文長度不正確");

  const ikm = new Uint8Array(ssClassic.length + ssPq.length);
  ikm.set(ssClassic, 0);
  ikm.set(ssPq, ssClassic.length);

  const label = utf8ToBytes(`${HYBRID_LABEL}:${layer}`);
  const info = new Uint8Array(label.length + ct.length);
  info.set(label, 0);
  info.set(ct, label.length);

  return hkdf(sha256, ikm, sha256(utf8ToBytes(HYBRID_LABEL)), info, 32);
}
