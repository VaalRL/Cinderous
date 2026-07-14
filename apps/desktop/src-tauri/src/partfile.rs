//! 部位檔的**檔案安全原語**（ADR-0119）：檔名白名單、原子寫入、毀損隔離。
//!
//! 這三個函式原本住在 `main.rs`。而 `main.rs` 是 `required-features = ["tauri-app"]` 的
//! bin target——**`cargo test` 永遠不會編譯它**，所以它們一行測試都沒有。其中
//! `valid_part()` 是路徑穿越的**唯一**守衛。
//!
//! 搬進 lib（比照 `encstore` / `passlock`：純函式、不依賴 Tauri）之後，CI 的 `cargo test`
//! 才真的在測會出貨的東西。

/// 部位檔名白名單：對話鍵是 pubkey hex 或群組 id（皆為 hex），不該出現路徑字元。
/// 拒絕其餘輸入以杜絕路徑穿越（`..`、`/`、`\`）。
pub fn valid_part(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= 128
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !part.contains("..")
}

/// 原子寫入：先寫暫存檔，再 rename 覆蓋目標。
///
/// `std::fs::write` **不是原子的**——斷電或行程被殺死時會留下**截斷的密文檔**。
/// 而截斷的密文解不開，載入端會把它當成「這個部位不存在」靜默跳過，下一次寫入再用
/// 「只剩新資料」的內容覆蓋掉它——**一次斷電＝一個對話的歷史永久消失**。
///
/// rename 在同一個檔案系統上是原子的（Windows 的 `MoveFileEx` / POSIX 的 `rename`），
/// 所以讀者看到的要嘛是舊檔、要嘛是完整的新檔，**永遠不會是半個檔**。
pub fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    // Rust 在 Windows 上以 MoveFileEx + REPLACE_EXISTING 實作 rename，可直接覆蓋既有檔；
    // 先 remove 再 rename 會破壞原子性（中間有個「目標不存在」的窗口），故不那樣做。
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp); // 失敗時別留下暫存檔
        e.to_string()
    })
}

/// 密文檔解不開（截斷／竄改／換金鑰）時：**保留下來，不要靜默丟棄**。
///
/// 改名為 `<name>.corrupt`——這樣下一次寫入不會覆蓋它（副檔名不同），使用者的資料還有救；
/// 而載入端只收 `.enc`，所以毀損的部位不會被載入，也不會拖垮其餘部位。
pub fn quarantine(path: &std::path::Path) {
    let dest = path.with_extension("corrupt");
    let _ = std::fs::rename(path, dest);
}

#[cfg(test)]
mod tests {
    use super::{atomic_write, quarantine, valid_part};

    /// 每個測試一個獨立目錄（不引入 tempfile 相依）。
    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cinder-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn valid_part_blocks_path_traversal() {
        assert!(valid_part("meta"));
        assert!(valid_part("msgs.a1b2c3"));
        assert!(valid_part("_-.09azAZ"));

        assert!(!valid_part(""), "空字串");
        assert!(!valid_part("../../../etc/passwd"), "相對路徑");
        assert!(!valid_part("..\\..\\windows\\system32"), "Windows 相對路徑");
        assert!(!valid_part("a/b"), "正斜線");
        assert!(!valid_part("a\\b"), "反斜線");
        assert!(!valid_part("a..b"), "內嵌 ..");
        assert!(!valid_part("C:file"), "磁碟機代號");
        assert!(!valid_part("nul\0byte"), "NUL 位元組");
        assert!(!valid_part(&"a".repeat(129)), "過長");
    }

    #[test]
    fn atomic_write_leaves_no_temp_file_and_replaces_existing() {
        let d = tmpdir("atomic");
        let p = d.join("part.enc");

        atomic_write(&p, b"first").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"first");

        // 覆寫既有檔（Windows 的 rename 要能取代目標，否則第二次寫入就會失敗）。
        atomic_write(&p, b"second").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"second");

        // 暫存檔不得留下——否則 `.tmp` 會越積越多。
        assert!(!p.with_extension("tmp").exists(), "暫存檔沒清掉");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn quarantine_preserves_corrupt_data_instead_of_dropping_it() {
        let d = tmpdir("quarantine");
        let p = d.join("msgs.deadbeef.enc");
        std::fs::write(&p, b"truncated ciphertext").unwrap();

        quarantine(&p);

        // 關鍵：資料**還在**。舊行為是靜默跳過解不開的部位，下一次寫入就用「只剩新資料」
        // 的內容覆蓋掉它——一次斷電＝一個對話的歷史永久消失。
        assert!(!p.exists(), "原檔應已移走（否則會被下次寫入覆蓋）");
        let kept = d.join("msgs.deadbeef.corrupt");
        assert_eq!(std::fs::read(&kept).unwrap(), b"truncated ciphertext");
        let _ = std::fs::remove_dir_all(&d);
    }
}
