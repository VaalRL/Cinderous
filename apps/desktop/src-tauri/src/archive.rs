//! 訊息封存的落地（ADR-0111）＋**每塊一把隨機金鑰**（ADR-0413，ADR-0298 §2 的第一階段）。
//!
//! 檔案佈局（`<store>/<ns>/archive/`）：
//!
//! ```text
//! <convo>.<seq>.enc   塊本體＝encrypt(K_seg, json)
//! <convo>.<seq>.key   塊金鑰的包裹＝encrypt(root, K_seg)；K_seg 是建立時隨機產生的 32 bytes
//! ```
//!
//! # 為什麼要多一層
//!
//! 過去每一塊都直接用資料庫金鑰（`root`）加密，而「刪除」只是 `remove_file`。在 flash 與
//! 日誌式檔案系統上，刪檔不保證位元組被抹掉——殘留的塊**拿到 `root` 就照樣解得開**。
//!
//! 現在刪除對話＝**先銷毀 `.key`**（幾十個位元組，覆寫後刪除），再刪塊。塊金鑰是隨機的、
//! 不是從 `root` 導出的，所以沒有那個包裹就**沒有任何辦法重建**——殘留的塊變成解不開的亂數，
//! 即使對方有 `root`（或 nsec、或密碼）。要銷毀的東西從「整段歷史」縮成「幾十個位元組」。
//!
//! ⚠ 這是**量的改善，不是質的保證**（ADR-0298 §6）：`.key` 自己也寫在同一個介質上，
//! 理論上同樣可能留下殘留。能真正銷毀根秘密的只有硬體（TPM／Secure Enclave，ADR-0297）。
//!
//! # 舊塊
//!
//! 升級前寫下的塊沒有 `.key`，仍直接用 `root` 解（讀得到，但沒有上面的刪除保障）。
//! **不整批重新加密**：重寫只會多一份新檔，舊密文的殘留還是在介質上、還是用 `root` 解得開，
//! 換不到任何保障，卻要承擔中途失敗的風險。
//!
//! 住在 lib 而不是 `main.rs`：`cargo test` 編不到 bin target（見 `partfile.rs` 的說明）。

use std::path::Path;

use crate::encstore::{self, KEY_LEN};
use crate::partfile::{atomic_write, quarantine, valid_part};

const CHUNK_EXT: &str = "enc";
const KEY_EXT: &str = "key";

fn chunk_path(dir: &Path, convo: &str, seq: u32) -> std::path::PathBuf {
    dir.join(format!("{convo}.{seq}.{CHUNK_EXT}"))
}

fn key_path(dir: &Path, convo: &str, seq: u32) -> std::path::PathBuf {
    dir.join(format!("{convo}.{seq}.{KEY_EXT}"))
}

fn check(convo: &str) -> Result<(), String> {
    if valid_part(convo) {
        Ok(())
    } else {
        Err("非法對話鍵".into())
    }
}

/// 封存一塊：產生隨機塊金鑰 → 寫包裹 → 寫塊本體。
///
/// **順序**：先包裹、後塊。中途當機留下的是「有包裹、沒有塊」——塊數以 `.enc` 計，
/// 所以下一次 append 會用同一個 `seq` 重來，並以新金鑰覆蓋這份孤兒包裹。反過來（先塊後包裹）
/// 當機會留下一個**沒有金鑰的塊**，等於那一塊訊息遺失。
pub fn append(dir: &Path, root: &[u8; KEY_LEN], convo: &str, seq: u32, json: &str) -> Result<(), String> {
    check(convo)?;
    let seg = encstore::generate_key();
    let wrapped = encstore::encrypt(root, &seg).map_err(|e| e.to_string())?;
    atomic_write(&key_path(dir, convo, seq), &wrapped)?;
    let ciphertext = encstore::encrypt(&seg, json.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&chunk_path(dir, convo, seq), &ciphertext)
}

/// 某對話的封存塊數（= 最大 seq + 1；無封存回 0）。只數 `.enc`，不數 `.key`。
pub fn count(dir: &Path, convo: &str) -> Result<u32, String> {
    check(convo)?;
    let prefix = format!("{convo}.");
    let suffix = format!(".{CHUNK_EXT}");
    let mut max: i64 = -1;
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(rest) = name.strip_prefix(&prefix).and_then(|r| r.strip_suffix(&suffix)) else {
            continue;
        };
        if let Ok(seq) = rest.parse::<i64>() {
            if seq > max {
                max = seq;
            }
        }
    }
    Ok((max + 1) as u32)
}

