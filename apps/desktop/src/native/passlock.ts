// 本地密碼（H4，ADR-0067）：前端薄橋——Argon2id KDF 與包裹/解包全在原生層
// （src-tauri passlock.rs），密碼經 IPC 送入、金鑰只在原生記憶體。
//
// 瀏覽器環境不提供此功能：瀏覽器路徑本就無 OS 金鑰庫（ADR-0053 後備為
// localStorage），假裝有密碼保護會是 ADR-0067 否決的「假安全感」。

import { invoke, isTauri } from "@tauri-apps/api/core";

/** 本地密碼功能是否可用（僅 Tauri：KDF 在原生層執行）。 */
export function passwordLockAvailable(): boolean {
  return isTauri();
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
