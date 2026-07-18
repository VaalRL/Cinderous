// 本地密碼（H4，ADR-0067）：前端薄橋。
//
// - **Tauri**：Argon2id KDF 與包裹/解包在原生層（`src-tauri/passlock.rs`），密碼經 IPC 送入。
// - **瀏覽器**（ADR-0112）：同一套 Argon2id（`@noble/hashes`，參數與 Rust 版一致），在 JS 內執行。
//
// ADR-0067 原本以「假安全感」為由不在瀏覽器提供密碼保護。**那個推論是錯的**：
// 不提供的結果不是「誠實」，而是 **nsec 明文躺在 localStorage**。
// Argon2id 包裹在瀏覽器提供的是**與桌面相同**的靜態保護——KEK 由密碼導出、從不落盤。
// 它擋不住頁面內的惡意 JS，但桌面的 webview 同樣擋不住；差別只在 OS 帳號那道邊界。
// ADR-0112 修正這一點。

import { isWrapped, unwrapSecret, wrapSecret } from "@cinderous/core";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { browserKeyVault } from "./keyvault.js";

/** 本地密碼功能是否可用。瀏覽器亦可（ADR-0112：Argon2id 在 JS 執行）。 */
export function passwordLockAvailable(): boolean {
  return true;
}

/** 瀏覽器：以密碼包裹 nsec 並落盤（金鑰庫只收包裹過的值，見 `keyvault.ts`）。 */
export async function browserPassEnable(pubkey: string, nsec: string, password: string): Promise<void> {
  await browserKeyVault.setKey(pubkey, wrapSecret(password, nsec));
}

/** 瀏覽器：以密碼解開 nsec；密碼錯誤/遭竄改回 null。 */
export async function browserPassUnlock(pubkey: string, password: string): Promise<string | null> {
  const blob = await browserKeyVault.getKey(pubkey);
  if (!blob || !isWrapped(blob)) return null;
  return unwrapSecret(password, blob);
}

/**
 * 瀏覽器：這個身分有沒有被「記住」（存在 Argon2id 包裹的 blob）？（ADR-0122）
 *
 * **只認包裹過的 blob**（比照行動端 ADR-0117 的 `isRemembered`）：有人（或某個未來的 bug）
 * 往那個鍵塞明文 nsec，一律不收——當作沒有記住的身分，而不是拿它當金鑰用。
 */
export async function browserIsRemembered(pubkey: string): Promise<boolean> {
  const blob = await browserKeyVault.getKey(pubkey);
  return !!blob && isWrapped(blob);
}

/**
 * 瀏覽器：忘記這個身分（刪掉包裹的 blob）。（ADR-0122）
 *
 * **這就是瀏覽器的「停用密碼」**。桌面的停用是把明文 nsec 寫回 OS 金鑰庫（信任邊界移交給
 * OS 帳號）——**瀏覽器沒有那個東西**。這裡沒有任何安全的明文去處，那正是 ADR-0112 的前提。
 * 所以停用只能是「不再記住」：下次開啟要重貼 nsec。
 */
export async function browserPassForget(pubkey: string): Promise<void> {
  await browserKeyVault.deleteKey(pubkey);
}

/**
 * 值是否為密碼包裹 blob（對齊 Rust passlock::is_wrapped；審查修正 #3）。
 * nsec（bech32）與 db 金鑰（base64）皆非 JSON 物件；加密備份碼信封（ADR-0070）
 * 有 v:1 但無 kdf 欄——不會誤判。
 */
export function isWrappedValue(value: string): boolean {
  try {
    const p = JSON.parse(value) as { v?: unknown; kdf?: unknown };
    return p.v === 1 && p.kdf === "argon2id";
  } catch {
    return false;
  }
}

/** 某身分是否已啟用本地密碼（以金鑰庫實況為準）。 */
export async function passStatus(pubkey: string): Promise<boolean> {
  return await invoke<boolean>("pass_status", { pubkey });
}

/** 啟用：包裹 nsec＋db 金鑰、取代金鑰庫明文條目。呼叫前 UI 須完成 nsec 備份確認。 */
export async function passEnable(namespace: string, pubkey: string, password: string): Promise<void> {
  await invoke("pass_enable", { namespace, pubkey, password });
}

/** 解鎖：驗密碼、回傳 nsec（供建後端）並在原生層快取 db 金鑰。密碼錯誤 reject。 */
export async function passUnlock(namespace: string, pubkey: string, password: string): Promise<string> {
  return await invoke<string>("pass_unlock", { namespace, pubkey, password });
}

/** 上鎖（閒置逾時/登出）：清除原生層快取的 db 金鑰。 */
export async function passLock(namespace: string): Promise<void> {
  await invoke("pass_lock", { namespace });
}

/** 改密碼＝重包裹（資料金鑰不變）。 */
export async function passChange(namespace: string, pubkey: string, oldPassword: string, newPassword: string): Promise<void> {
  await invoke("pass_change", { namespace, pubkey, old: oldPassword, new: newPassword });
}

/** 停用：驗密碼後把明文寫回金鑰庫（信任邊界回到 OS 帳號）。 */
export async function passDisable(namespace: string, pubkey: string, password: string): Promise<void> {
  await invoke("pass_disable", { namespace, pubkey, password });
}

/**
 * 忘記密碼救援（ADR-0073）：以 nsec 解開資料金鑰的第二道包裹、設新密碼、救回舊本地資料。
 * 回傳 nsec（供建後端）。nsec 不符或無救援資料時 reject。
 */
export async function passRescue(namespace: string, pubkey: string, nsec: string, newPassword: string): Promise<string> {
  return await invoke<string>("pass_rescue", { namespace, pubkey, nsec, newPassword });
}
