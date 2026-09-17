//! 送檔端的檔案系統原語（ADR-0355 合集）。
//!
//! ## 職責邊界
//!
//! **收檔落地是 `inbox.rs` 的事**（ADR-0349）；這裡只管**送出端**要的兩件事：
//!   1. `walk_dir`：把一個資料夾攤平成「相對路徑＋大小＋修改時間＋權限」的清單；
//!   2. `read_range`：讀某個檔案的任意一段。
//!
//! 外加收檔端解開合集時要的落地原語（`safe_join` / `copy_range` / `finalize_into`）。
//!
//! 兩者合起來讓 TS 端把一整個資料夾做成可定位的 tar 合集（`tarStream`），
//! 而合集本身從不進記憶體——傳輸層要哪一段就讀哪一段。
//!
//! 比照 `partfile` / `inbox`：純函式、不依賴 Tauri，`cargo test` 測得到。

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// 走訪目錄的上限。防的是「拖進 C:\ 」這種一秒鐘炸掉整個 app 的操作。
#[derive(Clone, Copy)]
pub struct WalkLimits {
    pub max_files: usize,
    pub max_total_bytes: u64,
    pub max_depth: usize,
}

impl Default for WalkLimits {
    fn default() -> Self {
        // 一萬個檔／10 GiB／32 層：正常的專案資料夾遠低於此，誤拖整顆磁碟則會被擋下。
        Self { max_files: 10_000, max_total_bytes: 10 * 1024 * 1024 * 1024, max_depth: 32 }
    }
}

/// 走訪結果中的一個檔案。`rel` 一律以 `/` 分隔（跨平台一致，直接當合集內路徑）。
#[derive(Debug, PartialEq, Eq)]
pub struct WalkEntry {
    pub rel: String,
    pub size: u64,
    /// 修改時間（Unix 秒）。**要帶**：不帶的話合集裡全記為 0，
    /// 解開後每個檔案的時間戳都會是 1970——傳專案備份的人一定會發現。
    pub mtime: u64,
    /// POSIX 權限位元（`0o644` 等）。Windows 沒有這個概念，一律給 `0o644`
    /// ——不從副檔名猜執行位元，猜錯的後果是解開後多出一個可執行檔。
    pub mode: u32,
}

/// 讀出修改時間（Unix 秒）；取不到回 0（而不是「現在」——那會讓每次打包結果都不同）。
pub fn mtime_of(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 讀出 POSIX 權限位元；非 Unix 平台沒有這個概念，給一般檔案的預設。
#[cfg(unix)]
pub fn mode_of(meta: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o777
}
#[cfg(not(unix))]
pub fn mode_of(_meta: &std::fs::Metadata) -> u32 {
    0o644
}

/// 遞迴列出目錄下的所有一般檔案。
///
/// **不跟隨符號連結**：跟隨的話一個指向上層的連結就能讓合集包進目錄外的檔案
/// （等於把使用者沒打算分享的東西送出去），而自我指涉的連結還會無限遞迴。
pub fn walk_dir(root: &Path, limits: WalkLimits) -> Result<Vec<WalkEntry>, String> {
    let mut out = Vec::new();
    let mut total: u64 = 0;
    walk_inner(root, root, 0, &limits, &mut out, &mut total)?;
    out.sort_by(|a, b| a.rel.cmp(&b.rel)); // 穩定順序：同一個資料夾每次產生相同的合集
    Ok(out)
}

fn walk_inner(
    root: &Path,
    dir: &Path,
    depth: usize,
    limits: &WalkLimits,
    out: &mut Vec<WalkEntry>,
    total: &mut u64,
) -> Result<(), String> {
    if depth > limits.max_depth {
        return Err(format!("資料夾層數超過上限 {}", limits.max_depth));
    }
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        // symlink_metadata 不跟隨連結 → 連結本身會被識別出來並跳過。
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            walk_inner(root, &path, depth + 1, limits, out, total)?;
            continue;
        }
        if !meta.is_file() {
            continue; // 裝置檔／FIFO 等一律不收
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "路徑不在根目錄之下".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        *total += meta.len();
        if out.len() >= limits.max_files {
            return Err(format!("檔案數超過上限 {}", limits.max_files));
        }
        if *total > limits.max_total_bytes {
            return Err("資料夾總大小超過上限".to_string());
        }
        out.push(WalkEntry { rel, size: meta.len(), mtime: mtime_of(&meta), mode: mode_of(&meta) });
    }
    Ok(())
}

