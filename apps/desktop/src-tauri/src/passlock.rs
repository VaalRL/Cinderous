//! 本地密碼（H4，ADR-0067）：以密碼衍生金鑰（Argon2id）包裹身分祕密。
//!
//! 「密碼參與加密」才是真防線：包裹後的密文取代金鑰庫明文條目，拿到金鑰庫
//! 與 `.enc` 也解不開。KDF 在原生層執行（避免 JS 端計時/記憶體弱點）；
//! AEAD 與亂數重用 `encstore`（AES-256-GCM，Fix First）。
//!
//! Blob 格式（JSON 字串，鹽與 KDF 參數隨密文存放）：
//! `{"v":1,"kdf":"argon2id","m":19456,"t":2,"p":1,"salt":"<b64>","data":"<b64 nonce‖ct>"}`
//!
//! 純函式、可 headless 單元測試（`cargo test --features passlock`）。

use crate::encstore;
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Argon2id 參數（OWASP 首推組合：19 MiB 記憶體、2 迭代、1 平行度）。
const M_COST_KIB: u32 = 19_456;
const T_COST: u32 = 2;
const P_COST: u32 = 1;
/// KDF 參數上限（解包時檢查，防惡意 blob 造成資源耗盡）。
const M_COST_MAX: u32 = 1_048_576; // 1 GiB
const T_COST_MAX: u32 = 16;
const P_COST_MAX: u32 = 8;

/// 密碼包裹失敗（密碼錯誤、資料竄改或格式不符）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassError(pub String);

impl std::fmt::Display for PassError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "本地密碼錯誤：{}", self.0)
    }
}

impl std::error::Error for PassError {}

#[derive(Serialize, Deserialize)]
struct Blob {
    v: u8,
    kdf: String,
    m: u32,
    t: u32,
    p: u32,
    salt: String,
    data: String,
}

/// 以密碼＋鹽衍生 32-byte KEK（Argon2id v1.3）。
fn derive_kek(password: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<[u8; encstore::KEY_LEN], PassError> {
    let params = Params::new(m, t, p, Some(encstore::KEY_LEN)).map_err(|e| PassError(e.to_string()))?;
    let a2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; encstore::KEY_LEN];
    a2.hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| PassError(e.to_string()))?;
    Ok(out)
}

/// 以密碼包裹祕密（nsec / db 金鑰 b64）。鹽每次隨機，同輸入兩次包裹產生不同密文。
pub fn wrap(password: &str, plaintext: &str) -> Result<String, PassError> {
    let salt = encstore::generate_key(); // 32 bytes 隨機，重用 encstore 的 OsRng
    let kek = derive_kek(password, &salt, M_COST_KIB, T_COST, P_COST)?;
    let data = encstore::encrypt(&kek, plaintext.as_bytes()).map_err(|e| PassError(e.to_string()))?;
    let blob = Blob {
        v: 1,
        kdf: "argon2id".into(),
        m: M_COST_KIB,
        t: T_COST,
        p: P_COST,
        salt: B64.encode(salt),
        data: B64.encode(data),
    };
    serde_json::to_string(&blob).map_err(|e| PassError(e.to_string()))
}

/// 以密碼解開包裹；密碼錯誤、資料竄改或格式不符回 `Err`。
pub fn unwrap(password: &str, blob_json: &str) -> Result<String, PassError> {
    let blob: Blob = serde_json::from_str(blob_json).map_err(|e| PassError(e.to_string()))?;
    if blob.v != 1 || blob.kdf != "argon2id" {
        return Err(PassError("不支援的包裹版本/KDF".into()));
    }
    if blob.m > M_COST_MAX || blob.t > T_COST_MAX || blob.p > P_COST_MAX {
        return Err(PassError("KDF 參數超出上限".into()));
    }
    let salt = B64.decode(&blob.salt).map_err(|e| PassError(e.to_string()))?;
    let data = B64.decode(&blob.data).map_err(|e| PassError(e.to_string()))?;
    let kek = derive_kek(password, &salt, blob.m, blob.t, blob.p)?;
    let plain = encstore::decrypt(&kek, &data).map_err(|_| PassError("密碼錯誤或資料已損毀".into()))?;
    String::from_utf8(plain).map_err(|e| PassError(e.to_string()))
}

/// 某金鑰庫值是否為密碼包裹 blob（nsec/b64 金鑰皆非 JSON 物件，無誤判空間）。
pub fn is_wrapped(value: &str) -> bool {
    serde_json::from_str::<Blob>(value).map(|b| b.v == 1 && b.kdf == "argon2id").unwrap_or(false)
}

// ── nsec 救援金鑰（ADR-0073）：資料金鑰的第二把鑰匙，供忘記密碼時救援 ──────────

/// 自 nsec 衍生救援金鑰：域分隔雜湊即可——nsec 已是 256-bit 高熵，
/// 不需 Argon2 那種慢雜湊（慢雜湊是給低熵密碼防離線暴力的）。
fn rescue_key(nsec: &str) -> [u8; encstore::KEY_LEN] {
    let mut h = Sha256::new();
    h.update(nsec.trim().as_bytes());
    h.update(b"cinder-rescue-v1");
    let digest = h.finalize();
    let mut out = [0u8; encstore::KEY_LEN];
    out.copy_from_slice(&digest);
    out
}

