//! 原生端的本機錯誤紀錄（ADR-0421）。
//!
//! 只記 **panic**（Rust 端目前沒有其他 log 呼叫）。寫到 App 的 log 資料夾、**只存在這台裝置**、
//! 從不上傳；前端設定頁的「複製」才會把它跟 WebView 那份一起交給使用者。
//!
//! - 寫入前遮罩：nsec／npub 等 bech32、長 hex、長英數串（密文、金鑰）換成佔位字。
//! - 檔案有上限：超過就只留後半段，避免 panic 迴圈把磁碟寫滿。
//! - 純 std、無 feature 閘門 ⇒ `cargo test` 測得到。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 紀錄檔上限（位元組）。
pub const MAX_BYTES: u64 = 256 * 1024;
/// 前端一次讀回的上限（位元組）。
pub const READ_MAX: usize = 64 * 1024;

const BECH32_PREFIXES: [&str; 8] = ["nsec1", "npub1", "ncryptsec1", "nprofile1", "nevent1", "naddr1", "note1", "nrelay1"];

/// 遮掉可識別身分／金鑰的字串。以「連續英數」為單位判斷，不需要 regex 依賴。
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut token = String::new();
    let flush = |token: &mut String, out: &mut String| {
        if token.is_empty() {
            return;
        }
        let lower = token.to_ascii_lowercase();
        let bech = BECH32_PREFIXES.iter().find(|p| lower.starts_with(*p) && token.len() >= p.len() + 20);
        if let Some(p) = bech {
            out.push('[');
            out.push_str(&p[..p.len() - 1]);
            out.push(']');
        } else if token.len() >= 32 && token.chars().all(|c| c.is_ascii_hexdigit()) {
            out.push_str("[hex]");
        } else if token.len() >= 40 {
            out.push_str("[b64]");
        } else {
            out.push_str(token);
        }
        token.clear();
    };
    for c in text.chars() {
        if c.is_ascii_alphanumeric() || c == '+' || c == '/' {
            token.push(c);
        } else {
            flush(&mut token, &mut out);
            out.push(c);
        }
    }
    flush(&mut token, &mut out);
    out
}

/// 一筆 panic 紀錄（單行；訊息已遮罩）。
pub fn format_panic(unix_secs: u64, version: &str, message: &str, location: Option<&str>) -> String {
    let loc = location.map(|l| format!(" at {l}")).unwrap_or_default();
    let msg = redact(message).replace(['\r', '\n'], " ");
    let msg: String = msg.chars().take(500).collect();
    format!("{unix_secs} [native] panic: {msg}{loc} · v{version}\n")
}

/// 附加一行；檔案超過上限就先截成後半段（從下一個換行開始，不留半行）。
pub fn append_capped(path: &Path, line: &str, max: u64) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    if fs::metadata(path).map(|m| m.len() + line.len() as u64 > max).unwrap_or(false) {
        let data = fs::read(path)?;
        let half = data.len() / 2;
        let cut = data[half..].iter().position(|&b| b == b'\n').map(|i| half + i + 1).unwrap_or(data.len());
        fs::write(path, &data[cut..])?;
    }
    let mut f = fs::OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(line.as_bytes())
}

/// 讀最後 `max` 位元組（從完整的一行開始）；沒有檔案回空字串。
pub fn read_tail(path: &Path, max: usize) -> String {
    let Ok(data) = fs::read(path) else {
        return String::new();
    };
    let start = if data.len() > max {
        let s = data.len() - max;
        data[s..].iter().position(|&b| b == b'\n').map(|i| s + i + 1).unwrap_or(data.len())
    } else {
        0
    };
    String::from_utf8_lossy(&data[start..]).into_owned()
}

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// 紀錄檔路徑（`install_panic_hook` 之後才有）。
pub fn log_path() -> Option<&'static Path> {
    LOG_PATH.get().map(PathBuf::as_path)
}

/// 裝上 panic hook：先寫本機紀錄、再交給原本的 hook（保留 stderr 輸出與預設行為）。
pub fn install_panic_hook(path: PathBuf, version: &'static str) {
    if LOG_PATH.set(path).is_err() {
        return; // 已裝過
    }
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let msg = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic".to_string());
        let loc = info.location().map(|l| format!("{}:{}", l.file(), l.line()));
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Some(p) = log_path() {
            let _ = append_capped(p, &format_panic(secs, version, &msg, loc.as_deref()), MAX_BYTES);
        }
        prev(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cinder-diaglog-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d.join("logs").join("native-errors.log")
    }

    #[test]
    fn redacts_keys_and_ids() {
        let nsec = format!("nsec1{}", "q".repeat(58));
        let hex = "ab".repeat(32);
        let b64 = format!("{}+/{}", "A".repeat(30), "b".repeat(30));
        let out = redact(&format!("bad {nsec} pk={hex} ct={b64} at src/main.rs:12"));
        assert!(!out.contains(&nsec));
        assert!(!out.contains(&hex));
        assert!(!out.contains(&b64));
        assert!(out.contains("[nsec]") && out.contains("[hex]") && out.contains("[b64]"));
        assert!(out.contains("src/main.rs:12"));
    }

    #[test]
    fn format_is_single_line_and_redacted() {
        let npub = format!("npub1{}", "x".repeat(58));
        let line = format_panic(7, "0.0.24", &format!("oops\n{npub}"), Some("src/a.rs:3"));
        assert_eq!(line.matches('\n').count(), 1);
        assert!(line.starts_with("7 [native] panic: oops [npub] at src/a.rs:3 · v0.0.24"));
    }

    #[test]
    fn append_creates_dir_and_caps_size() {
        let p = tmp("cap");
        for i in 0..200 {
            append_capped(&p, &format!("line {i:04} {}\n", "z".repeat(20)), 2000).unwrap();
        }
        let len = fs::metadata(&p).unwrap().len();
        assert!(len <= 2000, "len={len}");
        let text = fs::read_to_string(&p).unwrap();
        assert!(text.starts_with("line "), "截斷後要從完整一行開始");
        assert!(text.contains("line 0199"), "最新的要留著");
        assert!(!text.contains("line 0000"), "最舊的要丟掉");
    }

    #[test]
    fn read_tail_returns_whole_lines_or_empty() {
        let p = tmp("tail");
        assert_eq!(read_tail(&p, 100), "");
        for i in 0..50 {
            append_capped(&p, &format!("row {i:02}\n"), MAX_BYTES).unwrap();
        }
        let t = read_tail(&p, 30);
        assert!(t.len() <= 30);
        assert!(t.starts_with("row "));
        assert!(t.ends_with("row 49\n"));
    }
}