/// 讀取檔案的一段（供串流送出）。回傳的長度可能小於 `len`（讀到檔尾）。
pub fn read_range(path: &Path, offset: u64, len: usize) -> Result<Vec<u8>, String> {
    if len > MAX_READ_LEN {
        return Err("單次讀取長度超出上限".into());
    }
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; len];
    let mut filled = 0usize;
    // read 允許短讀；要湊滿或讀到 EOF 才算數，否則串流會出現空洞。
    while filled < len {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) => return Err(e.to_string()),
        }
    }
    buf.truncate(filled);
    Ok(buf)
}

// ── 解包落地（ADR-0355）────────────────────────────────────────────────────────
//
// tar 的**解析在 TS**（`@cinderous/core` 的 `readTar`／`listTar` 已經有了，而且瀏覽器端
// 也要用同一份）；這裡只提供它做不到的三件事：把相對路徑安全地接到目的資料夾之下、
// 依位移寫入、還原修改時間與權限。

/// 把合集內的相對路徑接到 `root` 之下，並擋掉所有逸出手法。
///
/// 🔴 這是 zip-slip 的守衛。合集是**對方給的**，裡面的路徑可以是 `../../.ssh/authorized_keys`
/// 或 `C:\Windows\System32\...`。逐段檢查而不是整串比對：`..%2f` 之類的編碼在拆段之後
/// 就只是一個普通的段名，不會突然變成上層。
///
/// 不用 `canonicalize` 是因為目標**還不存在**（正要建它）；改為純字串層的逐段拒收，
/// 這也讓它在沒有檔案系統的情況下測得到。
pub fn safe_join(root: &Path, rel: &str) -> Result<std::path::PathBuf, String> {
    let mut out = root.to_path_buf();
    let mut segments = 0usize;
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        // `..` 逸出上層；`\` 是 Windows 的分隔符（拆段時不會被拆開）；`:` 是磁碟代號。
        if seg == ".." || seg.contains('\\') || seg.contains(':') {
            return Err("合集內路徑不合法".into());
        }
        // 🔴 這一層必須是 TS 那層（safeArchivePath）的**超集**，否則「Rust 這層擋 XSS」
        // 的論證只成立一半——XSS 繞過前端時，弱的那一層就是實際的防線。
        if !segment_is_safe(seg) {
            return Err("合集內路徑不合法".into());
        }
        out.push(seg);
        segments += 1;
    }
    if segments == 0 {
        return Err("合集內路徑為空".into());
    }
    Ok(out)
}

/// 單一路徑段安不安全。與 TS 的 `sanitizeSegment`（`packages/core/src/archive.ts`）對齊。
///
/// 擋的三件事，每一件都有實際後果：
///   * **控制字元**（含 NUL）——在不同檔案系統上行為不一致，也能拿來騙人眼。
///   * **Windows 保留裝置名**（`CON`／`PRN`／`AUX`／`NUL`／`COM1-9`／`LPT1-9`，含帶副檔名的
///     形式如 `CON.txt`）——`File::create("CON")` 打到的是主控台裝置，不是檔案。
///   * **前後空白與尾端的點**——NT 會把它們修掉，於是 `report.txt.` 變成 `report.txt`，
///     成為一個能悄悄覆寫既有檔案的別名。
fn segment_is_safe(seg: &str) -> bool {
    if seg.chars().any(char::is_control) {
        return false;
    }
    if seg != seg.trim() || seg.ends_with('.') {
        return false;
    }
    // 保留裝置名比對的是**點之前**那一段，且不分大小寫。
    let stem = seg.split('.').next().unwrap_or(seg).to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return false;
    }
    if let Some(n) = stem.strip_prefix("COM").or_else(|| stem.strip_prefix("LPT")) {
        if n.len() == 1 && n.as_bytes()[0].is_ascii_digit() && n != "0" {
            return false;
        }
    }
    true
}

