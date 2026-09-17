//! 金鑰庫帳號的信任邊界（ADR-0128 在 OS 金鑰庫上的落實）。
//!
//! ## 為什麼這需要一個獨立模組
//!
//! `key_set` / `key_get` / `key_delete` 三個 command 對 webview 開放，而**帳號名是前端給的
//! 字串**。金鑰庫裡除了身分私鑰，還住著別的東西：
//!
//! | 帳號 | 內容 | 誰在用 |
//! | --- | --- | --- |
//! | `<64 位十六進位>` | 身分私鑰（nsec） | 前端（合法） |
//! | `device` | 裝置金鑰（ADR-0323） | 前端（合法） |
//! | `cf:deploy` | Cloudflare 部署 token（ADR-0356） | **只有 Rust** |
//! | `ai:<provider>:<host>` | AI 供應商金鑰（ADR-0235） | **只有 Rust** |
//! | `db:<namespace>` | 儲存加密金鑰（ADR-0054） | **只有 Rust** |
//! | `rescue:<namespace>` | 忘記密碼救援 blob（ADR-0073） | **只有 Rust** |
//!
//! 🔴 少了這道閘，一行 `invoke('key_get', { pubkey: 'cf:deploy' })` 就讓任何 XSS 拿到使用者
//! **整個 Cloudflare 帳號的控制權**；`key_set` 反向更糟——攻擊者換掉那把 token，使用者
//! 下次按部署就是往攻擊者的帳號部署。ADR-0356 §1 花了整節論證「token 留在 Rust 這側」，
//! 而那個論證被這個既有 command 整個繞過。
//!
//! ## 為什麼住在這裡而不是 `keyvault`
//!
//! `keyvault` 掛在 `keyring` feature 底下，而那個 feature **不在 default 裡**（它的測試需要
//! 真實的 OS 金鑰庫，CI 容器裡跑不動）。守衛放在那裡等於 `cargo test` 永遠測不到它。
//! 這裡是純字串判斷、零相依，所以預設就編譯、預設就被測。

/// 裝置金鑰的固定帳號（對應 `@cinderous/engine` 的 `DEVICE_KEY_SLOT`）。
const DEVICE_SLOT: &str = "device";

/// 身分公鑰的長度（十六進位字元數）。
const PUBKEY_HEX_LEN: usize = 64;

/// 這個帳號名**可不可以由 webview 指定**。
///
/// 允許的只有兩種：64 位十六進位的身分公鑰，以及裝置金鑰那一個固定槽。
/// 其餘一律拒絕——它們是 Rust 那側自己用的，前端沒有任何正當理由讀寫。
pub fn is_frontend_account(account: &str) -> bool {
    account == DEVICE_SLOT
        || (account.len() == PUBKEY_HEX_LEN && account.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identities_and_the_device_slot_are_allowed() {
        assert!(is_frontend_account(&"a".repeat(64)));
        assert!(is_frontend_account(&"0123456789abcdefABCDEF".repeat(3)[..64]));
        assert!(is_frontend_account("device"));
    }

    #[test]
    fn rust_only_secrets_are_not_nameable_from_the_webview() {
        // 🔴 這一條是整個守衛存在的理由。每一個都曾經是 `key_get` 拿得到的。
        for bad in [
            "cf:deploy",                // 整個 Cloudflare 帳號的控制權
            "ai:openai:api.openai.com", // AI 供應商金鑰
            "ai:ollama:localhost",
            "db:default",     // 儲存加密金鑰
            "rescue:default", // 救援 blob
        ] {
            assert!(!is_frontend_account(bad), "{bad} 不該被前端指名");
        }
    }

    #[test]
    fn near_misses_are_rejected() {
        for bad in [
            "",
            "DEVICE",   // 大小寫不同就不是那個槽
            "device ",  // 尾隨空白
            " device",
            &"a".repeat(63),                 // 短一位
            &"a".repeat(65),                 // 長一位
            &format!("{}g", "a".repeat(63)), // 非十六進位字元
            &format!("{}:", "a".repeat(63)), // 帶分隔符
        ] {
            assert!(!is_frontend_account(bad), "{bad:?} 不該通過");
        }
    }
}
