// 私鑰保管庫（B5，ADR-0053）：把 nsec 從「明文落在 localStorage」抽象成一層可換基質。
//
// - Tauri 執行期：走 OS 安全儲存（Windows Credential Manager / macOS Keychain /
//   Linux Secret Service），經 `key_set/key_get/key_delete` IPC（見 src-tauri keyvault.rs）。
// - 瀏覽器/開發：localStorage 後備，維持既有行為（非原生環境無 OS 金鑰庫）。
//
// 以 pubkey 為鍵，支援多身分（ADR-0045）。介面為 async——原生 IPC 天生非同步；
// 上層在開機時一次載入後交給同步引擎（見 App 開機流程）。

import { isWrapped } from "@cinder/core";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** 私鑰保管庫：以 pubkey 存取該身分的 nsec。 */
export interface KeyVault {
  setKey(pubkey: string, nsec: string): Promise<void>;
  getKey(pubkey: string): Promise<string | null>;
  deleteKey(pubkey: string): Promise<void>;
}

const LS_PREFIX = "nb.key.";

/**
 * 瀏覽器後備（ADR-0112）：**nsec 絕不明文落盤**。
 *
 * 過去這裡直接 `localStorage.setItem(nsec)`——私鑰明文躺在磁碟上。那讓 ADR-0112 的儲存加密
 * 變成演戲（資料金鑰由 nsec 導出，而 nsec 就在旁邊）。
 *
 * 現在只接受 **Argon2id 密碼包裹的 blob**（`wrapSecret`）。收到明文 → **拒絕落盤**
 * ——這是強制點，不是建議：呼叫端若忘了包裹，資料不會被寫出去，而不是靜默地明文寫出去。
 * 不設密碼的使用者 → 不持久化，每次重新輸入 nsec（＝行動端現況，安全）。
 */
export const browserKeyVault: KeyVault = {
  async setKey(pubkey, nsec) {
    if (!isWrapped(nsec)) {
      // 明文私鑰不得落盤（ADR-0112 紅線）。順手清掉可能殘留的舊明文條目。
      try {
        localStorage.removeItem(LS_PREFIX + pubkey);
      } catch {
        /* 忽略 */
      }
      console.warn("[keyvault] 瀏覽器不接受明文 nsec 落盤（ADR-0112）；未設密碼＝不持久化");
      return;
    }
    try {
      localStorage.setItem(LS_PREFIX + pubkey, nsec);
    } catch {
      /* 配額/不可用時忽略 */
    }
  },
  async getKey(pubkey) {
    try {
      return localStorage.getItem(LS_PREFIX + pubkey);
    } catch {
      return null;
    }
  },
  async deleteKey(pubkey) {
    try {
      localStorage.removeItem(LS_PREFIX + pubkey);
    } catch {
      /* 忽略 */
    }
  },
};

/** Tauri：nsec 存 OS 安全儲存（keyring IPC）。 */
export const tauriKeyVault: KeyVault = {
  async setKey(pubkey, nsec) {
    await invoke("key_set", { pubkey, nsec });
  },
  async getKey(pubkey) {
    return (await invoke<string | null>("key_get", { pubkey })) ?? null;
  },
  async deleteKey(pubkey) {
    await invoke("key_delete", { pubkey });
  },
};

/** 依執行環境選用保管庫：Tauri → OS 金鑰庫；否則 localStorage 後備。 */
export function getKeyVault(): KeyVault {
  return isTauri() ? tauriKeyVault : browserKeyVault;
}
