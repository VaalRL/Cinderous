//! OS 金鑰庫（B5，ADR-0053）：私鑰（nsec）託管於作業系統安全儲存
//! （Windows Credential Manager / macOS Keychain / Linux Secret Service），
//! **不再明文落地** localStorage/SQLite。需 `keyring` feature。
//!
//! 以固定 `SERVICE` + **pubkey 為帳號**存放，支援多身分（ADR-0045）——各身分的
//! nsec 互不覆蓋。純同步 API；上層（`#[tauri::command]`）再包成前端可 `invoke` 的橋。

use keyring::{Entry, Error as KeyringError};

/// 金鑰庫服務名稱（同一使用者下所有 Cinder 身分共用；以 pubkey 區分帳號）。
const SERVICE: &str = "app.cinder.desktop";

/// 金鑰庫存取失敗（包住後端錯誤字串，供 IPC 回傳前端）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultError(pub String);

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "金鑰庫錯誤：{}", self.0)
    }
}

impl std::error::Error for VaultError {}

fn entry(pubkey: &str) -> Result<Entry, VaultError> {
    Entry::new(SERVICE, pubkey).map_err(|e| VaultError(e.to_string()))
}

/// 存入（或覆寫）某身分（pubkey）的 nsec。
pub fn set_key(pubkey: &str, nsec: &str) -> Result<(), VaultError> {
    entry(pubkey)?.set_password(nsec).map_err(|e| VaultError(e.to_string()))
}

/// 取出某身分的 nsec；不存在回 `Ok(None)`。
pub fn get_key(pubkey: &str) -> Result<Option<String>, VaultError> {
    match entry(pubkey)?.get_password() {
        Ok(nsec) => Ok(Some(nsec)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(VaultError(e.to_string())),
    }
}

/// 刪除某身分的 nsec（登出/移除身分）；不存在視為成功（冪等）。
pub fn delete_key(pubkey: &str) -> Result<(), VaultError> {
    match entry(pubkey)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(VaultError(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 專用測試帳號，避免與真實身分/其他測試衝突；測前後皆清除。
    const TEST_PUBKEY: &str = "__cinder_keyvault_selftest__do_not_use__";

    #[test]
    fn set_get_delete_roundtrip_and_idempotent_delete() {
        let _ = delete_key(TEST_PUBKEY); // 清掉可能的殘留
        assert_eq!(get_key(TEST_PUBKEY).unwrap(), None, "初始應為空");

        set_key(TEST_PUBKEY, "nsec1_secret_original").unwrap();
        assert_eq!(get_key(TEST_PUBKEY).unwrap().as_deref(), Some("nsec1_secret_original"));

        // 覆寫（同一 pubkey 再存）
        set_key(TEST_PUBKEY, "nsec1_secret_rotated").unwrap();
        assert_eq!(get_key(TEST_PUBKEY).unwrap().as_deref(), Some("nsec1_secret_rotated"));

        delete_key(TEST_PUBKEY).unwrap();
        assert_eq!(get_key(TEST_PUBKEY).unwrap(), None, "刪除後應為空");
        delete_key(TEST_PUBKEY).unwrap(); // 重複刪除視為成功（冪等）
    }
}