/// 解開單一檔案時可寫入的路徑上限（每次 `copy_range` 各自成立）。
///
/// 純防呆：合集裡宣告的大小已經由 `listTar` 讀出，這裡只是不讓一個畸形標頭要求無上限的 IO。
pub const MAX_EXTRACT_BYTES: u64 = 16 * 1024 * 1024 * 1024;

/// 單次定位讀取的長度上限。
///
/// 🔴 `read_range` 會先 `vec![0u8; len]` 才讀。`len` 來自前端（`fs_read_range` 的 `length: u32`），
/// 所以 `invoke('fs_read_range', { length: 0xFFFFFFFF })` 會立刻要 4 GiB，連打幾次就把行程
/// 打掛。正常路徑只用 64 KiB（送檔分塊）與 512 B（讀 tar 標頭），8 MiB 已經非常寬鬆。
pub const MAX_READ_LEN: usize = 8 * 1024 * 1024;

/// 確認 `target` 真的落在 `root` 之下，且本身不是既有的符號連結／junction。
///
/// 🔴 為什麼 `safe_join` 不夠：它是純字串逐段檢查，擋得住 `../`，**擋不住「目的目錄裡本來
/// 就有一條連結」**。`File::create` 會跟隨連結並截斷它指向的目標——對方只要把合集項目命名
/// 成解包目的地既有的連結名（Windows 的目錄 junction 不需要提權就建得出來），就能寫穿到
/// 目的地之外。`fs_read_range_in` 早就做了這組檢查，落地端漏掉是單點遺漏。
fn contained(root: &Path, target: &Path) -> Result<(), String> {
    // 目標本身還不存在是正常的（正要建它）；存在且是連結就拒絕。
    if let Ok(meta) = std::fs::symlink_metadata(target) {
        if meta.file_type().is_symlink() {
            return Err("解包目標是符號連結".into());
        }
    }
    // 父目錄此刻已經建好，canonicalize 得出來——連結會在這一步被解開成真實路徑。
    let parent = target.parent().ok_or_else(|| "解包目標沒有父目錄".to_string())?;
    let real_parent = parent.canonicalize().map_err(|e| e.to_string())?;
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    if !real_parent.starts_with(&real_root) {
        return Err("解包路徑逸出目的地".into());
    }
    Ok(())
}

