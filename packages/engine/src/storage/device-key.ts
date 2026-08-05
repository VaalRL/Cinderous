// 本機裝置金鑰（ADR-0322 S1）：這台裝置專屬的一把金鑰對，**私鑰永不離開這台**。
//
// ⚠ **不進雲端快照、不進配對捆包、不進 `StorageSnapshot`**——它一旦跨裝置流動，
// 「移除某台裝置」就失去意義（那正是 S2 撤銷成立的前提）。故存在**裝置層**，
// 不在該身分的加密儲存裡。
//
// ## 保管基質（ADR-0323）
//
// 預設是 `getKv()`＝localStorage／MMKV＝**明文落盤**。應用層可注入 OS 金鑰庫
// （`setDeviceKeyVault()`），做法完全比照身分私鑰的 B5（ADR-0053）：
// **優先金鑰庫；金鑰庫尚無但 KV 還有舊的明文金鑰 → 搬進去並抹除明文。**
//
// 因為金鑰庫是非同步的，取用分成兩段：應用啟動時 `await openDeviceKey()` 一次，
// 之後同步的 `getDeviceKey()` 讀快取。沒有 await 也不會壞——退回今天的 KV 路徑，
// 而 `deviceKeyTier()` 會據實回報 `plaintext`。

import { generateSecretKey, getPublicKey, nsecDecode, nsecEncode, type PubkeyHex, type SecretKey } from "@cinderous/core";
import { getKv } from "../kv.js";

const KEY = "nb.deviceKey";
/** 這把金鑰**曾經**明文落盤過（由 KV 遷入金鑰庫者）。不是祕密，故存 KV。 */
const WAS_PLAIN = "nb.deviceKey.wasPlain";
/** 保留槽名：金鑰庫以「身分 pubkey」為帳號名，裝置金鑰借用此固定名（pubkey 恆為 64 hex，不會相撞）。 */
export const DEVICE_KEY_SLOT = "device";

export interface DeviceKey {
  sk: SecretKey;
  pk: PubkeyHex;
}

/**
 * 裝置金鑰目前的保護等級（ADR-0297 §6 分級 ＋ **紅線：設定頁要如實顯示本機在哪一級**）。
 *
 * 🔴 **這裡回報的是「我們實際做了什麼」，不是「這個平台能做到什麼」。**
 * 猜平台會產生一個比實情好看的答案——那正是紅線要擋的
 * （「用最強平台的說法涵蓋最弱平台的現實」）。
 *
 * - `keystore`：OS 金鑰庫／TPM／SE（ADR-0297 L2，磁碟被複製也解不開）
 * - `encrypted`：以**裝置上的另一把金鑰**包裹落地，但那把金鑰是軟體保管的（L1／L0）
 *   ——沒有 TEE／StrongBox 的 Android 機型，或瀏覽器（IndexedDB 內不可匯出的 WebCrypto 金鑰）
 * - `plaintext`：明文存在 KV（localStorage／MMKV）＝**低於 ADR-0297 的 L0**
 *   （L0 的定義是「不明文落盤」）。無金鑰庫的環境（瀏覽器、行動端）是這一級
 * - `ephemeral`：**金鑰庫打不開**（例如 Linux 沒有 Secret Service），這次開機用的是
 *   臨時金鑰、沒有落地 ⇒ 這台不會出現在裝置清單，重開又是新的一把
 */
export type DeviceKeyTier = "keystore" | "encrypted" | "plaintext" | "ephemeral";

/** 非同步的裝置金鑰保管庫（應用層注入；桌面＝OS 金鑰庫）。存放格式為 nsec。 */
export interface DeviceKeyVault {
  load(): Promise<string | null>;
  save(nsec: string): Promise<void>;
  /**
   * 這個保管庫**實際**提供的等級；不實作＝視為 `keystore`。
   *
   * 🔴 存在的理由是 Android：`AndroidKeyStore` 的金鑰**可能是軟體實作**（沒有 TEE／StrongBox 的機型），
   * 那種情況下完整磁碟映像仍可能解得開 ⇒ 只能算 `encrypted`，不能跟硬體支援的混為一談。
   * 「有沒有金鑰庫」和「金鑰庫有沒有硬體」是兩件事，混起來就是 ADR-0297 §6 紅線說的
   * 「用最強平台的說法涵蓋最弱平台的現實」。
   */
  tier?(): Promise<"keystore" | "encrypted">;
}