/// 讀某對話的第 `seq` 塊；不存在或解不開回 `None`（單一塊毀損不拖垮其餘塊）。
pub fn load(dir: &Path, root: &[u8; KEY_LEN], convo: &str, seq: u32) -> Result<Option<String>, String> {
    check(convo)?;
    let path = chunk_path(dir, convo, seq);
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let key = match std::fs::read(key_path(dir, convo, seq)) {
        // 有包裹：解不開（換了資料庫金鑰／遭竄改）就是讀不到，**不退回用 root 直接解**——
        // 那一塊本來就不是用 root 加密的，退回只會把它誤判成毀損而隔離。
        Ok(wrapped) => match encstore::decrypt(root, &wrapped) {
            Ok(k) if k.len() == KEY_LEN => {
                let mut seg = [0u8; KEY_LEN];
                seg.copy_from_slice(&k);
                seg
            }
            _ => return Ok(None),
        },
        // 沒有包裹＝升級前的舊塊，直接用 root。
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => *root,
        Err(e) => return Err(e.to_string()),
    };
    let Ok(plain) = encstore::decrypt(&key, &data) else {
        quarantine(&path); // 留下來別讓它被覆蓋
        return Ok(None);
    };
    Ok(String::from_utf8(plain).ok())
}

/// 銷毀一份金鑰包裹：先以等長的零覆寫、再刪除。
///
/// 覆寫是**盡力而為**：在傳統硬碟上有效；在 flash 上控制器可能把新內容寫到別的區塊，
/// 舊位元組仍在（見模組說明的 ⚠）。不因此省略——幾十個位元組，成本近乎零。
fn destroy_key(path: &Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::write(path, vec![0u8; meta.len() as usize]);
    }
    let _ = std::fs::remove_file(path);
}

