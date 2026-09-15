//! 收檔暫存區的**檔案安全原語**（ADR-0349）：串流落盤 → 另存時原生移動。
//!
//! ## 為什麼需要它
//!
//! ADR-0347 讓收檔端來一塊寫一塊，但 Tauri 桌面被排除在外——它的「另存新檔」走
//! `save_file` command，需要**整份位元組過 IPC**。而那條路的實作是
//! `invoke("save_file", { bytes: Array.from(bytes) })`：`Array.from` 把 `Uint8Array`
//! 變成 JS number 陣列（每個元素約 8 bytes）再 JSON 序列化 ⇒ **100 MiB 的檔約 800 MB**。
//!
//! 這裡提供的原語讓位元組**逐塊**落到 app 資料夾的暫存區，另存時只做一次 `rename`
//! ——**零位元組過 IPC**。
//!
//! ## 為什麼住在 lib 而不是 `main.rs`
//!
//! ADR-0348 讓 CI 開始編譯 `main.rs`，但**仍然測不到它**（`cargo test --features tauri-app`
//! 會因 keyring 測試需要真實 OS 金鑰庫而失敗）。所以照 ADR-0119 的結論辦：可測邏輯
//! 住在 lib（純 std、不依賴 Tauri），`main.rs` 只留薄殼。路徑穿越守衛尤其不該住在
//! 一個測不到的檔案裡。

use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// 暫存檔的副檔名。掃描清理只認這個後綴，避免誤刪同目錄下的其他東西。
pub const PART_SUFFIX: &str = ".part";

/// 暫存區目錄名（相對於 app 資料夾）。
pub const INBOX_DIR: &str = "inbox";

/// 暫存檔名白名單。
///
/// `handle` 由前端產生（傳輸 id 消毒後 ＋ `.part`），但**前端不可信**——webview 裡的
/// 任何 XSS 都能呼叫 command。這是路徑穿越的唯一守衛，比照 `partfile::valid_part`。
pub fn valid_handle(handle: &str) -> bool {
    handle.len() > PART_SUFFIX.len()
        && handle.len() <= 128
        && handle.ends_with(PART_SUFFIX)
        && handle
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !handle.contains("..")
}

/// 解析暫存檔的完整路徑；`handle` 不合法即拒絕。
pub fn resolve(base: &Path, handle: &str) -> Result<PathBuf, String> {
    if !valid_handle(handle) {
        return Err("非法的暫存檔名".into());
    }
    Ok(base.join(INBOX_DIR).join(handle))
}