/// 從 `src` 的第 `at` 個位元組起，複製 `len` 個位元組成為 `<root>/<rel>`。
///
/// 🔴 **這是解包不讓位元組經過 IPC 的關鍵**。tar 的標頭讀在 TS（解析邏輯只有一份，
/// 瀏覽器也用它），但內容是「合集檔案的某一段 → 目的檔案」的純複製——讓它跑一趟
/// webview 等於把每個位元組轉成 JSON 數字再轉回來，一個 1 GB 的合集會變成 4～5 GB 的
/// 字串。這裡直接在 Rust 這側做，記憶體用量固定在一個緩衝區。
///
/// 來源短讀（合集被截斷）**不算錯**：已經複製的那些仍然是對的，回傳實際複製量讓上層判斷。
pub fn copy_range(src: &Path, at: u64, len: u64, root: &Path, rel: &str) -> Result<u64, String> {
    if len > MAX_EXTRACT_BYTES {
        return Err("合集項目宣告的大小超出上限".into());
    }
    let target = safe_join(root, rel)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    contained(root, &target)?;
    let mut input = File::open(src).map_err(|e| e.to_string())?;
    input.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
    // 目的檔要先截斷：同名檔案重解一次時，舊內容比新內容長就會留下尾巴。
    let mut output = File::create(&target).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut done: u64 = 0;
    while done < len {
        let want = std::cmp::min(buf.len() as u64, len - done) as usize;
        let n = input.read(&mut buf[..want]).map_err(|e| e.to_string())?;
        if n == 0 {
            break; // 來源被截斷
        }
        std::io::Write::write_all(&mut output, &buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
    }
    Ok(done)
}

/// 收尾一個解開的檔案：還原修改時間與權限。
///
/// 兩者都**失敗不算錯**：檔案本身已經寫好了，時間戳沒對上不該讓整個解包報錯。
/// `mtime` 為 0（來源沒帶）就不動——把它設成 1970 比留著解包當下的時間更沒用。
pub fn finalize_into(root: &Path, rel: &str, mtime: u64, mode: u32) -> Result<(), String> {
    let target = safe_join(root, rel)?;
    // 收尾同樣會跟隨連結（`set_permissions`／`set_modified` 都會），所以驗同一組。
    contained(root, &target)?;
    if mtime > 0 {
        if let Ok(f) = File::options().write(true).open(&target) {
            let _ = f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(mtime));
        }
    }
    #[cfg(unix)]
    if mode > 0 {
        use std::os::unix::fs::PermissionsExt;
        // 🔴 只保留**擁有者的執行位元**，其餘一律用安全預設。
        // `mode & 0o777` 看似只是去掉 setuid，但它照單全收了 `0o777` 本身——對方的合集
        // 因此能造出「全域可寫且可執行」的檔案。可執行腳本要保留執行位元是真需求，
        // group/other 的寫入位元則沒有任何正當理由跟著合集跑。
        let safe_mode = 0o644 | (mode & 0o100);
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(safe_mode));
    }
    #[cfg(not(unix))]
    let _ = mode; // Windows 沒有 POSIX 權限位元
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每個測試一個**獨立**目錄——`cargo test` 預設平行跑，共用一個暫存目錄會讓
    /// 各測試互相刪掉對方的檔案（症狀是「看到別的測試建立的檔案」這種詭異失敗）。
    fn tmp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cinder-fs-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn walks_nested_files_with_relative_slash_paths() {
        let root = tmp("walk");
        std::fs::create_dir_all(root.join("sub/deeper")).unwrap();
        std::fs::write(root.join("a.txt"), b"one").unwrap();
        std::fs::write(root.join("sub/b.txt"), b"twotwo").unwrap();
        std::fs::write(root.join("sub/deeper/c.bin"), b"xyz!").unwrap();

        let got = walk_dir(&root, WalkLimits::default()).unwrap();
        assert_eq!(
            got.iter().map(|e| (e.rel.as_str(), e.size)).collect::<Vec<_>>(),
            vec![("a.txt", 3u64), ("sub/b.txt", 6), ("sub/deeper/c.bin", 4)]
        );
        // 🔴 修改時間要是真的：不帶的話合集裡全記為 0，解開後每個檔的時間戳都是 1970。
        assert!(got.iter().all(|e| e.mtime > 1_600_000_000), "mtime 應為實際修改時間");
        // 權限位元在各平台都要落在合理範圍（Windows 給預設 0o644）。
        assert!(got.iter().all(|e| e.mode > 0 && e.mode <= 0o777));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn walk_respects_file_count_limit() {
        let root = tmp("count");
        for i in 0..5 {
            std::fs::write(root.join(format!("f{i}.txt")), b"x").unwrap();
        }
        let limits = WalkLimits { max_files: 3, ..WalkLimits::default() };
        assert!(walk_dir(&root, limits).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn walk_respects_total_size_limit() {
        let root = tmp("size");
        std::fs::write(root.join("big.bin"), vec![0u8; 1024]).unwrap();
        let limits = WalkLimits { max_total_bytes: 100, ..WalkLimits::default() };
        assert!(walk_dir(&root, limits).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn read_range_returns_exact_slice_and_short_read_at_eof() {
        let root = tmp("range");
        let f = root.join("x.bin");
        std::fs::write(&f, b"0123456789").unwrap();
        assert_eq!(read_range(&f, 0, 4).unwrap(), b"0123");
        assert_eq!(read_range(&f, 4, 4).unwrap(), b"4567");
        // 跨過檔尾 → 只回剩下的那些，不補零。
        assert_eq!(read_range(&f, 8, 100).unwrap(), b"89");
        assert_eq!(read_range(&f, 10, 4).unwrap(), b"");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn safe_join_rejects_every_escape_shape() {
        let root = Path::new("/tmp/root");
        for bad in ["../x", "a/../../x", "..", "C:/Windows/x", r"a\..\b", "a/b:c"] {
            assert!(safe_join(root, bad).is_err(), "{bad} 應被拒絕");
        }
        assert!(safe_join(root, "").is_err()); // 空路徑不是檔案
        assert!(safe_join(root, "./").is_err());
    }

    #[test]
    fn safe_join_keeps_ordinary_nested_paths() {
        let root = Path::new("/tmp/root");
        assert_eq!(safe_join(root, "a/b/c.txt").unwrap(), root.join("a").join("b").join("c.txt"));
        assert_eq!(safe_join(root, "./a/./b").unwrap(), root.join("a").join("b"));
        // `..` 以外的點開頭檔名是合法的（`.gitignore` 很常見）。
        assert_eq!(safe_join(root, ".gitignore").unwrap(), root.join(".gitignore"));
    }

    #[test]
    fn finalize_restores_mtime_and_tolerates_a_missing_file() {
        let root = tmp("finalize");
        let src = root.join("src.bin");
        std::fs::write(&src, b"hi").unwrap();
        copy_range(&src, 0, 2, &root, "a.txt").unwrap();
        finalize_into(&root, "a.txt", 1_000_000_000, 0o644).unwrap();
        let meta = std::fs::metadata(root.join("a.txt")).unwrap();
        assert_eq!(mtime_of(&meta), 1_000_000_000);
        // 不存在的檔案：時間戳設不上不算錯（檔案本身才是重點）。
        assert!(finalize_into(&root, "nope.txt", 1_000_000_000, 0o644).is_ok());
        // mtime 為 0＝來源沒帶 → 不動它（不要把檔案打成 1970）。
        finalize_into(&root, "a.txt", 0, 0o644).unwrap();
        assert_eq!(mtime_of(&std::fs::metadata(root.join("a.txt")).unwrap()), 1_000_000_000);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copy_range_extracts_a_slice_into_a_nested_path() {
        let root = tmp("copyrange");
        let src = root.join("bundle.tar");
        std::fs::write(&src, b"HEADERhelloworldTAIL").unwrap();
        let out = root.join("out");
        assert_eq!(copy_range(&src, 6, 5, &out, "a/b.txt").unwrap(), 5);
        assert_eq!(std::fs::read(out.join("a").join("b.txt")).unwrap(), b"hello");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copy_range_truncates_an_existing_target_and_refuses_escapes() {
        let root = tmp("copytrunc");
        let src = root.join("s.bin");
        std::fs::write(&src, b"0123456789").unwrap();
        let out = root.join("out");
        copy_range(&src, 0, 8, &out, "x.bin").unwrap();
        // 重解一次且這次比較短：舊尾巴不得留下。
        copy_range(&src, 0, 3, &out, "x.bin").unwrap();
        assert_eq!(std::fs::read(out.join("x.bin")).unwrap(), b"012");
        assert!(copy_range(&src, 0, 3, &out, "../evil.bin").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copy_range_stops_at_a_truncated_source_instead_of_erroring() {
        let root = tmp("copyshort");
        let src = root.join("s.bin");
        std::fs::write(&src, b"abc").unwrap();
        let out = root.join("out");
        // 宣告 100 但只有 3：回報實際複製量，讓上層決定怎麼說。
        assert_eq!(copy_range(&src, 0, 100, &out, "p.bin").unwrap(), 3);
        std::fs::remove_dir_all(&root).unwrap();
    }

    // ── 加固（2026-09-17 審查）─────────────────────────────────────────────────

    #[test]
    fn safe_join_rejects_windows_reserved_device_names() {
        let root = Path::new("/tmp/root");
        // `File::create("CON")` 打到的是主控台裝置，不是檔案。
        for bad in ["CON", "con", "NUL", "aux.txt", "COM1", "lpt9", "PRN.bin"] {
            assert!(safe_join(root, bad).is_err(), "{bad} 應被拒絕");
        }
        // 只是**開頭**像保留名的不受影響。
        for ok in ["CONFIG", "console.log", "COM10", "LPT0", "nullable.txt"] {
            assert!(safe_join(root, ok).is_ok(), "{ok} 不該被誤擋");
        }
    }

    #[test]
    fn safe_join_rejects_control_characters_and_trailing_dots_or_spaces() {
        let root = Path::new("/tmp/root");
        // NT 會修掉尾端的點與空白 ⇒ `report.txt.` 變成能悄悄覆寫 `report.txt` 的別名。
        for bad in ["report.txt.", "report.txt ", " report.txt", "a\u{7}b", "a\u{0}b"] {
            assert!(safe_join(root, bad).is_err(), "{bad:?} 應被拒絕");
        }
        assert!(safe_join(root, "a.b.c.txt").is_ok()); // 中間的點沒問題
    }

    #[test]
    fn read_range_refuses_an_absurd_length_instead_of_allocating_it() {
        let root = tmp("readcap");
        let f = root.join("x.bin");
        std::fs::write(&f, b"hi").unwrap();
        // 🔴 沒有這道閘，前端一行 `length: 0xFFFFFFFF` 就要走 4 GiB。
        assert!(read_range(&f, 0, MAX_READ_LEN + 1).is_err());
        assert!(read_range(&f, 0, 64 * 1024).is_ok());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copy_range_refuses_an_absurd_declared_size() {
        let root = tmp("copycap");
        let src = root.join("s.bin");
        std::fs::write(&src, b"hi").unwrap();
        assert!(copy_range(&src, 0, MAX_EXTRACT_BYTES + 1, &root.join("out"), "a.bin").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn extraction_refuses_to_follow_a_symlink_planted_in_the_destination() {
        use std::os::unix::fs::symlink;
        let root = tmp("symlink");
        let outside = root.join("outside.txt");
        std::fs::write(&outside, b"original").unwrap();
        let dest = root.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        // 目的地裡先有一條指向外面的連結——對方的合集只要用同一個名字就能寫穿。
        symlink(&outside, dest.join("link.txt")).unwrap();
        let src = root.join("s.bin");
        std::fs::write(&src, b"evil").unwrap();

        assert!(copy_range(&src, 0, 4, &dest, "link.txt").is_err());
        assert_eq!(std::fs::read(&outside).unwrap(), b"original", "外面的檔案不得被改到");
        assert!(finalize_into(&dest, "link.txt", 1_000_000_000, 0o644).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn extraction_refuses_a_directory_symlink_that_escapes() {
        use std::os::unix::fs::symlink;
        let root = tmp("dirlink");
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let dest = root.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        symlink(&outside, dest.join("sub")).unwrap(); // 目錄連結指向目的地之外
        let src = root.join("s.bin");
        std::fs::write(&src, b"evil").unwrap();

        assert!(copy_range(&src, 0, 4, &dest, "sub/x.txt").is_err());
        assert!(!outside.join("x.txt").exists(), "不得寫到目的地之外");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn finalize_clamps_permissions_from_the_archive() {
        use std::os::unix::fs::PermissionsExt;
        let root = tmp("perm");
        let src = root.join("s.bin");
        std::fs::write(&src, b"x").unwrap();
        copy_range(&src, 0, 1, &root, "a.sh").unwrap();
        // 🔴 對方要求 0o777（全域可寫＋可執行）；我們只保留擁有者的執行位元。
        finalize_into(&root, "a.sh", 0, 0o777).unwrap();
        let m = std::fs::metadata(root.join("a.sh")).unwrap().permissions().mode() & 0o777;
        assert_eq!(m, 0o744, "應收斂成 0o644 | 擁有者執行位元");

        copy_range(&src, 0, 1, &root, "b.txt").unwrap();
        finalize_into(&root, "b.txt", 0, 0o600).unwrap();
        let m2 = std::fs::metadata(root.join("b.txt")).unwrap().permissions().mode() & 0o777;
        assert_eq!(m2, 0o644, "非執行檔一律 0o644");
        std::fs::remove_dir_all(&root).unwrap();
    }

}