/// 移除某對話的**全部**封存（刪好友／封鎖／退群）：**先銷毀所有金鑰包裹，再刪塊**。
///
/// 順序是重點：包裹沒了，塊就算刪不乾淨也解不開。反過來做，中途當機會留下
/// 「塊刪了一半、金鑰全都還在」。
pub fn remove(dir: &Path, convo: &str) -> Result<(), String> {
    check(convo)?;
    let prefix = format!("{convo}.");
    let mut keys = Vec::new();
    let mut chunks = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(&prefix) {
            continue;
        }
        if name.ends_with(&format!(".{KEY_EXT}")) {
            keys.push(entry.path());
        } else if name.ends_with(&format!(".{CHUNK_EXT}")) {
            chunks.push(entry.path());
        }
    }
    for k in &keys {
        destroy_key(k);
    }
    for c in &chunks {
        let _ = std::fs::remove_file(c);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cinder-archive-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn roundtrip_and_count_ignores_key_files() {
        let dir = tmpdir("roundtrip");
        let root = encstore::generate_key();
        assert_eq!(count(&dir, "bob").unwrap(), 0);
        append(&dir, &root, "bob", 0, "[1]").unwrap();
        append(&dir, &root, "bob", 1, "[2]").unwrap();
        assert_eq!(count(&dir, "bob").unwrap(), 2, "`.key` 不算塊");
        assert_eq!(load(&dir, &root, "bob", 0).unwrap().as_deref(), Some("[1]"));
        assert_eq!(load(&dir, &root, "bob", 1).unwrap().as_deref(), Some("[2]"));
        assert_eq!(load(&dir, &root, "bob", 2).unwrap(), None);
        assert_eq!(count(&dir, "alice").unwrap(), 0);
    }

    /// 🔴 ADR-0413 的核心：塊本體**不是**用 root 加密的——只拿到塊的殘留與 root 解不開。
    #[test]
    fn chunk_is_not_decryptable_with_root_alone() {
        let dir = tmpdir("not-root");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "週五老地方見").unwrap();
        let chunk = std::fs::read(chunk_path(&dir, "bob", 0)).unwrap();
        assert!(encstore::decrypt(&root, &chunk).is_err());
    }

    /// 🔴 刪除之後，就算塊的位元組一個都沒少（模擬介質殘留），有 root 也解不開。
    #[test]
    fn removed_conversation_residue_is_undecryptable_even_with_root() {
        let dir = tmpdir("shred");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "去年的事").unwrap();
        append(&dir, &root, "bob", 1, "上週的事").unwrap();
        // 介質上的殘留：刪除前的塊位元組。
        let residue: Vec<Vec<u8>> = (0..2).map(|s| std::fs::read(chunk_path(&dir, "bob", s)).unwrap()).collect();

        remove(&dir, "bob").unwrap();
        assert_eq!(count(&dir, "bob").unwrap(), 0);
        assert!(!key_path(&dir, "bob", 0).exists() && !key_path(&dir, "bob", 1).exists());

        // 把殘留原樣寫回去（最壞情況：刪檔一個位元組都沒抹掉）。
        for (s, bytes) in residue.iter().enumerate() {
            std::fs::write(chunk_path(&dir, "bob", s as u32), bytes).unwrap();
            assert!(encstore::decrypt(&root, bytes).is_err(), "root 直接解不開");
        }
        // 走正規讀取路徑也讀不到（沒有包裹 → 當成舊塊用 root 解 → 失敗）。
        assert_eq!(load(&dir, &root, "bob", 0).unwrap(), None);
        assert_eq!(load(&dir, &root, "bob", 1).unwrap(), None);
    }

    /// 每塊各自一把金鑰：同樣的內容，兩塊的包裹解出來不同。
    #[test]
    fn each_chunk_gets_its_own_random_key() {
        let dir = tmpdir("distinct");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "x").unwrap();
        append(&dir, &root, "bob", 1, "x").unwrap();
        let k0 = encstore::decrypt(&root, &std::fs::read(key_path(&dir, "bob", 0)).unwrap()).unwrap();
        let k1 = encstore::decrypt(&root, &std::fs::read(key_path(&dir, "bob", 1)).unwrap()).unwrap();
        assert_eq!(k0.len(), KEY_LEN);
        assert_ne!(k0, k1);
    }

    /// 升級前的舊塊（直接用 root 加密、沒有 `.key`）照常讀得到。
    #[test]
    fn legacy_chunk_without_key_file_still_loads() {
        let dir = tmpdir("legacy");
        let root = encstore::generate_key();
        let legacy = encstore::encrypt(&root, "舊資料".as_bytes()).unwrap();
        std::fs::write(chunk_path(&dir, "bob", 0), legacy).unwrap();
        assert_eq!(load(&dir, &root, "bob", 0).unwrap().as_deref(), Some("舊資料"));
        // 之後追加的新塊走新格式，兩種並存。
        append(&dir, &root, "bob", 1, "新資料").unwrap();
        assert_eq!(count(&dir, "bob").unwrap(), 2);
        assert_eq!(load(&dir, &root, "bob", 1).unwrap().as_deref(), Some("新資料"));
    }

    /// 移除只動這個對話：鄰居（含名稱是它前綴的）不受影響。
    #[test]
    fn remove_only_touches_that_conversation() {
        let dir = tmpdir("scope");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "b").unwrap();
        append(&dir, &root, "bobby", 0, "bb").unwrap();
        remove(&dir, "bob").unwrap();
        assert_eq!(load(&dir, &root, "bob", 0).unwrap(), None);
        assert_eq!(load(&dir, &root, "bobby", 0).unwrap().as_deref(), Some("bb"));
    }

    /// 錯的 root（換了資料庫金鑰）讀不到，而且**不把塊隔離掉**——金鑰回來就還讀得到。
    #[test]
    fn wrong_root_reads_nothing_and_does_not_quarantine() {
        let dir = tmpdir("wrong-root");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "x").unwrap();
        assert_eq!(load(&dir, &encstore::generate_key(), "bob", 0).unwrap(), None);
        assert_eq!(load(&dir, &root, "bob", 0).unwrap().as_deref(), Some("x"));
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = tmpdir("traversal");
        let root = encstore::generate_key();
        assert!(append(&dir, &root, "../evil", 0, "x").is_err());
        assert!(load(&dir, &root, "a/b", 0).is_err());
        assert!(count(&dir, "").is_err());
        assert!(remove(&dir, "..").is_err());
    }
}