/// 以 nsec 救援金鑰包裹祕密（db 金鑰 b64）；輸出 `nonce‖ct` 的 base64。
pub fn rescue_wrap(nsec: &str, plaintext: &str) -> Result<String, PassError> {
    let key = rescue_key(nsec);
    let data = encstore::encrypt(&key, plaintext.as_bytes()).map_err(|e| PassError(e.to_string()))?;
    Ok(B64.encode(data))
}

/// 以 nsec 救援金鑰解開包裹；nsec 不符或資料竄改回 Err（GCM 認證失敗）。
pub fn rescue_unwrap(nsec: &str, blob_b64: &str) -> Result<String, PassError> {
    let key = rescue_key(nsec);
    let data = B64.decode(blob_b64).map_err(|e| PassError(e.to_string()))?;
    let plain = encstore::decrypt(&key, &data).map_err(|_| PassError("nsec 不符或救援資料已損毀".into()))?;
    String::from_utf8(plain).map_err(|e| PassError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 測試用低成本參數的包裹（避免每個測試都跑 19 MiB KDF 拖慢 CI）。
    fn wrap_fast(password: &str, plaintext: &str) -> String {
        let salt = encstore::generate_key();
        let kek = derive_kek(password, &salt, 64, 1, 1).unwrap();
        let data = encstore::encrypt(&kek, plaintext.as_bytes()).unwrap();
        serde_json::to_string(&Blob {
            v: 1,
            kdf: "argon2id".into(),
            m: 64,
            t: 1,
            p: 1,
            salt: B64.encode(salt),
            data: B64.encode(data),
        })
        .unwrap()
    }

    #[test]
    fn roundtrip_with_production_params() {
        let blob = wrap("正確密碼 🔑", "nsec1_super_secret").unwrap();
        assert!(is_wrapped(&blob));
        assert!(!blob.contains("nsec1_super_secret"), "blob 不得含明文");
        assert_eq!(unwrap("正確密碼 🔑", &blob).unwrap(), "nsec1_super_secret");
    }

    #[test]
    fn wrong_password_fails() {
        let blob = wrap_fast("right", "secret");
        assert!(unwrap("wrong", &blob).is_err());
        assert!(unwrap("", &blob).is_err());
    }

    #[test]
    fn same_input_different_blob_thanks_to_random_salt() {
        assert_ne!(wrap_fast("pw", "secret"), wrap_fast("pw", "secret"));
    }

    #[test]
    fn tampered_blob_fails() {
        let blob = wrap_fast("pw", "secret");
        let mut b: Blob = serde_json::from_str(&blob).unwrap();
        let mut data = B64.decode(&b.data).unwrap();
        let last = data.len() - 1;
        data[last] ^= 0x01;
        b.data = B64.encode(data);
        assert!(unwrap("pw", &serde_json::to_string(&b).unwrap()).is_err());
    }

    #[test]
    fn refuses_oversized_kdf_params() {
        let blob = wrap_fast("pw", "secret");
        let mut b: Blob = serde_json::from_str(&blob).unwrap();
        b.m = 100_000_000; // 惡意 blob：100 GB 記憶體要求
        assert!(unwrap("pw", &serde_json::to_string(&b).unwrap()).is_err());
    }

    #[test]
    fn is_wrapped_rejects_plaintext_values() {
        assert!(!is_wrapped("nsec1abcdef"));
        assert!(!is_wrapped("aGVsbG8=")); // b64 db 金鑰
        assert!(!is_wrapped("{\"v\":2,\"kdf\":\"argon2id\"}")); // 版本不符
        assert!(!is_wrapped("not json"));
    }

    #[test]
    fn rescue_roundtrip_and_wrong_nsec_fails() {
        let nsec = "nsec1_master_backup";
        let dbkey = "ZGF0YWJhc2Uta2V5LWI2NA==";
        let blob = rescue_wrap(nsec, dbkey).unwrap();
        assert!(!blob.contains(dbkey), "救援 blob 不得含明文金鑰");
        assert_eq!(rescue_unwrap(nsec, &blob).unwrap(), dbkey);
        // 別把 nsec：解不開（GCM 認證失敗）——只有正確 nsec 能救援
        assert!(rescue_unwrap("nsec1_other_identity", &blob).is_err());
    }

    #[test]
    fn rescue_key_normalizes_whitespace() {
        // 使用者貼上的 nsec 可能帶前後空白；trim 後應與原始一致
        let blob = rescue_wrap("nsec1abc", "key").unwrap();
        assert_eq!(rescue_unwrap("  nsec1abc\n", &blob).unwrap(), "key");
    }

    #[test]
    fn rescue_tampered_fails() {
        let mut blob = rescue_wrap("nsec1abc", "key").unwrap();
        let mut raw = B64.decode(&blob).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        blob = B64.encode(raw);
        assert!(rescue_unwrap("nsec1abc", &blob).is_err());
    }
}
