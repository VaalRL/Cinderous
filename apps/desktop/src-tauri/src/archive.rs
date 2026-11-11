//! 訊息封存的落地（ADR-0111）＋**每塊一把隨機金鑰**（ADR-0413，ADR-0298 §2 的第一階段）。
//!
//! 檔案佈局（`<store>/<ns>/archive/`）：
//!
//! ```text
//! <convo>.<seq>.enc         塊本體＝"CSK1" + kid(8 bytes) + encrypt(K_seg, json)
//! <convo>.<seq>.<kid>.key   塊金鑰的包裹＝encrypt(root, K_seg)；K_seg 是建立時隨機產生的 32 bytes
//! ```
//!
//! 塊自己記下用的是哪一份包裹（`kid`，隨機），包裹不靠「同一個 seq」對上塊——見 [`append`]。
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
//! 升級前寫下的塊沒有 `CSK1` 開頭、也沒有 `.key`，仍直接用 `root` 解（讀得到，但沒有上面的刪除保障）。
//! **不整批重新加密**：重寫只會多一份新檔，舊密文的殘留還是在介質上、還是用 `root` 解得開，
//! 換不到任何保障，卻要承擔中途失敗的風險。
//!
//! 住在 lib 而不是 `main.rs`：`cargo test` 編不到 bin target（見 `partfile.rs` 的說明）。

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::encstore::{self, KEY_LEN};
use crate::partfile::{quarantine, valid_part};

const CHUNK_EXT: &str = "enc";
const KEY_EXT: &str = "key";
/// 新格式塊的開頭：`CSK1` + 8 bytes 的 `kid`，後面才是密文。
const MAGIC: &[u8; 4] = b"CSK1";
const KID_LEN: usize = 8;
const HEADER_LEN: usize = MAGIC.len() + KID_LEN;

fn chunk_path(dir: &Path, convo: &str, seq: u32) -> PathBuf {
    dir.join(format!("{convo}.{seq}.{CHUNK_EXT}"))
}

fn key_path(dir: &Path, convo: &str, seq: u32, kid: &[u8]) -> PathBuf {
    let hex: String = kid.iter().map(|b| format!("{b:02x}")).collect();
    dir.join(format!("{convo}.{seq}.{hex}.{KEY_EXT}"))
}

fn check(convo: &str) -> Result<(), String> {
    if valid_part(convo) {
        Ok(())
    } else {
        Err("非法對話鍵".into())
    }
}