/// 開始一份新的暫存檔：建目錄、**截斷既有內容**。
///
/// 截斷是必要的：同一個傳輸 id 重來時若沿用舊檔，新檔比舊檔短就會留下舊資料的尾巴
/// ——而收端是**依位移寫入**的（ADR-0345 的亂序契約），不會自然覆蓋掉那段。
pub fn begin(base: &Path, handle: &str) -> Result<PathBuf, String> {
    let path = resolve(base, handle)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::File::create(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// 把一塊寫到指定位移。
///
/// 每次呼叫自己開檔／seek／關檔，**不保存檔案把手**。多一次 open 的代價（16 KiB 一塊，
/// 1 GB 約 65,536 次）遠低於「在 command 之間保存一張把手表」要付的代價：那張表得處理
/// 傳輸中斷、視窗關閉、身分切換的清理，任何一條漏掉就是洩漏的檔案把手。無狀態換來的是
/// 崩潰後只剩一個孤兒 `.part`，而那由 `sweep` 收拾。
pub fn write_at(base: &Path, handle: &str, offset: u64, bytes: &[u8]) -> Result<(), String> {
    let path = resolve(base, handle)?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

/// 把暫存檔搬到使用者選定的位置。
///
/// 先試 `rename`（同一檔案系統上是**原子**且零複製的）；跨檔案系統（暫存區在系統碟、
/// 使用者存到隨身碟）`rename` 會失敗 ⇒ 退回 copy＋remove。**退回路徑刻意不刪來源除非
/// copy 成功**：寧可留下一個孤兒 `.part`，也不要讓檔案在兩邊都不存在。
pub fn finish_into(base: &Path, handle: &str, dest: &Path) -> Result<(), String> {
    let src = resolve(base, handle)?;
    match std::fs::rename(&src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(&src, dest).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&src); // 複製已成功 ⇒ 刪不掉也只是留個暫存檔
            Ok(())
        }
    }
}

/// 放棄一份暫存檔（傳輸中止／使用者取消另存）。刪不掉不算錯——`sweep` 會收拾。
pub fn discard(base: &Path, handle: &str) -> Result<(), String> {
    let path = resolve(base, handle)?;
    let _ = std::fs::remove_file(path);
    Ok(())
}

/// 清掉超過 `max_age_secs` 的暫存檔，回傳刪除數。
///
/// **開機時掃一次**（ADR-0347 §後果列的殘餘）：使用者在另存前關掉 app，暫存檔就會留下。
/// 單檔上限雖有，但它會累積。只認 `.part` 後綴，只看修改時間——不碰別的東西。
pub fn sweep(base: &Path, max_age_secs: u64) -> usize {
    let dir = base.join(INBOX_DIR);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0; // 目錄還不存在＝沒東西可掃
    };
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "part") {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age.as_secs() > max_age_secs);
        if stale && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每個測試一個獨立的臨時基底目錄（避免互相干擾）。
    fn tmp_base(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "cinder-inbox-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn valid_handle_accepts_generated_names_and_rejects_traversal() {
        assert!(valid_handle("f1789451060783_0.part"));
        assert!(valid_handle("abc-DEF_123.part"));

        // 🔴 路徑穿越：前端不可信（webview 的 XSS 也能呼叫 command）。
        assert!(!valid_handle("../../../etc/passwd.part"));
        assert!(!valid_handle("..part"));
        assert!(!valid_handle("a/b.part"));
        assert!(!valid_handle("a\\b.part"));
        // 後綴是硬規則：沒有它就不是我們的暫存檔，也不該被 sweep 認領。
        assert!(!valid_handle("evil.exe"));
        assert!(!valid_handle(".part")); // 只有後綴、沒有名字
        assert!(!valid_handle(""));
        // 長度上限。
        assert!(!valid_handle(&format!("{}.part", "a".repeat(200))));
    }

    #[test]
    fn resolve_rejects_bad_handles_before_touching_disk() {
        let base = tmp_base("resolve");
        assert!(resolve(&base, "../escape.part").is_err());
        assert!(resolve(&base, "ok.part").is_ok());
    }

    #[test]
    fn begin_write_at_roundtrip_including_out_of_order() {
        let base = tmp_base("roundtrip");
        begin(&base, "x.part").unwrap();
        // 🔴 亂序寫入：收端保留了 ADR-0345 的亂序契約，位移必須各自算對。
        write_at(&base, "x.part", 4, b"cdef").unwrap();
        write_at(&base, "x.part", 0, b"ab").unwrap();
        write_at(&base, "x.part", 2, b"XY").unwrap();
        let got = std::fs::read(resolve(&base, "x.part").unwrap()).unwrap();
        assert_eq!(got, b"abXYcdef");
    }

    #[test]
    fn begin_truncates_previous_content() {
        let base = tmp_base("truncate");
        begin(&base, "t.part").unwrap();
        write_at(&base, "t.part", 0, b"0123456789").unwrap();
        // 同一個 id 重來：舊尾巴不得留下（依位移寫入不會自然覆蓋掉它）。
        begin(&base, "t.part").unwrap();
        write_at(&base, "t.part", 0, b"ab").unwrap();
        assert_eq!(std::fs::read(resolve(&base, "t.part").unwrap()).unwrap(), b"ab");
    }

    #[test]
    fn write_at_fails_when_not_begun() {
        let base = tmp_base("nobegin");
        assert!(write_at(&base, "missing.part", 0, b"x").is_err());
    }

    #[test]
    fn finish_into_moves_and_removes_source() {
        let base = tmp_base("finish");
        begin(&base, "m.part").unwrap();
        write_at(&base, "m.part", 0, b"payload").unwrap();
        let dest = base.join("saved.bin");
        finish_into(&base, "m.part", &dest).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"payload");
        assert!(!resolve(&base, "m.part").unwrap().exists()); // 來源已搬走
    }

    #[test]
    fn discard_is_idempotent() {
        let base = tmp_base("discard");
        begin(&base, "d.part").unwrap();
        discard(&base, "d.part").unwrap();
        discard(&base, "d.part").unwrap(); // 已不在 ⇒ 仍然成功
        assert!(discard(&base, "../evil.part").is_err()); // 但非法檔名照樣拒絕
    }

    /// 把某個檔案的修改時間往前調（測試「過期」用，免得要真的等）。
    fn age_file(path: &Path, secs: u64) {
        let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(secs))
            .unwrap();
    }

    #[test]
    fn sweep_removes_stale_parts_only() {
        let base = tmp_base("sweep");
        begin(&base, "old.part").unwrap();
        begin(&base, "new.part").unwrap();
        let other = base.join(INBOX_DIR).join("keep.txt");
        std::fs::write(&other, b"not ours").unwrap();
        age_file(&resolve(&base, "old.part").unwrap(), 7200); // 兩小時前
        age_file(&other, 7200); // 一樣老，但**不是** .part

        let removed = sweep(&base, 3600);
        assert_eq!(removed, 1, "只有過期的 .part 該被刪");
        assert!(!resolve(&base, "old.part").unwrap().exists());
        assert!(resolve(&base, "new.part").unwrap().exists(), "新的暫存檔不得被刪");
        assert!(other.exists(), "非 .part 的檔案不得被碰，即使一樣老");
    }

    #[test]
    fn sweep_keeps_fresh_parts() {
        let base = tmp_base("sweep-fresh");
        begin(&base, "fresh.part").unwrap();
        assert_eq!(sweep(&base, 3600), 0); // 一小時內的不動
        assert!(resolve(&base, "fresh.part").unwrap().exists());
    }

    #[test]
    fn sweep_on_missing_dir_is_zero_not_error() {
        let base = tmp_base("sweep-missing");
        assert_eq!(sweep(&base, 0), 0);
    }
}
