// Windows release 版隱藏主控台視窗。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Cinderous 桌面 Tauri 二進位（B1 殼）。
//!
//! 目前包住 `apps/desktop` 前端（於 webview 執行既有 React UI + RelayChatBackend）。
//! 原生服務（背景長連線 B3、SQLCipher 持久化 B4、OS 金鑰庫 B5）將以 `ipc` 契約
//! 逐步經 `#[tauri::command]` / `emit` 接上；此檔先提供最小可執行殼與橋接示範。
//!
//! 需以 `--features tauri-app` 在具 Tauri 工具鏈與 webkit2gtk 的環境建置。

use cinder_desktop::encstore;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

/// 顯示並聚焦主視窗（系統匣點擊/選單用）。
// 檔案安全原語（ADR-0119）：檔名白名單、原子寫入、毀損隔離。**住在 lib**，因為這個 bin
// target 需要 `tauri-app` feature，`cargo test` 永遠編不到它——安全關鍵的東西不能沒測試。
use cinder_desktop::filestream; // ADR-0355：合集送出的走訪與定位讀取
use cinder_desktop::inbox; // ADR-0349：收檔串流落盤（邏輯在 lib，此處只留薄殼）
use cinder_desktop::partfile::{atomic_write, quarantine, sanitize_filename, valid_part};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 版本更新後首次啟動：清 WebView2 資產快取（避免載到殘留舊前端）；只刪
/// Cache/Code Cache/GPUCache，**保留 Local Storage/IndexedDB**（使用者資料/設定）。
/// 僅 Windows（其他平台無 `LOCALAPPDATA` → 早退，no-op）。ADR-0197。
fn clear_webview_cache_on_update() {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let base = std::path::Path::new(&local).join("app.cinder.desktop");
    let ver_file = base.join("app-version.txt");
    let current = env!("CARGO_PKG_VERSION");
    if std::fs::read_to_string(&ver_file).unwrap_or_default().trim() == current {
        return; // 同版，不動快取
    }
    let webview = base.join("EBWebView").join("Default");
    for c in ["Cache", "Code Cache", "GPUCache"] {
        let _ = std::fs::remove_dir_all(webview.join(c));
    }
    let _ = std::fs::create_dir_all(&base);
    let _ = std::fs::write(&ver_file, current);
}

/// 橋接健康檢查：供前端確認原生層就緒（B2 IPC 契約的首個 command）。
#[tauri::command]
fn native_ready() -> String {
    format!("cinder native bridge {}", env!("CARGO_PKG_VERSION"))
}

/// 叫回並聚焦主視窗（通知點擊用，ADR-0076）：從系統匣隱藏狀態帶回前景。
#[tauri::command]
fn focus_window(app: tauri::AppHandle) {
    show_main(&app);
}

// ── B5 金鑰庫 IPC（ADR-0053）：私鑰託管於 OS 安全儲存，前端經 invoke 存取 ──────

/// 存入某身分（pubkey）的 nsec 到 OS 金鑰庫。
/// 擋下前端指名 Rust 專用的金鑰庫帳號（ADR-0128／0356）。
///
/// 🔴 少了這一行，`invoke('key_get', { pubkey: 'cf:deploy' })` 就能讓任何 XSS 拿到使用者
/// 整個 Cloudflare 帳號的控制權。判斷住在 `cinder_desktop::keyaccount`（lib，有測試）。
fn guard_frontend_account(account: &str) -> Result<(), String> {
    if cinder_desktop::keyaccount::is_frontend_account(account) {
        Ok(())
    } else {
        Err("非法的金鑰庫帳號".into())
    }
}

#[tauri::command]
fn key_set(pubkey: String, nsec: String) -> Result<(), String> {
    guard_frontend_account(&pubkey)?;
    cinder_desktop::keyvault::set_key(&pubkey, &nsec).map_err(|e| e.to_string())
}

/// 取出某身分的 nsec；不存在回 `None`。
#[tauri::command]
fn key_get(pubkey: String) -> Result<Option<String>, String> {
    guard_frontend_account(&pubkey)?;
    cinder_desktop::keyvault::get_key(&pubkey).map_err(|e| e.to_string())
}

/// 刪除某身分的 nsec（登出/移除身分）。
#[tauri::command]
fn key_delete(pubkey: String) -> Result<(), String> {
    guard_frontend_account(&pubkey)?;
    cinder_desktop::keyvault::delete_key(&pubkey).map_err(|e| e.to_string())
}

// ── B2 加密儲存 IPC（ADR-0054）：整包狀態快照 AES-256-GCM 加密落地 ──────────────

/// 某命名空間的密文檔路徑：`<app_data>/store/<namespace|legacy>.enc`。
fn store_path(app: &tauri::AppHandle, namespace: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("store");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = if namespace.is_empty() { "legacy" } else { namespace };
    Ok(dir.join(format!("{name}.enc")))
}

/// 解鎖後的 db 金鑰快取（namespace → key；H4，ADR-0067）：密碼只在解鎖時參與 KDF，
/// 不進 store_load/store_save 熱路徑；明文金鑰僅存於原生記憶體，上鎖即清除。
fn unlocked_keys() -> &'static std::sync::Mutex<std::collections::HashMap<String, [u8; encstore::KEY_LEN]>> {
    use std::sync::OnceLock;
    static KEYS: OnceLock<std::sync::Mutex<std::collections::HashMap<String, [u8; encstore::KEY_LEN]>>> =
        OnceLock::new();
    KEYS.get_or_init(Default::default)
}

/// 取得或建立某命名空間的 DB 金鑰（存 OS 金鑰庫，account `db:<namespace>`）。
/// 條目被本地密碼包裹時（ADR-0067），改讀解鎖快取；未解鎖回 `Err`。
fn db_key(namespace: &str) -> Result<[u8; encstore::KEY_LEN], String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let account = format!("db:{namespace}");
    match cinder_desktop::keyvault::get_key(&account).map_err(|e| e.to_string())? {
        Some(v) if cinder_desktop::passlock::is_wrapped(&v) => unlocked_keys()
            .lock()
            .unwrap()
            .get(namespace)
            .copied()
            .ok_or_else(|| "已上鎖：需要本地密碼解鎖".to_string()),
        Some(b64) => {
            let bytes = STANDARD.decode(b64).map_err(|e| e.to_string())?;
            bytes.as_slice().try_into().map_err(|_| "DB 金鑰長度不符".to_string())
        }
        None => {
            let key = encstore::generate_key();
            cinder_desktop::keyvault::set_key(&account, &STANDARD.encode(key)).map_err(|e| e.to_string())?;
            Ok(key)
        }
    }
}

/// 載入某命名空間的解密狀態快照（JSON）；無資料回 `None`。
#[tauri::command]
fn store_load(app: tauri::AppHandle, namespace: String) -> Result<Option<String>, String> {
    let path = store_path(&app, &namespace)?;
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let key = db_key(&namespace)?;
    let plain = encstore::decrypt(&key, &data).map_err(|e| e.to_string())?;
    String::from_utf8(plain).map(Some).map_err(|e| e.to_string())
}

/// 加密並寫入某命名空間的狀態快照（JSON）。**僅供舊格式遷移**；日常寫入走 `store_save_part`。
#[tauri::command]
fn store_save(app: tauri::AppHandle, namespace: String, json: String) -> Result<(), String> {
    let path = store_path(&app, &namespace)?;
    let key = db_key(&namespace)?;
    let ciphertext = encstore::encrypt(&key, json.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&path, &ciphertext)
}

// ── 分部位持久化（ADR-0110）──────────────────────────────────────────────
//
// 舊做法把**整個**儲存序列化＋加密＋寫檔，每 250ms 一次。成本是 O(總量)：實測 10 萬則
// 訊息＝每次 35ms 序列化 ＋ ~10MB 加密 ＋ ~10MB 寫檔——**只因為改了一則訊息的狀態**。
//
// 改為逐部位：`meta`（身分/聯絡人/群組…）與每個對話各一個檔，只重寫**變動的**部位。
// 成本降為 O(該對話)，與總歷史長度無關。