/// 寫檔並**確定落盤**後才換上：暫存檔 → `sync_all` → rename。
///
/// 不用 `partfile::atomic_write`：那個沒有 fsync。封存寫完之後呼叫端會**立刻裁切熱區**，
/// 這時斷電若包裹或塊其實還沒落盤，那一千則就兩邊都沒有了。封存一千則才寫一次，fsync 的成本可以接受。
/// 暫存檔名是「完整檔名＋`.tmp`」，包裹與塊不會共用同一個暫存檔。
fn durable_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut name = path.file_name().ok_or("沒有檔名")?.to_os_string();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    let result = (|| {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, path)
    })();
    result.map_err(|e: std::io::Error| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// 封存一塊：產生隨機塊金鑰 → 寫包裹 → 寫塊本體。
///
/// **順序**：先包裹、後塊。中途當機留下的是「有包裹、沒有塊」——塊數以 `.enc` 計，
/// 所以下一次 append 會用同一個 `seq` 重來、另寫一份包裹。反過來（先塊後包裹）
/// 當機會留下一個**沒有金鑰的塊**，等於那一塊訊息遺失。
///
/// **包裹的檔名帶隨機的 `kid`，塊的開頭記下同一個 `kid`**：一塊永遠只會配到自己的包裹。
/// 重用同一個 `seq`（當機重來、解不開的塊被隔離之後、降回舊版又升級）不會覆蓋別人的包裹，
/// 被隔離成 `.corrupt` 的塊因此還救得回來。
pub fn append(dir: &Path, root: &[u8; KEY_LEN], convo: &str, seq: u32, json: &str) -> Result<(), String> {
    check(convo)?;
    let seg = encstore::generate_key();
    let kid = &encstore::generate_key()[..KID_LEN];
    let wrapped = encstore::encrypt(root, &seg).map_err(|e| e.to_string())?;
    durable_write(&key_path(dir, convo, seq, kid), &wrapped)?;
    let mut out = Vec::with_capacity(HEADER_LEN + json.len() + 64);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(kid);
    out.extend_from_slice(&encstore::encrypt(&seg, json.as_bytes()).map_err(|e| e.to_string())?);
    durable_write(&chunk_path(dir, convo, seq), &out)
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
    if data.len() > HEADER_LEN && data.starts_with(MAGIC) {
        let (header, body) = data.split_at(HEADER_LEN);
        match std::fs::read(key_path(dir, convo, seq, &header[MAGIC.len()..])) {
            Ok(wrapped) => {
                // 包裹解不開（換了資料庫金鑰／遭竄改）就是讀不到，**不隔離**——金鑰回來就還讀得到。
                let Ok(k) = encstore::decrypt(root, &wrapped) else {
                    return Ok(None);
                };
                let Ok(seg) = <[u8; KEY_LEN]>::try_from(k.as_slice()) else {
                    return Ok(None);
                };
                let Ok(plain) = encstore::decrypt(&seg, body) else {
                    quarantine(&path); // 塊本體壞了：留下來別讓它被覆蓋（包裹的檔名帶 kid，也不會被覆蓋）
                    return Ok(None);
                };
                return Ok(String::from_utf8(plain).ok());
            }
            // 沒有這份包裹：要嘛包裹已被刪除（讀不到是對的），要嘛這其實是一個舊塊、
            // 隨機 nonce 恰好以 `CSK1` 開頭（2^-32）。往下用 root 試一次，失敗也**不隔離**。
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(encstore::decrypt(root, &data).ok().and_then(|p| String::from_utf8(p).ok()));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    // 沒有 `CSK1` 開頭＝升級前（或降回舊版時）寫下的舊塊，直接用 root。
    let Ok(plain) = encstore::decrypt(root, &data) else {
        quarantine(&path); // 留下來別讓它被覆蓋
        return Ok(None);
    };
    Ok(String::from_utf8(plain).ok())
}

/// 銷毀一份金鑰包裹：**就地**以等長的零覆寫並落盤、再刪除。
///
/// 就地＝不截斷、不另開新檔（`std::fs::write` 會先截斷，檔案系統可能改配新的區塊）。
/// 覆寫是**盡力而為**：在就地改寫的檔案系統＋傳統硬碟上有效；寫入時複製的檔案系統（APFS、btrfs）
/// 與 flash 的控制器會把新內容寫到別處，舊位元組仍在（見模組說明的 ⚠）。
/// 不因此省略——幾十個位元組，成本近乎零。覆寫失敗也照樣刪除。
fn destroy_key(path: &Path) {
    if let (Ok(meta), Ok(mut file)) = (std::fs::metadata(path), std::fs::OpenOptions::new().write(true).open(path)) {
        let _ = file.write_all(&vec![0u8; meta.len() as usize]);
        let _ = file.sync_all();
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

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cinder-archive-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// 某對話某 seq 的所有包裹檔。
    fn key_files(dir: &Path, convo: &str, seq: u32) -> Vec<PathBuf> {
        let prefix = format!("{convo}.{seq}.");
        std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                let name = p.file_name().unwrap().to_str().unwrap();
                name.starts_with(&prefix) && name.ends_with(".key")
            })
            .collect()
    }

    /// 升級前的程式怎麼寫一塊：直接用 root 加密、沒有開頭、沒有包裹。
    fn legacy_append(dir: &Path, root: &[u8; KEY_LEN], convo: &str, seq: u32, json: &str) {
        std::fs::write(chunk_path(dir, convo, seq), encstore::encrypt(root, json.as_bytes()).unwrap()).unwrap();
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
        // 沒留下暫存檔
        assert!(std::fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_str().unwrap().ends_with(".tmp")));
    }

    /// 🔴 ADR-0413 的核心：塊本體**不是**用 root 加密的——只拿到塊的殘留與 root 解不開。
    #[test]
    fn chunk_is_not_decryptable_with_root_alone() {
        let dir = tmpdir("not-root");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "週五老地方見").unwrap();
        let chunk = std::fs::read(chunk_path(&dir, "bob", 0)).unwrap();
        assert!(encstore::decrypt(&root, &chunk).is_err());
        assert!(encstore::decrypt(&root, &chunk[HEADER_LEN..]).is_err());
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
        assert!(key_files(&dir, "bob", 0).is_empty() && key_files(&dir, "bob", 1).is_empty());

        // 把殘留原樣寫回去（最壞情況：刪檔一個位元組都沒抹掉）。
        for (s, bytes) in residue.iter().enumerate() {
            std::fs::write(chunk_path(&dir, "bob", s as u32), bytes).unwrap();
            assert!(encstore::decrypt(&root, &bytes[HEADER_LEN..]).is_err(), "root 直接解不開");
        }
        // 走正規讀取路徑也讀不到（包裹不在了）。
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
        let k0 = encstore::decrypt(&root, &std::fs::read(&key_files(&dir, "bob", 0)[0]).unwrap()).unwrap();
        let k1 = encstore::decrypt(&root, &std::fs::read(&key_files(&dir, "bob", 1)[0]).unwrap()).unwrap();
        assert_eq!(k0.len(), KEY_LEN);
        assert_ne!(k0, k1);
    }

    /// 升級前的舊塊（直接用 root 加密、沒有 `.key`）照常讀得到。
    #[test]
    fn legacy_chunk_without_key_file_still_loads() {
        let dir = tmpdir("legacy");
        let root = encstore::generate_key();
        legacy_append(&dir, &root, "bob", 0, "舊資料");
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

    /// 🔴 審查找到的：降回舊版又升級。舊版把新格式塊隔離、在同一個 seq 寫下舊格式塊；
    /// 升級後那一塊要讀得到（不能被留下來的包裹拿去解），先前隔離的新格式塊也要還救得回來。
    #[test]
    fn downgrade_then_upgrade_keeps_both_generations() {
        let dir = tmpdir("downgrade");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "新版寫的").unwrap();
        // 舊版讀取：用 root 直接解失敗 → 隔離。
        let chunk = chunk_path(&dir, "bob", 0);
        assert!(encstore::decrypt(&root, &std::fs::read(&chunk).unwrap()).is_err());
        quarantine(&chunk);
        // 舊版在同一個 seq 寫下自己的塊。
        legacy_append(&dir, &root, "bob", 0, "舊版寫的");

        // 升級回來：
        assert_eq!(load(&dir, &root, "bob", 0).unwrap().as_deref(), Some("舊版寫的"));
        // 先前隔離的那一塊原封不動，包裹也還在 → 手動改回檔名就讀得到。
        let kept = std::fs::read(chunk.with_extension("corrupt")).unwrap();
        assert!(kept.starts_with(MAGIC));
        let wrapped = std::fs::read(key_path(&dir, "bob", 0, &kept[MAGIC.len()..HEADER_LEN])).unwrap();
        let seg = <[u8; KEY_LEN]>::try_from(encstore::decrypt(&root, &wrapped).unwrap().as_slice()).unwrap();
        assert_eq!(encstore::decrypt(&seg, &kept[HEADER_LEN..]).unwrap(), "新版寫的".as_bytes());
    }

    /// 🔴 審查找到的：解不開的塊被隔離後，塊數變小，下一次 append 重用同一個 seq——
    /// 不能把被隔離那一塊的包裹覆蓋掉（否則隔離就白做了）。
    #[test]
    fn seq_reuse_after_quarantine_keeps_the_old_wrap() {
        let dir = tmpdir("reuse");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "第一次").unwrap();
        let chunk = chunk_path(&dir, "bob", 0);
        let original = std::fs::read(&chunk).unwrap();
        let old_wrap = key_files(&dir, "bob", 0).remove(0);
        let old_wrap_bytes = std::fs::read(&old_wrap).unwrap();
        // 塊本體被截斷。
        std::fs::write(&chunk, &original[..original.len() - 4]).unwrap();
        assert_eq!(load(&dir, &root, "bob", 0).unwrap(), None);
        assert_eq!(count(&dir, "bob").unwrap(), 0, "隔離後不算塊");

        append(&dir, &root, "bob", 0, "第二次").unwrap();
        assert_eq!(load(&dir, &root, "bob", 0).unwrap().as_deref(), Some("第二次"));
        assert_eq!(key_files(&dir, "bob", 0).len(), 2);
        assert_eq!(std::fs::read(&old_wrap).unwrap(), old_wrap_bytes, "舊包裹沒被動到");
        // 移除對話時兩份包裹都清掉。
        remove(&dir, "bob").unwrap();
        assert!(key_files(&dir, "bob", 0).is_empty());
    }

    /// 包裹已經不在的新格式塊（刪到一半留下的）：讀不到，也**不隔離**。
    #[test]
    fn keyed_chunk_without_its_wrap_reads_nothing() {
        let dir = tmpdir("orphan-chunk");
        let root = encstore::generate_key();
        append(&dir, &root, "bob", 0, "x").unwrap();
        std::fs::remove_file(&key_files(&dir, "bob", 0)[0]).unwrap();
        assert_eq!(load(&dir, &root, "bob", 0).unwrap(), None);
        assert!(chunk_path(&dir, "bob", 0).exists());
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