let vault: DeviceKeyVault | null = null;
let cached: { key: DeviceKey; tier: DeviceKeyTier } | null = null;

/**
 * 換裝置金鑰保管庫（桌面進入點注入 OS 金鑰庫版）。傳 null 還原為預設 KV 基質。
 * **會清掉快取**——換基質後必須重新 `openDeviceKey()`，否則會拿到上一個基質的金鑰。
 */
export function setDeviceKeyVault(v: DeviceKeyVault | null): void {
  vault = v;
  cached = null;
}

/** 這把金鑰是否曾經明文落盤過（遷入金鑰庫者為真）。見 `deviceKeyTier()` 的告白義務。 */
export function deviceKeyEverPlaintext(): boolean {
  try {
    return getKv().getItem(WAS_PLAIN) === "1";
  } catch {
    return false;
  }
}

/**
 * 本機裝置金鑰的保護等級。
 *
 * 🔴 **磁碟被複製 ⇒ 裝置金鑰外洩 ⇒ ADR-0322 的撤銷對那個人無效**，所以這個等級不是裝飾。
 * 沒 `await openDeviceKey()`（或沒裝金鑰庫）時走的就是 KV，故據實回報 `plaintext`。
 */
export function deviceKeyTier(): DeviceKeyTier {
  return cached?.tier ?? "plaintext";
}

const of = (sk: SecretKey): DeviceKey => ({ sk, pk: getPublicKey(sk) });

/**
 * 啟動時取一次裝置金鑰：**優先金鑰庫**，金鑰庫尚無但 KV 有舊的明文金鑰就搬進去並抹除明文
 * （同 ADR-0053 B5 對身分私鑰的做法）。之後同步的 `getDeviceKey()` 讀這裡的快取。
 *
 * 🔴 **順序是「先存進金鑰庫、成功後才刪 KV」**：反過來若存檔失敗，這台的裝置身分就沒了
 * （掉出裝置目錄、要重新授權）。KV 刪除失敗不影響正確性——下次開機仍先讀金鑰庫。
 *
 * 🔴 **金鑰庫打不開時不靜默生一把新的長期金鑰**——那正是 ADR-0122 在身分金鑰上禁止的事
 * （「拿不到金鑰時大聲失敗，而不是靜默產生一把新的把使用者換掉」）。這裡改用臨時金鑰
 * 並回報 `ephemeral`：這台不會進裝置清單，是安全側的失敗方向，而且看得見。
 */
export async function openDeviceKey(): Promise<DeviceKey> {
  if (cached) return cached.key;
  if (!vault) return getDeviceKey();
  const v = vault;
  try {
    const level = v.tier ? await v.tier() : "keystore"; // 保管庫自報實際等級（Android 可能只有軟體）
    const stored = await v.load();
    if (stored) {
      cached = { key: of(nsecDecode(stored)), tier: level };
      return cached.key;
    }
    const kv = getKv();
    const legacy = kv.getItem(KEY);
    if (legacy) {
      await v.save(legacy); // 先存進金鑰庫……
      kv.removeItem(KEY); // ……成功後才抹掉明文
      kv.setItem(WAS_PLAIN, "1"); // 但它曾經明文躺過，設定頁要說（見 deviceKeyEverPlaintext）
      cached = { key: of(nsecDecode(legacy)), tier: level };
      return cached.key;
    }
    const sk = generateSecretKey(); // 生於金鑰庫、從未明文落盤
    await v.save(nsecEncode(sk));
    cached = { key: of(sk), tier: level };
    return cached.key;
  } catch {
    cached = { key: of(generateSecretKey()), tier: "ephemeral" };
    return cached.key;
  }
}

/**
 * 取這台裝置的金鑰對（同步）。已 `openDeviceKey()` 過就回那把；否則走 KV：
 * 沒有就生一把並存下，KV 不可用時**每次生新的**（不落地）——那等於這台永遠進不了目錄，
 * 是安全側的失敗方向（不會誤以為已註冊）。
 */
export function getDeviceKey(): DeviceKey {
  if (cached) return cached.key;
  try {
    const kv = getKv();
    const existing = kv.getItem(KEY);
    if (existing) return of(nsecDecode(existing));
    const sk = generateSecretKey();
    kv.setItem(KEY, nsecEncode(sk));
    return of(sk);
  } catch {
    return of(generateSecretKey());
  }
}