/// 某命名空間的部位目錄：`<app_data>/store/<namespace|legacy>/`。
fn part_dir(app: &tauri::AppHandle, namespace: &str) -> Result<std::path::PathBuf, String> {
    let name = if namespace.is_empty() { "legacy" } else { namespace };
    if !valid_part(name) {
        return Err("非法 namespace".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("store")
        .join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 載入某命名空間的所有部位（part → 解密後的 JSON）。無目錄/無檔案回空表。
#[tauri::command]
fn store_load_parts(
    app: tauri::AppHandle,
    namespace: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let dir = part_dir(&app, &namespace)?;
    let key = db_key(&namespace)?;
    let mut out = std::collections::HashMap::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("enc") {
            continue;
        }
        let Some(part) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let data = std::fs::read(&path).map_err(|e| e.to_string())?;
        // 單一部位毀損不該讓整個載入失敗（其餘部位仍可用）——但**也不能靜默丟棄**：
        // 下一次寫入會用「只剩新資料」的內容覆蓋它。隔離起來（改名 .corrupt），資料還有救。
        let Ok(plain) = encstore::decrypt(&key, &data) else {
            quarantine(&path);
            continue;
        };
        let Ok(json) = String::from_utf8(plain) else {
            quarantine(&path);
            continue;
        };
        out.insert(part.to_string(), json);
    }
    Ok(out)
}

/// 加密並寫入單一部位。
#[tauri::command]
fn store_save_part(
    app: tauri::AppHandle,
    namespace: String,
    part: String,
    json: String,
) -> Result<(), String> {
    if !valid_part(&part) {
        return Err("非法部位名".into());
    }
    let dir = part_dir(&app, &namespace)?;
    let key = db_key(&namespace)?;
    let ciphertext = encstore::encrypt(&key, json.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&dir.join(format!("{part}.enc")), &ciphertext)
}

// ── 訊息封存（ADR-0111）────────────────────────────────────────────────
//
// 冷資料（超出熱區的舊訊息）以**加密塊檔**落地：`<store>/<ns>/archive/<convo>.<seq>.enc`。
//
// 為什麼是檔案而不是 IndexedDB：桌面的儲存**本來就是加密的**（encstore，AES-256-GCM）。
// 封存改走 IndexedDB 會是**明文**——那是靜態加密的**默默降級**。用檔案則直接沿用同一把
// db 金鑰與同一套加密，零新機制。
//
// 注意：`archive/` 是 `<ns>/` 下的**子目錄**，而 `store_load_parts` 只收 `.enc` 副檔名的
// **檔案**（目錄無副檔名 → 自然跳過）——開機時不會把封存一起載入，這正是重點。

/// 某命名空間的封存目錄：`<store>/<ns>/archive/`。
fn archive_dir(app: &tauri::AppHandle, namespace: &str) -> Result<std::path::PathBuf, String> {
    let dir = part_dir(app, namespace)?.join("archive");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 封存某對話的一個塊（加密）。
#[tauri::command]
fn archive_append(
    app: tauri::AppHandle,
    namespace: String,
    convo: String,
    seq: u32,
    json: String,
) -> Result<(), String> {
    if !valid_part(&convo) {
        return Err("非法對話鍵".into());
    }
    let dir = archive_dir(&app, &namespace)?;
    let key = db_key(&namespace)?;
    let ciphertext = encstore::encrypt(&key, json.as_bytes()).map_err(|e| e.to_string())?;
    atomic_write(&dir.join(format!("{convo}.{seq}.enc")), &ciphertext)
}

/// 某對話的封存塊數（= 最大 seq + 1；無封存回 0）。
#[tauri::command]
fn archive_count(app: tauri::AppHandle, namespace: String, convo: String) -> Result<u32, String> {
    if !valid_part(&convo) {
        return Err("非法對話鍵".into());
    }
    let dir = archive_dir(&app, &namespace)?;
    let prefix = format!("{convo}.");
    let mut max: i64 = -1;
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(rest) = name.strip_prefix(&prefix).and_then(|r| r.strip_suffix(".enc")) else {
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

/// 讀某對話的第 `seq` 塊（解密）；不存在或毀損回 `None`。
#[tauri::command]
fn archive_load(
    app: tauri::AppHandle,
    namespace: String,
    convo: String,
    seq: u32,
) -> Result<Option<String>, String> {
    if !valid_part(&convo) {
        return Err("非法對話鍵".into());
    }
    let path = archive_dir(&app, &namespace)?.join(format!("{convo}.{seq}.enc"));
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let key = db_key(&namespace)?;
    // 單一塊毀損不該讓整個歷史打不開 → 回 None，其餘塊仍可讀。隔離起來別讓它被覆蓋。
    let Ok(plain) = encstore::decrypt(&key, &data) else {
        quarantine(&path);
        return Ok(None);
    };
    Ok(String::from_utf8(plain).ok())
}

/// 移除某對話的**全部**封存塊（刪好友/封鎖/退群）。
#[tauri::command]
fn archive_remove(app: tauri::AppHandle, namespace: String, convo: String) -> Result<(), String> {
    if !valid_part(&convo) {
        return Err("非法對話鍵".into());
    }
    let dir = archive_dir(&app, &namespace)?;
    let prefix = format!("{convo}.");
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(&prefix) && name.ends_with(".enc") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// 刪除單一部位（對話被移除時）。不存在視為成功。
#[tauri::command]
fn store_remove_part(app: tauri::AppHandle, namespace: String, part: String) -> Result<(), String> {
    if !valid_part(&part) {
        return Err("非法部位名".into());
    }
    let path = part_dir(&app, &namespace)?.join(format!("{part}.enc"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── 移除身分 / 清空裝置 IPC（ADR-0202）：破壞性、不可逆 ────────────────────────────

/// 移除單一身分：刪其 OS 金鑰庫條目（nsec＋db／rescue／改密碼暫存）與磁碟加密資料
/// （legacy 單檔＋parts/archive 目錄）。冪等——不存在的條目/檔案視為成功。
#[tauri::command]
fn wipe_identity(app: tauri::AppHandle, pubkey: String, namespace: String) -> Result<(), String> {
    // 1) 金鑰庫：nsec 與衍生金鑰。未啟用密碼時 rescue/db-next 不存在＝冪等刪除。
    for account in [
        pubkey.clone(),
        format!("db:{namespace}"),
        format!("rescue:{namespace}"),
        format!("db-next:{namespace}"),
    ] {
        cinder_desktop::keyvault::delete_key(&account).map_err(|e| e.to_string())?;
    }
    // 2) 本次 session 解鎖快取的明文 db 金鑰。
    unlocked_keys().lock().unwrap().remove(&namespace);
    // 3) 磁碟：legacy 單檔 + parts/archive 目錄（名稱規則同 store_path/part_dir）。
    let name = if namespace.is_empty() { "legacy" } else { &namespace };
    let store = app.path().app_data_dir().map_err(|e| e.to_string())?.join("store");
    let _ = std::fs::remove_file(store.join(format!("{name}.enc")));
    let _ = std::fs::remove_dir_all(store.join(name));
    Ok(())
}

/// 清空整台裝置的本機資料殘留：整個 store 目錄與檔案授權清單。各身分的金鑰庫條目
/// 由前端逐一 `wipe_identity` 負責（金鑰庫無法枚舉）。WebView 的 localStorage/IndexedDB
/// 由前端清除。冪等。
#[tauri::command]
fn wipe_store_dir(app: tauri::AppHandle) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(base.join("store"));
    let _ = std::fs::remove_file(base.join("file-authz"));
    Ok(())
}

/// 明文身分索引一列（pubkey/namespace 皆公開資訊）。
#[derive(serde::Deserialize)]
struct IdRef {
    pubkey: String,
    namespace: String,
}

/// 同步明文身分索引（ADR-0203）：寫 `<app_data>/identity-index.txt`（每行 `pubkey\tnamespace`）。
/// 供反安裝「一併清空」時——app 未跑、讀不到 WebView 登錄——仍能知道要刪哪些金鑰庫條目。
/// 前端於身分新增/移除/清空後呼叫。內容非機密（公鑰與命名空間皆公開）。
#[tauri::command]
fn sync_identity_index(app: tauri::AppHandle, identities: Vec<IdRef>) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let body = identities
        .iter()
        .map(|i| format!("{}\t{}", i.pubkey, i.namespace))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(base.join("identity-index.txt"), body).map_err(|e| e.to_string())
}

/// 反安裝「一併清空」CLI（ADR-0203）：以 `--wipe-local` 啟動時執行——app 未跑、無 AppHandle，
/// 故由環境變數推路徑。讀明文身分索引逐一刪金鑰庫條目，再刪磁碟資料（store/file-authz/索引）
/// 與 WebView2 設定檔。全程盡力而為（忽略個別失敗），不開視窗。
#[cfg(feature = "keyring")]
fn run_wipe_cli() {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let base = std::path::Path::new(&appdata).join("app.cinder.desktop");
        let index = base.join("identity-index.txt");
        if let Ok(body) = std::fs::read_to_string(&index) {
            for line in body.lines() {
                let mut it = line.splitn(2, '\t');
                let pubkey = it.next().unwrap_or("");
                let namespace = it.next().unwrap_or("");
                if pubkey.is_empty() {
                    continue;
                }
                for account in [
                    pubkey.to_string(),
                    format!("db:{namespace}"),
                    format!("rescue:{namespace}"),
                    format!("db-next:{namespace}"),
                ] {
                    let _ = cinder_desktop::keyvault::delete_key(&account);
                }
            }
        }
        let _ = std::fs::remove_dir_all(base.join("store"));
        let _ = std::fs::remove_file(base.join("file-authz"));
        let _ = std::fs::remove_file(&index);
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let _ = std::fs::remove_dir_all(std::path::Path::new(&local).join("app.cinder.desktop").join("EBWebView"));
    }
}

// ── H4 本地密碼 IPC（ADR-0067）：Argon2id KEK 包裹 nsec＋db 金鑰，取代金鑰庫明文條目 ──

/// 是否已啟用本地密碼（以金鑰庫實況為準，而非前端旗標）。
#[tauri::command]
fn pass_status(pubkey: String) -> Result<bool, String> {
    Ok(cinder_desktop::keyvault::get_key(&pubkey)
        .map_err(|e| e.to_string())?
        .map(|v| cinder_desktop::passlock::is_wrapped(&v))
        .unwrap_or(false))
}

/// 啟用本地密碼：包裹 nsec 與 db 金鑰後寫回（先算齊兩份 blob 再寫，避免半套狀態）。
#[tauri::command]
fn pass_enable(namespace: String, pubkey: String, password: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if password.is_empty() {
        return Err("密碼不得為空".into());
    }
    let nsec = cinder_desktop::keyvault::get_key(&pubkey)
        .map_err(|e| e.to_string())?
        .ok_or("找不到此身分的私鑰")?;
    if cinder_desktop::passlock::is_wrapped(&nsec) {
        return Err("此身分已啟用本地密碼".into());
    }
    let key = db_key(&namespace)?; // 未包裹路徑：取得（或首次建立）明文 db 金鑰
    let key_b64 = STANDARD.encode(key);
    let wrapped_nsec = cinder_desktop::passlock::wrap(&password, &nsec).map_err(|e| e.to_string())?;
    let wrapped_key = cinder_desktop::passlock::wrap(&password, &key_b64).map_err(|e| e.to_string())?;
    // ADR-0073：db 金鑰另以 nsec 衍生金鑰包裹，供忘記密碼救援。
    let rescue_blob = cinder_desktop::passlock::rescue_wrap(&nsec, &key_b64).map_err(|e| e.to_string())?;
    cinder_desktop::keyvault::set_key(&pubkey, &wrapped_nsec).map_err(|e| e.to_string())?;
    cinder_desktop::keyvault::set_key(&format!("db:{namespace}"), &wrapped_key).map_err(|e| e.to_string())?;
    cinder_desktop::keyvault::set_key(&format!("rescue:{namespace}"), &rescue_blob).map_err(|e| e.to_string())?;
    unlocked_keys().lock().unwrap().insert(namespace, key); // 啟用當下維持解鎖
    Ok(())
}

/// 解鎖：驗密碼、回傳 nsec 供建後端，並把 db 金鑰放入快取。密碼錯誤回 `Err`。
#[tauri::command]
fn pass_unlock(namespace: String, pubkey: String, password: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let v = cinder_desktop::keyvault::get_key(&pubkey)
        .map_err(|e| e.to_string())?
        .ok_or("找不到此身分的私鑰")?;
    if !cinder_desktop::passlock::is_wrapped(&v) {
        return Err("此身分未啟用本地密碼".into());
    }
    let nsec = cinder_desktop::passlock::unwrap(&password, &v).map_err(|e| e.to_string())?;
    let account = format!("db:{namespace}");
    let next_account = format!("db-next:{namespace}");
    if let Some(kb) = cinder_desktop::keyvault::get_key(&account).map_err(|e| e.to_string())? {
        if cinder_desktop::passlock::is_wrapped(&kb) {
            let key_b64 = match cinder_desktop::passlock::unwrap(&password, &kb) {
                Ok(k) => {
                    let _ = cinder_desktop::keyvault::delete_key(&next_account); // 清掉改密碼殘留
                    k
                }
                Err(e) => {
                    // 審查修正 #4：改密碼中斷的回退——db 仍是舊包裹時，以 db-next（新密碼包裹）
                    // 解開並回寫，完成被中斷的最後一步（自癒）。
                    let nb = cinder_desktop::keyvault::get_key(&next_account)
                        .map_err(|e2| e2.to_string())?
                        .ok_or_else(|| e.to_string())?;
                    let k = cinder_desktop::passlock::unwrap(&password, &nb).map_err(|e2| e2.to_string())?;
                    cinder_desktop::keyvault::set_key(&account, &nb).map_err(|e2| e2.to_string())?;
                    let _ = cinder_desktop::keyvault::delete_key(&next_account);
                    k
                }
            };
            let bytes = STANDARD.decode(&key_b64).map_err(|e| e.to_string())?;
            let key: [u8; encstore::KEY_LEN] =
                bytes.as_slice().try_into().map_err(|_| "DB 金鑰長度不符".to_string())?;
            unlocked_keys().lock().unwrap().insert(namespace.clone(), key);
            // ADR-0073 惰性補建：本功能前啟用密碼的使用者無 rescue blob，此時（nsec 與
            // db 金鑰皆在手）自動補建，讓既有使用者下次解鎖後即獲救援能力。
            let rescue_account = format!("rescue:{namespace}");
            let has_rescue = cinder_desktop::keyvault::get_key(&rescue_account)
                .map_err(|e| e.to_string())?
                .is_some();
            if !has_rescue {
                if let Ok(blob) = cinder_desktop::passlock::rescue_wrap(&nsec, &key_b64) {
                    let _ = cinder_desktop::keyvault::set_key(&rescue_account, &blob);
                }
            }
        } else {
            // 審查 F2：pass_enable 半套中斷（nsec 已包裹、db 尚未包裹）→ db 金鑰明文躺在
            // 金鑰庫（繞過密碼可讀）、且救援永不補建。此時（密碼已驗證＋db 明文在手）
            // 重新包裹 db 並補建 rescue，把這個窗口關掉。`kb` 即明文 db 金鑰 b64。
            let key_b64 = kb;
            if let Ok(wrapped) = cinder_desktop::passlock::wrap(&password, &key_b64) {
                let _ = cinder_desktop::keyvault::set_key(&account, &wrapped);
            }
            let bytes = STANDARD.decode(&key_b64).map_err(|e| e.to_string())?;
            let key: [u8; encstore::KEY_LEN] =
                bytes.as_slice().try_into().map_err(|_| "DB 金鑰長度不符".to_string())?;
            unlocked_keys().lock().unwrap().insert(namespace.clone(), key);
            let rescue_account = format!("rescue:{namespace}");
            if cinder_desktop::keyvault::get_key(&rescue_account).map_err(|e| e.to_string())?.is_none() {
                if let Ok(blob) = cinder_desktop::passlock::rescue_wrap(&nsec, &key_b64) {
                    let _ = cinder_desktop::keyvault::set_key(&rescue_account, &blob);
                }
            }
        }
    }
    Ok(nsec)
}

/// 上鎖（閒置逾時/登出）：清除快取的 db 金鑰；再存取需重新輸入密碼。
#[tauri::command]
fn pass_lock(namespace: String) {
    unlocked_keys().lock().unwrap().remove(&namespace);
}

/// 改密碼＝重包裹兩把金鑰（資料金鑰不變，資料檔不需重加密）。先驗舊密碼並算齊再寫。
#[tauri::command]
fn pass_change(namespace: String, pubkey: String, old: String, new: String) -> Result<(), String> {
    if new.is_empty() {
        return Err("新密碼不得為空".into());
    }
    let v = cinder_desktop::keyvault::get_key(&pubkey)
        .map_err(|e| e.to_string())?
        .ok_or("找不到此身分的私鑰")?;
    if !cinder_desktop::passlock::is_wrapped(&v) {
        return Err("此身分未啟用本地密碼".into());
    }
    let nsec = cinder_desktop::passlock::unwrap(&old, &v).map_err(|e| e.to_string())?;
    let account = format!("db:{namespace}");
    let key_plain = match cinder_desktop::keyvault::get_key(&account).map_err(|e| e.to_string())? {
        Some(kb) if cinder_desktop::passlock::is_wrapped(&kb) => {
            Some(cinder_desktop::passlock::unwrap(&old, &kb).map_err(|e| e.to_string())?)
        }
        _ => None,
    };
    let wrapped_nsec = cinder_desktop::passlock::wrap(&new, &nsec).map_err(|e| e.to_string())?;
    // 防斷電順序（審查修正 #4）：db-next(新) → nsec(新) → db(新) → 刪 db-next。
    // 任一中斷點皆可復原：nsec 未換前舊密碼全通；nsec 已換而 db 仍舊包裹時，
    // pass_unlock 以 db-next（新密碼包裹）回退自癒。兩條 credman 寫入本質非原子，
    // 此順序把「資料金鑰永久不可解」的窗口關掉。
    let next_account = format!("db-next:{namespace}");
    match &key_plain {
        Some(k) => {
            let wrapped_key = cinder_desktop::passlock::wrap(&new, k).map_err(|e| e.to_string())?;
            cinder_desktop::keyvault::set_key(&next_account, &wrapped_key).map_err(|e| e.to_string())?;
            cinder_desktop::keyvault::set_key(&pubkey, &wrapped_nsec).map_err(|e| e.to_string())?;
            cinder_desktop::keyvault::set_key(&account, &wrapped_key).map_err(|e| e.to_string())?;
            let _ = cinder_desktop::keyvault::delete_key(&next_account);
        }
        None => {
            cinder_desktop::keyvault::set_key(&pubkey, &wrapped_nsec).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 忘記密碼救援（ADR-0073）：以 nsec 解開 `rescue:` 拿回**真正那把** db 金鑰，
/// 用**新**密碼重包裹 nsec 與 db 金鑰——舊本地資料原封回來（非重來）。回傳 nsec 供建後端。
#[tauri::command]
fn pass_rescue(namespace: String, pubkey: String, nsec: String, new_password: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if new_password.is_empty() {
        return Err("新密碼不得為空".into());
    }
    let rescue_account = format!("rescue:{namespace}");
    let rescue_blob = cinder_desktop::keyvault::get_key(&rescue_account)
        .map_err(|e| e.to_string())?
        .ok_or("此身分沒有救援資料（可能於本功能上線前啟用；請於記得密碼時解鎖一次以補建）")?;
    // 只有正確 nsec 能解開（GCM 認證）——錯 nsec 直接失敗，等同身分核對。
    let key_b64 = cinder_desktop::passlock::rescue_unwrap(nsec.trim(), &rescue_blob).map_err(|e| e.to_string())?;
    // 以新密碼重包裹（防斷電順序：db-next → nsec → db → 刪 db-next，同 pass_change）。
    let wrapped_nsec = cinder_desktop::passlock::wrap(&new_password, nsec.trim()).map_err(|e| e.to_string())?;
    let wrapped_key = cinder_desktop::passlock::wrap(&new_password, &key_b64).map_err(|e| e.to_string())?;
    let account = format!("db:{namespace}");
    let next_account = format!("db-next:{namespace}");
    cinder_desktop::keyvault::set_key(&next_account, &wrapped_key).map_err(|e| e.to_string())?;
    cinder_desktop::keyvault::set_key(&pubkey, &wrapped_nsec).map_err(|e| e.to_string())?;
    cinder_desktop::keyvault::set_key(&account, &wrapped_key).map_err(|e| e.to_string())?;
    let _ = cinder_desktop::keyvault::delete_key(&next_account);
    // rescue blob 以 nsec 為鑰、nsec 未變，故無需更新；快取 db 金鑰以完成本次解鎖。
    let bytes = STANDARD.decode(&key_b64).map_err(|e| e.to_string())?;
    if let Ok(key) = <[u8; encstore::KEY_LEN]>::try_from(bytes.as_slice()) {
        unlocked_keys().lock().unwrap().insert(namespace, key);
    } else {
        return Err("DB 金鑰長度不符".into());
    }
    Ok(nsec.trim().to_string())
}

/// 停用本地密碼：驗密碼後把明文寫回金鑰庫（信任邊界回到 OS 帳號，ADR-0053 現況）。
#[tauri::command]
fn pass_disable(namespace: String, pubkey: String, password: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let v = cinder_desktop::keyvault::get_key(&pubkey)
        .map_err(|e| e.to_string())?
        .ok_or("找不到此身分的私鑰")?;
    if !cinder_desktop::passlock::is_wrapped(&v) {
        return Err("此身分未啟用本地密碼".into());
    }
    let nsec = cinder_desktop::passlock::unwrap(&password, &v).map_err(|e| e.to_string())?;
    let account = format!("db:{namespace}");
    let key_plain = match cinder_desktop::keyvault::get_key(&account).map_err(|e| e.to_string())? {
        Some(kb) if cinder_desktop::passlock::is_wrapped(&kb) => {
            Some(cinder_desktop::passlock::unwrap(&password, &kb).map_err(|e| e.to_string())?)
        }
        _ => None,
    };
    // 防斷電順序（審查修正 #4）：先寫回 db 明文、再寫 nsec 明文——中間崩潰時
    // nsec 仍是包裹（locked 旗標仍在）→ 解鎖畫面照常可走、db 已明文可讀；
    // 反序則會落在「nsec 明文但 db 上鎖、又無解鎖入口」的死角。
    if let Some(k) = &key_plain {
        cinder_desktop::keyvault::set_key(&account, k).map_err(|e| e.to_string())?;
        let bytes = STANDARD.decode(k).map_err(|e| e.to_string())?;
        if let Ok(key) = <[u8; encstore::KEY_LEN]>::try_from(bytes.as_slice()) {
            unlocked_keys().lock().unwrap().insert(namespace.clone(), key);
        }
    }
    cinder_desktop::keyvault::set_key(&pubkey, &nsec).map_err(|e| e.to_string())?;
    let _ = cinder_desktop::keyvault::delete_key(&format!("rescue:{namespace}")); // ADR-0073：一併清救援 blob
    Ok(())
}

// ── LLM 改寫/摘要 IPC（ADR-0060/0062）：本機 Ollama 或 OpenAI 相容線上服務。webview → Rust
//    reqwest（無 CORS）；線上 provider 的 API key 存 OS 金鑰庫、不落 JS/localStorage。──

fn ai_url(endpoint: &str, path: &str) -> String {
    format!("{}{}", endpoint.trim_end_matches('/'), path)
}

/// 僅允許 http/https 端點——防止把訊息內容 POST 到非 HTTP 目標（防禦性；ADR-0060）。
fn check_endpoint(endpoint: &str) -> Result<(), String> {
    match reqwest::Url::parse(endpoint) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => Ok(()),
        Ok(_) => Err("端點僅允許 http/https".into()),
        Err(_) => Err("無效的端點 URL".into()),
    }
}

/// 共用的 reqwest client（重用連線池，技術債修正）；逾時改為 per-request 設定。
fn http() -> &'static reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

const GEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const TAGS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

use cinder_desktop::aikey::{endpoint_host, key_account, legacy_key_allowed};

/// 線上 provider 的 API key——**綁定端點主機**（ADR-0235 H3）。
///
/// ## 修正前的缺口
///
/// 舊版是 `api_key(provider)`：只要 `provider == "openai"`，就對**呼叫端指定的任何 endpoint**
/// 無條件 `.bearer_auth(key)`。`check_endpoint` 只驗 scheme 是 http/https，不驗主機。於是
///
/// ```ignore
/// ai_generate("openai", "https://evil.example", model, prompt)
/// ```
///
/// 會把使用者的 API key 當 Bearer token、連同訊息明文一起送給攻擊者指定的主機。前端雖有
/// `ensureAllowed` 的 localhost 硬守則，但那是 **JS 層**——webview 一旦被 XSS 就完全繞過。
///
/// ## 現在的行為
///
/// key 以 `ai:<provider>:<host>` 存放，查詢時用**當次 endpoint 的主機**組 account。端點被換掉
/// ＝查不到 key ＝ 回 `Err`，金鑰**根本不會被讀出來**。使用者換 provider 主機（OpenAI →
/// OpenRouter）時需重新輸入 key——那本來就是不同的 key，是正確的 UX 而非退化。
fn api_key(provider: &str, endpoint: &str) -> Option<String> {
    let host = endpoint_host(endpoint)?;
    if let Some(k) = cinder_desktop::keyvault::get_key(&key_account(provider, &host)).ok().flatten() {
        return Some(k);
    }
    // 一次性沿用：舊版存在無主機的 `ai:<provider>`。只有當端點正是該 provider 的**官方主機**
    // 時才沿用——否則舊 key 又會被送到任意主機，等於沒修。
    if legacy_key_allowed(provider, &host) {
        return cinder_desktop::keyvault::get_key(&format!("ai:{provider}")).ok().flatten();
    }
    None
}

/// 存某 provider 在**某端點**的 API key（不落 JS/localStorage）。
#[tauri::command]
fn ai_set_key(provider: String, endpoint: String, key: String) -> Result<(), String> {
    let host = endpoint_host(&endpoint).ok_or("無效的端點 URL")?;
    cinder_desktop::keyvault::set_key(&key_account(&provider, &host), &key).map_err(|e| e.to_string())
}

/// 某 provider 在某端點是否已設 API key。
#[tauri::command]
fn ai_has_key(provider: String, endpoint: String) -> bool {
    api_key(&provider, &endpoint).is_some()
}

/// 生成（改寫/摘要）。ollama → /api/generate；openai → /v1/chat/completions（Bearer key）。
#[tauri::command]
async fn ai_generate(provider: String, endpoint: String, model: String, prompt: String) -> Result<String, String> {
    check_endpoint(&endpoint)?;
    if provider == "openai" {
        // ADR-0235 H3：key 綁主機——端點換掉就查不到，金鑰不會被讀出。
        let key = api_key("openai", &endpoint).ok_or("此端點未設定 API key（請於設定中為該端點輸入）")?;
        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": prompt }],
            "stream": false
        });
        let resp = http()
            .post(ai_url(&endpoint, "/v1/chat/completions"))
            .timeout(GEN_TIMEOUT)
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("openai {}", resp.status()));
        }
        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        return Ok(data["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string());
    }
    let body = serde_json::json!({ "model": model, "prompt": prompt, "stream": false });
    let resp = http()
        .post(ai_url(&endpoint, "/api/generate"))
        .timeout(GEN_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("ollama {}", resp.status()));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.get("response").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

/// 偵測可用。ollama → GET /api/tags；openai → 有 key 即視為可用（不多打一次 API）。
#[tauri::command]
async fn ai_available(provider: String, endpoint: String) -> bool {
    if check_endpoint(&endpoint).is_err() {
        return false;
    }
    if provider == "openai" {
        return api_key("openai", &endpoint).is_some();
    }
    matches!(
        http().get(ai_url(&endpoint, "/api/tags")).timeout(TAGS_TIMEOUT).send().await,
        Ok(r) if r.status().is_success()
    )
}

/// 列出模型。ollama → /api/tags 的 name；openai → /v1/models 的 id（Bearer key）。
#[tauri::command]
async fn ai_models(provider: String, endpoint: String) -> Result<Vec<String>, String> {
    check_endpoint(&endpoint)?;
    let (path, list_key, id_key, auth) = if provider == "openai" {
        ("/v1/models", "data", "id", api_key("openai", &endpoint))
    } else {
        ("/api/tags", "models", "name", None)
    };
    let mut req = http().get(ai_url(&endpoint, path)).timeout(TAGS_TIMEOUT);
    if let Some(key) = auth {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{provider} {}", resp.status()));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let names = data
        .get(list_key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get(id_key).and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(names)
}

// ── 收檔另存 IPC（ADR-0093）：位元組交給 OS 檔案系統，App 不保管檔案本體 ──────────────

// ── 讀檔路徑白名單（ADR-0128）──────────────────────────────────────────────────
//
// `read_saved_file` 對整個 webview 開放。一旦有 XSS，惡意 JS 就能讀走行程能讀的**任何檔案**。
// 縱深防禦：只讀**使用者透過原生對話框親自授權過**的路徑。授權事件（save_file/pick_existing_file）
// 把路徑加入白名單；`read_saved_file` 只讀白名單內的。持久化 → ADR-0102 的跨 session 讀原檔照常。
// 存的是路徑的 **SHA-256 雜湊**，不是路徑本身——這道防禦不該自己變成明文檔名清單的洩漏。

fn authorized_paths() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SET: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
    SET.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// 白名單檔：`<app_data>/file-authz`（每行一個 hex 雜湊）。
fn authz_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("file-authz"))
}

fn path_hash(path: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(path.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 首次使用時把持久化的白名單載入記憶體（去重）。
fn load_authz_once(app: &tauri::AppHandle) {
    static LOADED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    LOADED.get_or_init(|| {
        if let Ok(file) = authz_file(app) {
            if let Ok(contents) = std::fs::read_to_string(&file) {
                if let Ok(mut set) = authorized_paths().lock() {
                    for line in contents.lines() {
                        let h = line.trim();
                        if !h.is_empty() {
                            set.insert(h.to_string());
                        }
                    }
                }
            }
        }
    });
}

/// 授權一個路徑（使用者透過原生對話框選定後）：加入記憶體白名單並持久化。
fn authorize_path(app: &tauri::AppHandle, path: &str) {
    load_authz_once(app);
    let h = path_hash(path);
    let inserted = authorized_paths().lock().map(|mut s| s.insert(h.clone())).unwrap_or(false);
    if inserted {
        if let Ok(file) = authz_file(app) {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
                let _ = writeln!(f, "{h}");
            }
        }
    }
}

fn is_authorized(app: &tauri::AppHandle, path: &str) -> bool {
    load_authz_once(app);
    authorized_paths().lock().map(|s| s.contains(&path_hash(path))).unwrap_or(false)
}

// ── 寫入白名單（與讀取白名單分家）─────────────────────────────────────────────
//
// 🔴 為什麼要分兩份：在 ADR-0355／0356 之前，`authorized_paths` 只被**讀取**類指令用
// （`read_saved_file`）。合集解包讓它同時變成寫入授權，於是使用者為了「傳一個資料夾給
// 朋友」而拖進來的目錄、以及歷史上每一個另存過的路徑，全部**永久**成為 `extract_copy`
// 的合法寫入目的地。
//
// 他選那個資料夾的語意是「讀這個給對方」，不是「歡迎往裡面寫檔」。拖放給讀、
// 主動挑資料夾才給寫。

/// 可寫入的路徑（雜湊集合）。與讀取那份各自持久化，互不影響。
fn write_paths() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SET: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
    SET.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

fn write_authz_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("file-authz-write"))
}

fn load_write_authz_once(app: &tauri::AppHandle) {
    static LOADED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    LOADED.get_or_init(|| {
        if let Ok(file) = write_authz_file(app) {
            if let Ok(contents) = std::fs::read_to_string(&file) {
                if let Ok(mut set) = write_paths().lock() {
                    for line in contents.lines() {
                        let h = line.trim();
                        if !h.is_empty() {
                            set.insert(h.to_string());
                        }
                    }
                }
            }
        }
    });
}

/// 授權一個路徑**可寫入**（使用者主動挑了一個資料夾當目的地）。
///
/// 一併給讀取權：既然他願意讓我們往裡面寫，讀回自己寫的東西不是額外的權限擴張，
/// 而解包的驗證流程需要讀得回來。
fn authorize_write_path(app: &tauri::AppHandle, path: &str) {
    load_write_authz_once(app);
    let h = path_hash(path);
    let inserted = write_paths().lock().map(|mut s| s.insert(h.clone())).unwrap_or(false);
    if inserted {
        if let Ok(file) = write_authz_file(app) {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
                let _ = writeln!(f, "{h}");
            }
        }
    }
    authorize_path(app, path);
}

/// 這個路徑可不可以**寫入**。
fn is_write_authorized(app: &tauri::AppHandle, path: &str) -> bool {
    load_write_authz_once(app);
    write_paths().lock().map(|s| s.contains(&path_hash(path))).unwrap_or(false)
}

/// 收檔另存：開原生「另存新檔」對話框讓使用者選位置並寫入位元組；取消回 `None`。
/// 回傳使用者選定的路徑供 UI 顯示。位元組由前端經 IPC 傳入（收自 P2P，不落 App 儲存）。
#[tauri::command]
fn save_file(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<Option<String>, String> {
    // ADR-0128：`name` 來自對方傳來的 metadata（遠端可控）→ 消毒成乾淨 basename 再預填。
    match rfd::FileDialog::new().set_file_name(sanitize_filename(&name)).save_file() {
        Some(path) => {
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            let s = path.to_string_lossy().into_owned();
            authorize_path(&app, &s); // 使用者選定 → 授權讀回（ADR-0128）
            Ok(Some(s))
        }
        None => Ok(None),
    }
}

// ── 收檔串流落盤（ADR-0349）─────────────────────────────────────────────────────
//
// 這四個 command 是**薄殼**：路徑解析、檔名白名單、寫入、移動、清理全部住在
// `cinder_desktop::inbox`（lib，有測試）。ADR-0348 讓 CI 開始編譯 `main.rs`，但仍然
// 測不到它——所以邏輯不該放這裡（比照 ADR-0119 對 `partfile` 的處理）。

/// 暫存區基底：`<app_data>`（`inbox` 子目錄由 lib 負責建立）。
fn inbox_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// 開始接收一份檔案：建立（並截斷）暫存檔。
#[tauri::command]
fn inbox_begin(app: tauri::AppHandle, handle: String) -> Result<(), String> {
    inbox::begin(&inbox_base(&app)?, &handle).map(|_| ())
}

/// 寫入一塊。**位元組逐塊過 IPC**（16 KiB 一塊），不是整份——那正是本 ADR 要修的事。
#[tauri::command]
fn inbox_write(app: tauri::AppHandle, handle: String, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
    inbox::write_at(&inbox_base(&app)?, &handle, offset, &bytes)
}

/// 放棄一份暫存檔（傳輸中止／使用者取消另存）。
#[tauri::command]
fn inbox_discard(app: tauri::AppHandle, handle: String) -> Result<(), String> {
    inbox::discard(&inbox_base(&app)?, &handle)
}

/// 另存：開原生對話框 → **原生移動**暫存檔到選定位置（零位元組過 IPC）→ 授權讀回。
/// 使用者取消回 `None`，暫存檔**保留**（他可能想再存一次）。
#[tauri::command]
fn save_from_inbox(app: tauri::AppHandle, name: String, handle: String) -> Result<Option<String>, String> {
    // ADR-0128：`name` 來自對方傳來的 metadata（遠端可控）→ 消毒成乾淨 basename 再預填。
    match rfd::FileDialog::new().set_file_name(sanitize_filename(&name)).save_file() {
        Some(path) => {
            inbox::finish_into(&inbox_base(&app)?, &handle, &path)?;
            let s = path.to_string_lossy().into_owned();
            authorize_path(&app, &s); // 使用者選定 → 授權讀回（ADR-0128）
            Ok(Some(s))
        }
        None => Ok(None),
    }
}

/// 開機清理：刪掉超過一天的暫存檔（使用者在另存前關掉 app 就會留下）。回傳刪除數。
#[tauri::command]
fn inbox_sweep(app: tauri::AppHandle) -> Result<usize, String> {
    Ok(inbox::sweep(&inbox_base(&app)?, 24 * 3600))
}

// ── 開啟原檔 / 重新指定位置（ADR-0102）──────────────────────────────────────────
//
// 縮圖跨 session 存活，但**原檔位元組不由 App 保存**（ADR-0093）——原檔就在使用者當初
// 選定的 `savedPath`。要看原圖時從那裡讀回；使用者若把檔案搬走，就讓他重新指定新位置。

/// 讀回已另存的原檔。路徑不存在、或**未經原生對話框授權**（ADR-0128）皆回 `Ok(None)`
/// ——讓前端走既有的「重新指定」流程，且不給 XSS 可用的訊號。
#[tauri::command]
fn read_saved_file(app: tauri::AppHandle, path: String) -> Result<Option<Vec<u8>>, String> {
    if !is_authorized(&app, &path) {
        return Ok(None); // 不是使用者親自授權過的路徑 → 當作「不存在」
    }
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Ok(None);
    }
    std::fs::read(p).map(Some).map_err(|e| e.to_string())
}

// ── 合集送出：資料夾走訪與定位讀取（ADR-0355）────────────────────────────────────
//
// 這四個 command 是薄殼，邏輯住在 `cinder_desktop::filestream`（lib，有測試）。
// **全部經 ADR-0128 白名單**：只有使用者親自以原生對話框選定、或親手拖進視窗的路徑
// 才讀得到。拖放的授權在 `WindowEvent::DragDrop` 那裡做（見 `run()`），因為路徑來自
// 作業系統；若改成讓前端呼叫授權 command，等於把白名單的鑰匙交給 webview。

/// 一個路徑的基本資訊（前端據此決定要不要打包成合集）。
#[derive(serde::Serialize)]
struct FsStat {
    is_dir: bool,
    size: u64,
    mtime: u64,
    mode: u32,
}

/// 看一個路徑是什麼。未授權或不存在皆回 `None`——與 `read_saved_file` 同樣不給 XSS 訊號。
#[tauri::command]
fn fs_stat(app: tauri::AppHandle, path: String) -> Option<FsStat> {
    if !is_authorized(&app, &path) {
        return None;
    }
    let meta = std::fs::metadata(&path).ok()?;
    Some(FsStat {
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        mtime: filestream::mtime_of(&meta),
        mode: filestream::mode_of(&meta),
    })
}

/// 攤平一個資料夾。超過上限（一萬檔／10 GiB／32 層）回 `Err`，讓前端能說明為什麼送不出去
/// ——這跟「未授權」不同，使用者確實選了它，只是太大。
#[tauri::command]
fn fs_list_dir(app: tauri::AppHandle, path: String) -> Result<Vec<serde_json::Value>, String> {
    if !is_authorized(&app, &path) {
        return Err("路徑未經授權".into());
    }
    let entries = filestream::walk_dir(std::path::Path::new(&path), filestream::WalkLimits::default())?;
    Ok(entries
        .into_iter()
        .map(|e| serde_json::json!({ "rel": e.rel, "size": e.size, "mtime": e.mtime, "mode": e.mode }))
        .collect())
}

/// 讀一個**已授權檔案**的某一段。
///
/// 回 `tauri::ipc::Response`＝**原始位元組通道**，不是 JSON 數字陣列。差別很實際：
/// 64 KiB 的分塊變成 JSON 大約要 40 萬個字元，逐塊序列化／解析的成本會直接吃掉送檔速度。
#[tauri::command]
fn fs_read_range(
    app: tauri::AppHandle,
    path: String,
    offset: u64,
    length: u32,
) -> Result<tauri::ipc::Response, String> {
    if !is_authorized(&app, &path) {
        return Err("路徑未經授權".into());
    }
    filestream::read_range(std::path::Path::new(&path), offset, length as usize).map(tauri::ipc::Response::new)
}

/// 讀一個**已授權資料夾底下**某個相對路徑的某一段。
///
/// 為什麼要分開這一個：走訪出來的子檔案沒有各自進白名單（一個資料夾可能有上萬個檔），
/// 授權的是那個資料夾。`rel` 由前端傳回來，所以這裡**必須自己驗**——逐段拒收 `..`、
/// 絕對路徑與磁碟代號，再以 `canonicalize` 確認結果仍在基底之下（防符號連結繞出去）。
#[tauri::command]
fn fs_read_range_in(
    app: tauri::AppHandle,
    base: String,
    rel: String,
    offset: u64,
    length: u32,
) -> Result<tauri::ipc::Response, String> {
    if !is_authorized(&app, &base) {
        return Err("路徑未經授權".into());
    }
    let root = std::path::Path::new(&base);
    let target = filestream::safe_join(root, &rel)?;
    // 逐段守衛擋不掉符號連結指向外面 → 再以實際路徑比對基底。
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    let real_target = target.canonicalize().map_err(|e| e.to_string())?;
    if !real_target.starts_with(&real_root) {
        return Err("合集內路徑逸出基底".into());
    }
    filestream::read_range(&real_target, offset, length as usize).map(tauri::ipc::Response::new)
}

// ── 合集解包（ADR-0355）────────────────────────────────────────────────────────
//
// tar 的解析在 TS（`@cinderous/core` 的 `readTar`，瀏覽器端也用同一份），這裡只做它
// 做不到的事：安全接路徑、依位移寫入、還原時間與權限。守衛住在 `filestream`（有測試）。

/// 把合集裡的一個檔案解出來：從合集的第 `at` 個位元組複製 `len` 個位元組成為 `<dest>/<rel>`。
///
/// 🔴 **內容一個位元組都不經過 IPC**。tar 的標頭讀在 TS（`listTar` 只讀那些 512 位元組的
/// 區塊，很便宜，而且瀏覽器共用同一份解析），但內容是純複製——讓它跑一趟 webview 等於
/// 把每個位元組轉成 JSON 數字再轉回來，一個 1 GB 的合集會變成 4～5 GB 的字串。
///
/// 回傳實際複製量：少於 `len` 代表合集被截斷，由前端決定怎麼說。
#[tauri::command]
fn extract_copy(
    app: tauri::AppHandle,
    path: String,
    dest: String,
    rel: String,
    at: u64,
    len: u64,
) -> Result<u64, String> {
    // 兩端各自要對的那一種授權：來源只需讀（他另存過的合集），目的地需**寫**。
    if !is_write_authorized(&app, &dest) {
        return Err("解包目的地未經授權".into());
    }
    if !is_authorized(&app, &path) {
        return Err("合集來源未經授權".into());
    }
    filestream::copy_range(std::path::Path::new(&path), at, len, std::path::Path::new(&dest), &rel)
}

/// 收尾一個解開的檔案：還原修改時間與權限。
#[tauri::command]
fn extract_finalize(app: tauri::AppHandle, dest: String, rel: String, mtime: u64, mode: u32) -> Result<(), String> {
    if !is_write_authorized(&app, &dest) {
        return Err("解包目的地未經授權".into());
    }
    filestream::finalize_into(std::path::Path::new(&dest), &rel, mtime, mode)
}

/// 目的磁碟的可用空間（位元組）；問不到回 `None`。
///
/// 為什麼要它：解包會把合集**再寫一份**到磁碟上，一個 8 GB 的合集需要 8 GB 的餘裕。
/// 寫到一半才發現磁碟滿了，留下的是一堆半截檔案——事前問一次便宜得多。
#[tauri::command]
fn fs_free_space(app: tauri::AppHandle, path: String) -> Option<u64> {
    if !is_write_authorized(&app, &path) {
        return None;
    }
    free_space_of(std::path::Path::new(&path))
}

/// 目的磁碟的可用空間（位元組）。
///
/// **只有 Windows 問得到**（走既有的 `windows` crate，不新增相依）；其他平台回 `None`，
/// 前端就不擋。這不是敷衍：磁碟滿了作業系統本來就會在寫入時報錯，事前檢查的價值是
/// 「不要先寫了 4 GB 才發現」，少了它仍然不會寫壞東西，只是白做一段工。為了補上
/// macOS／Linux 而引進 `libc` 或 `sysinfo`，代價（相依圖、ADR）高於這點收益。
#[cfg(windows)]
fn free_space_of(path: &std::path::Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide = HSTRING::from(path.as_os_str());
    let mut free: u64 = 0;
    // 第一個參數要的是「呼叫者可用」的量（有配額時與整體可用量不同）。
    unsafe { GetDiskFreeSpaceExW(&wide, Some(&mut free), None, None) }.ok()?;
    Some(free)
}

#[cfg(not(windows))]
fn free_space_of(_path: &std::path::Path) -> Option<u64> {
    None
}

// ── 一鍵部署自有 relay（ADR-0356）─────────────────────────────────────────────
//
// 這幾個 command 是薄殼；流程、錯誤分型與 metadata 產生全部住在 `cinder_desktop::cfdeploy`
// （lib，有測試）。這裡只做三件 lib 做不到的事：發真的 HTTP、碰 OS 金鑰庫、讀出貨資源。
//
// 🔴 **沒有任何一個 command 會把 token 回傳給前端**。使用者貼上之後它就進金鑰庫，
// 之後由 Rust 取用。webview 被 XSS 時，攻擊者最多能觸發一次部署，偷不走 token。

use cinder_desktop::cfdeploy::{self, Account, CfApi, CfAuth, CfResponse, DeployError, Deployed};

/// token 在 OS 金鑰庫裡的 account 名。
const CF_TOKEN_ACCOUNT: &str = "cf:deploy";

/// 部署相關呼叫的逾時。比 AI 生成短得多——這些是控制平面呼叫，慢到這個地步就是有問題了。
const CF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// 資產上傳的逾時。比控制平面長——這一步真的在搬位元組（統一模式約 1.4 MB）。
const ASSET_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// 傳給前端的失敗形狀：一個 i18n 鍵 ＋ 可選細節。
///
/// **不是把錯誤 `to_string()` 丟過去**——那樣前端只能原樣顯示英文，而使用者需要的是
/// 「你該做什麼」。鍵由 lib 的分型決定，句子在 i18n 裡翻譯。
#[derive(serde::Serialize)]
struct DeployFail {
    key: String,
    detail: String,
}

impl From<DeployError> for DeployFail {
    fn from(e: DeployError) -> Self {
        DeployFail { key: e.message_key().to_string(), detail: e.detail() }
    }
}

/// 帳號的可序列化形狀（lib 的 `Account` 不綁 serde，維持 lib 的零相依）。
#[derive(serde::Serialize)]
struct CfAccount {
    id: String,
    name: String,
}

/// 部署結果（可序列化）。
#[derive(serde::Serialize)]
struct CfDeployed {
    relay_url: String,
    account_id: String,
    subdomain: String,
}

/// 產線 HTTP：`reqwest`。
struct ReqwestApi;

impl ReqwestApi {
    /// 把 reqwest 的回應收成 lib 要的形狀。**不在這裡判成敗**——那是 lib 的事。
    async fn finish(resp: reqwest::Response) -> Result<CfResponse, DeployError> {
        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(|e| DeployError::Network(e.to_string()))?;
        Ok(CfResponse { status, body })
    }
    fn url(path: &str) -> String {
        format!("{}{path}", cfdeploy::API_BASE)
    }
}

impl CfApi for ReqwestApi {
    async fn get(&self, path: &str, auth: &CfAuth) -> Result<CfResponse, DeployError> {
        let resp = http()
            .get(Self::url(path))
            .timeout(CF_TIMEOUT)
            .bearer_auth(auth.bearer())
            .send()
            .await
            .map_err(|e| DeployError::Network(e.to_string()))?;
        Self::finish(resp).await
    }

    async fn put_json(&self, path: &str, auth: &CfAuth, body: String) -> Result<CfResponse, DeployError> {
        let resp = http()
            .put(Self::url(path))
            .timeout(CF_TIMEOUT)
            .bearer_auth(auth.bearer())
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| DeployError::Network(e.to_string()))?;
        Self::finish(resp).await
    }

    async fn post_json(&self, path: &str, auth: &CfAuth, body: String) -> Result<CfResponse, DeployError> {
        let resp = http()
            .post(Self::url(path))
            .timeout(CF_TIMEOUT)
            .bearer_auth(auth.bearer())
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| DeployError::Network(e.to_string()))?;
        Self::finish(resp).await
    }

    async fn delete(&self, path: &str, auth: &CfAuth) -> Result<CfResponse, DeployError> {
        let resp = http()
            .delete(Self::url(path))
            .timeout(CF_TIMEOUT)
            .bearer_auth(auth.bearer())
            .send()
            .await
            .map_err(|e| DeployError::Network(e.to_string()))?;
        Self::finish(resp).await
    }

    async fn post_assets(
        &self,
        path: &str,
        jwt: &str,
        files: Vec<(String, String)>,
    ) -> Result<CfResponse, DeployError> {
        // 每個檔案一個 `body` 欄位，欄位名＝雜湊、值＝base64 內容（`?base64=true`）。
        let mut form = reqwest::multipart::Form::new();
        for (hash, b64) in files {
            let part = reqwest::multipart::Part::text(b64)
                .file_name(hash.clone())
                .mime_str("application/null")
                .map_err(|e| DeployError::Malformed(e.to_string()))?;
            form = form.part(hash, part);
        }
        let resp = http()
            .post(Self::url(path))
            .timeout(ASSET_TIMEOUT)
            .bearer_auth(jwt) // 🔴 工作階段的 jwt，不是帳號 token
            .multipart(form)
            .send()
            .await
            .map_err(|e| DeployError::Network(e.to_string()))?;
        Self::finish(resp).await
    }

    async fn put_script(
        &self,
        path: &str,
        auth: &CfAuth,
        metadata: String,
        module: Vec<u8>,
    ) -> Result<CfResponse, DeployError> {
        // multipart：一個 `metadata` JSON 欄位 ＋ 一個模組檔欄位。欄位名必須等於 metadata
        // 裡的 `main_module`，否則 Cloudflare 找不到進入點。
        let part = reqwest::multipart::Part::bytes(module)
            .file_name(cfdeploy::MODULE_PART.to_string())
            .mime_str("application/javascript+module")
            .map_err(|e| DeployError::Malformed(e.to_string()))?;
        let form = reqwest::multipart::Form::new()
            .text("metadata", metadata)
            .part(cfdeploy::MODULE_PART, part);
        let resp = http()
            .put(Self::url(path))
            .timeout(CF_TIMEOUT)
            .bearer_auth(auth.bearer())
            .multipart(form)
            .send()
            .await
            .map_err(|e| DeployError::Network(e.to_string()))?;
        Self::finish(resp).await
    }
}

/// 從金鑰庫取出授權憑證；沒有就是「還沒貼 token」。
fn cf_auth() -> Result<CfAuth, DeployFail> {
    match cinder_desktop::keyvault::get_key(CF_TOKEN_ACCOUNT) {
        Ok(Some(t)) if !t.is_empty() => Ok(CfAuth::Token(t)),
        _ => Err(DeployFail { key: "deploy_errNoToken".into(), detail: String::new() }),
    }
}

/// 讀出貨的 worker bundle。
///
/// 它是 `tauri.conf.json` 的 `resources` 之一，由 `pnpm --filter @cinderous/relay build:worker`
/// 產生並進安裝檔。**刻意不讓前端提供這段程式碼**：那樣一個 XSS 就能把後門 worker
/// 部署到使用者自己的 Cloudflare 帳號上。
fn worker_module(app: &tauri::AppHandle) -> Result<Vec<u8>, DeployFail> {
    let fail = |e: String| DeployFail { key: "deploy_errBundle".into(), detail: e };
    let path = app
        .path()
        .resolve("resources/relay-worker.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| fail(e.to_string()))?;
    std::fs::read(&path).map_err(|e| fail(e.to_string()))
}

/// 讀出貨的網頁版資產（統一模式用，ADR-0354 ＋ 0356 §5）。
///
/// 它們是 `resources/web/**`，由 `pnpm --filter @cinderous/desktop build:embed` 以
/// **unified 模式**建置——那個模式會把網頁版的預設中繼站指向「它自己這個來源」，
/// 所以部署出來的站台一打開就連自己，不必再叫使用者填網址。
///
/// 路徑一律相對於 `resources/web`、一律正斜線：那是 manifest 的鍵格式。
fn web_assets(app: &tauri::AppHandle) -> Result<Vec<cfdeploy::Asset>, DeployFail> {
    let fail = |e: String| DeployFail { key: "deploy_errBundle".into(), detail: e };
    let root = app
        .path()
        .resolve("resources/web", tauri::path::BaseDirectory::Resource)
        .map_err(|e| fail(e.to_string()))?;
    let mut out = Vec::new();
    collect_web(&root, &root, &mut out).map_err(fail)?;
    if out.is_empty() {
        return Err(fail("網頁版資產是空的".into()));
    }
    Ok(out)
}

fn collect_web(
    root: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<cfdeploy::Asset>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue; // 出貨資產裡不該有連結；有的話也不跟隨
        }
        if meta.is_dir() {
            collect_web(root, &path, out)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "資產路徑不在根目錄之下".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        out.push(cfdeploy::Asset {
            path: rel,
            bytes: std::fs::read(&path).map_err(|e| e.to_string())?,
        });
    }
    Ok(())
}

/// 建立 API token 的預填連結（最小權限）。
#[tauri::command]
fn cf_token_url() -> String {
    cfdeploy::token_template_url()
}

/// 收下使用者貼上的 token：**直接進 OS 金鑰庫**，不回傳、不留在前端。
#[tauri::command]
fn cf_set_token(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("token 是空的".into());
    }
    cinder_desktop::keyvault::set_key(CF_TOKEN_ACCOUNT, t).map_err(|e| e.to_string())
}

/// 有沒有存著 token。**只回布林**——比照 `ai_has_key`，值本身永遠不出金鑰庫。
#[tauri::command]
fn cf_has_token() -> bool {
    matches!(cinder_desktop::keyvault::get_key(CF_TOKEN_ACCOUNT), Ok(Some(t)) if !t.is_empty())
}

/// 忘掉 token（使用者選了「用完即丟」，或想換一把）。刪不掉不算錯——它可能本來就不在。
#[tauri::command]
fn cf_forget_token() -> Result<(), String> {
    let _ = cinder_desktop::keyvault::delete_key(CF_TOKEN_ACCOUNT);
    Ok(())
}

/// 列出這把 token 看得到的 Cloudflare 帳號（多帳號時讓使用者挑）。
#[tauri::command]
async fn cf_list_accounts() -> Result<Vec<CfAccount>, DeployFail> {
    let auth = cf_auth()?;
    let accounts: Vec<Account> = cfdeploy::list_accounts(&ReqwestApi, &auth).await?;
    Ok(accounts.into_iter().map(|a| CfAccount { id: a.id, name: a.name }).collect())
}

/// 部署一座 relay 到使用者的帳號。
///
/// ⚠ **這裡回傳成功不代表 relay 活著**（ADR-0356 §4）。前端拿到網址後要真的連上去、
/// 收到 NIP-42 的 AUTH 挑戰才算數——驗證住前端是因為它本來就有 relay 客戶端。
#[tauri::command]
async fn cf_deploy(
    app: tauri::AppHandle,
    account_id: String,
    subdomain: Option<String>,
    unified: Option<bool>,
) -> Result<CfDeployed, DeployFail> {
    let auth = cf_auth()?;
    let module = worker_module(&app)?;
    // 🔴 統一模式必須用 `unified_spec()`——它帶著 `run_worker_first`。用 `relay_spec()`
    // 會部署出一座「網頁打得開、中繼站靜默死掉」的 Worker（ADR-0354 整份在防的事）。
    let unified_mode = unified == Some(true);
    let spec = if unified_mode { cfdeploy::unified_spec() } else { cfdeploy::relay_spec() };
    // 統一模式（ADR-0354）：網頁資產走三步上傳，完成憑證交給腳本上傳。
    // ⚠ 這會讓那座 Worker **同時送出客戶端程式**——被入侵就等於能換掉程式碼竊取金鑰。
    // 純 relay 沒有這條路徑，所以 UI 上這個選項預設不勾。
    let assets_jwt = if unified_mode {
        let assets = web_assets(&app)?;
        Some(cfdeploy::upload_assets(&ReqwestApi, &auth, &account_id, &spec.name, &assets).await?)
    } else {
        None
    };
    let out: Deployed = cfdeploy::deploy_with_assets(
        &ReqwestApi,
        &auth,
        &account_id,
        &spec,
        module,
        subdomain.as_deref(),
        assets_jwt.as_deref(),
    )
    .await?;
    Ok(CfDeployed { relay_url: out.relay_url, account_id: out.account_id, subdomain: out.subdomain })
}

/// 拆除自己部署的那座 relay（ADR-0356 §4）。
///
/// 使用者在精靈中途放棄、或部署失敗時呼叫。**不接受任意腳本名**——只拆我們自己會建的
/// 那一個，否則這會變成「用使用者的 token 刪掉他任何 Worker」的指令。
#[tauri::command]
async fn cf_teardown() -> Result<(), DeployFail> {
    let auth = cf_auth()?;
    let accounts = cfdeploy::list_accounts(&ReqwestApi, &auth).await?;
    // 冪等：每個看得到的帳號都試一次，已經不在的回 404＝完成。
    for a in accounts {
        cfdeploy::teardown(&ReqwestApi, &auth, &a.id, cfdeploy::WORKER_NAME).await?;
    }
    Ok(())
}

/// 統一模式的健康檢查：`GET <站>/healthz` 要回純文字 `ok`（ADR-0354）。
///
/// 🔴 **在 Rust 這側發**，不是前端。前端 fetch 那個網址需要放寬 `connect-src`，
/// 而 ADR-0356 §1 的「CSP 一個字都不用動」就會不成立。reqwest 不受 CSP 管。
///
/// 合體部署之後「`/` 回不回 HTML」已經不能拿來判斷中繼站死活——那正是這個端點存在的理由。
#[tauri::command]
async fn cf_verify_healthz(relay_url: String) -> bool {
    let Some(rest) = relay_url.strip_prefix("wss://") else {
        return false;
    };
    let url = format!("https://{}/healthz", rest.trim_end_matches('/'));
    let Ok(resp) = http().get(url).timeout(CF_TIMEOUT).send().await else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    resp.text().await.map(|t| t.trim() == "ok").unwrap_or(false)
}

// ── 公司儲存槽（ADR-0161）：企業主端靜默落盤 ─────────────────────────────────────
//
// 寫入**只允許**在槽基底目錄之下：基底＝使用者以原生對話框親選（授權）或未設時的
// `<app_data>/CinderSlot` 預設槽。子路徑（員工名/檔名）逐段以 `sanitize_filename`
// 消毒——寄件人可控字串絕不參與路徑語意（ADR-0128 延伸）。

/// 開「選擇資料夾」對話框（槽目錄設定用）；取消回 `None`。選定即授權為合法基底。
#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let picked = rfd::FileDialog::new().pick_folder().map(|p| p.to_string_lossy().into_owned());
    if let Some(ref s) = picked {
        // 主動挑一個資料夾＝願意讓我們往裡面寫（儲存槽落盤、合集解包）。拖放不給這個。
        authorize_write_path(&app, s);
    }
    picked
}

/// 解析槽基底：空字串＝`<app_data>/CinderSlot` 預設槽（隱式授權）；
/// 非空＝必須是使用者親選（授權）過的資料夾。
fn slot_base(app: &tauri::AppHandle, base: &str) -> Result<std::path::PathBuf, String> {
    if base.is_empty() {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("CinderSlot");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
    if !is_write_authorized(app, base) {
        return Err("儲存槽目錄未經授權".into());
    }
    Ok(std::path::PathBuf::from(base))
}

/// 寫入儲存槽：`<base>/<sub>/<name>`（sub/name 逐段消毒；重名自動加 ` (n)` 尾碼）。
/// 回傳實際寫入的**相對路徑**（供索引記錄）。
#[tauri::command]
fn write_slot_file(
    app: tauri::AppHandle,
    base: String,
    sub: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let root = slot_base(&app, &base)?;
    let sub_clean = sanitize_filename(&sub);
    let name_clean = sanitize_filename(&name);
    let dir = root.join(&sub_clean);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 重名：`name.ext` → `name (2).ext`、`name (3).ext`…
    let (stem, ext) = match name_clean.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name_clean.clone(), String::new()),
    };
    // 審查修正：check-then-write 是 TOCTOU——兩個並發存放（多員工同時傳）可能都選到同一
    // 候選名後互相覆蓋、靜默丟失一份，而 index.jsonl 卻記兩筆成功。改用 `create_new`
    // （O_EXCL 原子建檔）：檔案已存在即失敗，據此換下一個尾碼重試，保證不覆蓋既有檔。
    use std::io::Write;
    let mut candidate = name_clean.clone();
    let mut n = 2u32;
    loop {
        let path = dir.join(&candidate);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(&bytes).map_err(|e| e.to_string())?;
                return Ok(format!("{sub_clean}/{candidate}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                candidate = format!("{stem} ({n}){ext}");
                n += 1;
                if n > 9999 {
                    return Err("重名尾碼耗盡".into());
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// 附加一行文字到槽基底下的檔案（index.jsonl 用；檔名消毒、不接受子路徑）。
#[tauri::command]
fn append_slot_index(app: tauri::AppHandle, base: String, name: String, line: String) -> Result<(), String> {
    let root = slot_base(&app, &base)?;
    let path = root.join(sanitize_filename(&name));
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line.replace(['\r', '\n'], " ")).map_err(|e| e.to_string())
}

/// 開「選擇檔案」對話框讓使用者重新指定原檔位置；取消回 `None`。
#[tauri::command]
fn pick_existing_file(app: tauri::AppHandle, name: String) -> Option<String> {
    let mut dlg = rfd::FileDialog::new();
    // 以原檔名為起點，幫使用者更快找到（ADR-0128：檔名遠端可控 → 消毒）。
    let clean = sanitize_filename(&name);
    if !clean.is_empty() && clean != "file" {
        dlg = dlg.set_file_name(clean);
    }
    let picked = dlg.pick_file().map(|p| p.to_string_lossy().into_owned());
    if let Some(ref s) = picked {
        authorize_path(&app, s); // 使用者親自選了 → 授權讀回（ADR-0128）
    }
    picked
}

/// 結束程式（前端關閉確認選「結束」，ADR-0198）。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 縮到系統匣（前端關閉確認選「留在系統匣」，ADR-0198）。
#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// 目前系統正在播放的媒體（ADR-0252）：Windows GSMTC 讀「播放中」工作階段的曲目。
/// 純本機查詢、零網路；非 Windows／無播放／暫停中一律回 None（前端顯示偵測中）。
#[tauri::command]
fn now_playing_detect() -> Option<String> {
    #[cfg(windows)]
    {
        gsmtc_now_playing()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// GSMTC 查詢本體：目前媒體工作階段（Spotify/瀏覽器/播放器都會註冊）→ 僅「播放中」
/// 才回報，格式「演出者 — 曲名」（無演出者則只有曲名）。任何失敗都靜默回 None。
#[cfg(windows)]
fn gsmtc_now_playing() -> Option<String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Playback,
    };
    let mgr = Manager::RequestAsync().ok()?.get().ok()?;
    let session = mgr.GetCurrentSession().ok()?;
    if session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? != Playback::Playing {
        return None;
    }
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = props.Title().ok()?.to_string();
    let artist = props.Artist().ok().map(|s| s.to_string()).unwrap_or_default();
    if title.trim().is_empty() {
        return None;
    }
    Some(if artist.trim().is_empty() { title } else { format!("{artist} — {title}") })
}

fn main() {
    // 反安裝「一併清空」（ADR-0203）：以 `--wipe-local` 啟動＝headless 清資料後結束，不開視窗。
    #[cfg(feature = "keyring")]
    if std::env::args().any(|a| a == "--wipe-local") {
        run_wipe_cli();
        return;
    }
    // 版本更新後首次啟動先清 WebView2 資產快取（在 webview 建立前），避免載到舊前端（ADR-0197）。
    clear_webview_cache_on_update();
    tauri::Builder::default()
        // 單一實體（ADR-0197）：第二次啟動 → 聚焦既有視窗、不開新程序。須最先註冊。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        // 桌面原生通知（ADR-0076）：可靠系統 toast、點擊 action 回跳；瀏覽器路徑另走 Web Notification。
        .plugin(tauri_plugin_notification::init())
        // 背景在線（Phase B ②）：關閉視窗＝隱藏到系統匣，保留 webview 存活＝引擎續連、
        // 仍收得到訊息；真正結束走系統匣選單「結束」。
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 關閉＝攔下，通知前端顯示 app 風格的確認框（縮到系統匣／直接結束，ADR-0198）；
                // 保持視窗可見以便顯示 in-app 對話框，後續由前端 invoke hide_to_tray / quit_app。
                api.prevent_close();
                let _ = window.emit("app://close-requested", ());
            }
            // 🔴 原生拖放的路徑要授權（修 ADR-0128 的漏網）。
            //
            // ADR-0128 的讀檔白名單只在**原生對話框**選檔時授權（`save_file`/`pick_existing_file`），
            // 其〈相關文件〉列了 0093/0102/0103 卻**漏掉 0104 的拖放**——於是拖檔進來送出時，
            // `read_saved_file` 一律回 None，**桌面版拖放傳檔實際上是死的**。
            //
            // 授權必須在 **Rust 端**做：這裡的 paths 來自作業系統的拖放事件，是貨真價實的
            // 使用者意圖。若改成讓前端 invoke 一個「授權這個路徑」的命令，等於把白名單的
            // 鑰匙交給 webview——那正是 ADR-0128 要防的 XSS 路徑。
            if let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                for p in paths {
                    authorize_path(window.app_handle(), &p.to_string_lossy());
                }
            }
        })
        .setup(|app| {
            // 標題列顯示版本——一眼確認執行中的 build 版本（診斷用；亦為透明）。
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title(&format!("Cinderous v{}", env!("CARGO_PKG_VERSION")));
            }
            // 系統匣圖示 + 選單（顯示 / 結束）。左鍵點圖示＝顯示視窗。
            let show = MenuItem::with_id(app, "show", "顯示 Cinderous", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "結束 Cinderous", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .tooltip("Cinderous")
                .icon(app.default_window_icon().cloned().expect("內建視窗圖示應存在"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // 註：這裡曾有一個 BridgeEvent 示範 emit（原生 ChatBackend 的殘留）——
            // 前端從未 listen 該通道，已隨 ADR-0105 一併移除。
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_ready,
            focus_window,
            key_set,
            key_get,
            key_delete,
            store_load,
            store_load_parts,
            store_save_part,
            store_remove_part,
            wipe_identity,
            wipe_store_dir,
            sync_identity_index,
            archive_append,
            archive_count,
            archive_load,
            archive_remove,
            store_save,
            pass_status,
            pass_enable,
            pass_unlock,
            pass_lock,
            pass_change,
            pass_rescue,
            pass_disable,
            ai_generate,
            ai_available,
            ai_models,
            ai_set_key,
            ai_has_key,
            save_file,
            inbox_begin,
            inbox_write,
            inbox_discard,
            save_from_inbox,
            inbox_sweep,
            read_saved_file,
            fs_stat,
            fs_list_dir,
            fs_read_range,
            fs_read_range_in,
            extract_copy,
            extract_finalize,
            fs_free_space,
            cf_token_url,
            cf_set_token,
            cf_has_token,
            cf_forget_token,
            cf_list_accounts,
            cf_deploy,
            cf_teardown,
            cf_verify_healthz,
            pick_existing_file,
            pick_folder,
            write_slot_file,
            append_slot_index,
            quit_app,
            hide_to_tray,
            now_playing_detect
        ])
        .run(tauri::generate_context!())
        .expect("執行 Tauri 應用程式時發生錯誤");
}
