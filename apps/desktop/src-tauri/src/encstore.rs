//! 加密儲存原語（B2 儲存基質，ADR-0054）：AES-256-GCM，純 Rust（免 OpenSSL/Perl）。
//!
//! 用於把前端整包狀態快照（JSON）加密後落地。金鑰（32 bytes）由 OS 金鑰庫保管
//! （見 keyvault/B5）；本模組只負責加解密原語，不碰金鑰保管與檔案 I/O（那在 main.rs
//! 的 IPC 命令層），故純函式、可 headless 單元測試。
//!
//! 輸出格式：`nonce(12 bytes) ‖ ciphertext`（ciphertext 已含 GCM 認證標籤）。

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};

/// AES-256 金鑰長度（bytes）。
pub const KEY_LEN: usize = 32;
/// GCM nonce 長度（bytes）。
const NONCE_LEN: usize = 12;

/// 加解密失敗（金鑰錯誤、資料竄改或格式不符）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CryptoError(pub String);

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "加密儲存錯誤：{}", self.0)
    }
}

impl std::error::Error for CryptoError {}

/// 產生一把隨機 AES-256 金鑰（供首次建立資料庫時使用；之後存入 OS 金鑰庫）。
pub fn generate_key() -> [u8; KEY_LEN] {
    let key = Aes256Gcm::generate_key(&mut OsRng);
    let mut out = [0u8; KEY_LEN];
    out.copy_from_slice(&key);
    out
}

/// 以 `key` 加密 `plaintext`，輸出 `nonce ‖ ciphertext`（nonce 每次隨機）。
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext).map_err(|e| CryptoError(e.to_string()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// 解密 `nonce ‖ ciphertext`。金鑰錯誤或資料被竄改時回 `Err`（GCM 認證失敗）。
pub fn decrypt(key: &[u8; KEY_LEN], data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if data.len() < NONCE_LEN {
        return Err(CryptoError("資料長度不足（缺 nonce）".into()));
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|e| CryptoError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let key = generate_key();
        let msg = b"{\"contacts\":[{\"pubkey\":\"ab\"}],\"secret\":\"nsec...\"}";
        let ct = encrypt(&key, msg).unwrap();
        assert_ne!(&ct[NONCE_LEN..], &msg[..], "密文不應等於明文");
        assert_eq!(decrypt(&key, &ct).unwrap(), msg);
    }

    #[test]
    fn nonce_is_random_across_encryptions() {
        let key = generate_key();
        let a = encrypt(&key, b"same").unwrap();
        let b = encrypt(&key, b"same").unwrap();
        assert_ne!(a, b, "同明文兩次加密應因 nonce 不同而不同密文");
    }

    #[test]
    fn wrong_key_fails() {
        let ct = encrypt(&generate_key(), b"hello").unwrap();
        assert!(decrypt(&generate_key(), &ct).is_err(), "錯金鑰應解密失敗");
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let key = generate_key();
        let mut ct = encrypt(&key, b"hello world").unwrap();
        let last = ct.len() - 1;
        ct[last] ^= 0x01; // 翻一個位元
        assert!(decrypt(&key, &ct).is_err(), "竄改後 GCM 認證應失敗");
    }
}
