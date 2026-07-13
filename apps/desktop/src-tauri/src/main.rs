// Windows release 版隱藏主控台視窗。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Cinder 桌面 Tauri 二進位（B1 殼）。
//!
//! 目前包住 `apps/desktop` 前端（於 webview 執行既有 React UI + RelayChatBackend）。
//! 原生服務（背景長連線 B3、SQLCipher 持久化 B4、OS 金鑰庫 B5）將以 `ipc` 契約
//! 逐步經 `#[tauri::command]` / `emit` 接上；此檔先提供最小可執行殼與橋接示範。
//!
//! 需以 `--features tauri-app` 在具 Tauri 工具鏈與 webkit2gtk 的環境建置。

use cinder_desktop::encstore;
use cinder_desktop::ipc::{BridgeEvent, ConnectionState, EVENT_CHANNEL};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

/// 顯示並聚焦主視窗（系統匣點擊/選單用）。
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
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
#[tauri::command]
fn key_set(pubkey: String, nsec: String) -> Result<(), String> {
    cinder_desktop::keyvault::set_key(&pubkey, &nsec).map_err(|e| e.to_string())
}

/// 取出某身分的 nsec；不存在回 `None`。
#[tauri::command]
fn key_get(pubkey: String) -> Result<Option<String>, String> {
    cinder_desktop::keyvault::get_key(&pubkey).map_err(|e| e.to_string())
}

/// 刪除某身分的 nsec（登出/移除身分）。
#[tauri::command]
fn key_delete(pubkey: String) -> Result<(), String> {
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

/// 加密並寫入某命名空間的狀態快照（JSON）。
#[tauri::command]
fn store_save(app: tauri::AppHandle, namespace: String, json: String) -> Result<(), String> {
    let path = store_path(&app, &namespace)?;
    let key = db_key(&namespace)?;
    let ciphertext = encstore::encrypt(&key, json.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(&path, ciphertext).map_err(|e| e.to_string())
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

/// 線上 provider 的 API key（存 OS 金鑰庫，account `ai:<provider>`；ADR-0062）。
fn api_key(provider: &str) -> Option<String> {
    cinder_desktop::keyvault::get_key(&format!("ai:{provider}")).ok().flatten()
}

/// 存某 provider 的 API key 到金鑰庫（不落 JS/localStorage）。
#[tauri::command]
fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    cinder_desktop::keyvault::set_key(&format!("ai:{provider}"), &key).map_err(|e| e.to_string())
}

/// 某 provider 是否已設 API key。
#[tauri::command]
fn ai_has_key(provider: String) -> bool {
    api_key(&provider).is_some()
}

/// 生成（改寫/摘要）。ollama → /api/generate；openai → /v1/chat/completions（Bearer key）。
#[tauri::command]
async fn ai_generate(provider: String, endpoint: String, model: String, prompt: String) -> Result<String, String> {
    check_endpoint(&endpoint)?;
    if provider == "openai" {
        let key = api_key("openai").ok_or("未設定 OpenAI API key")?;
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
        return api_key("openai").is_some();
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
        ("/v1/models", "data", "id", api_key("openai"))
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

/// 收檔另存：開原生「另存新檔」對話框讓使用者選位置並寫入位元組；取消回 `None`。
/// 回傳使用者選定的路徑供 UI 顯示。位元組由前端經 IPC 傳入（收自 P2P，不落 App 儲存）。
#[tauri::command]
fn save_file(name: String, bytes: Vec<u8>) -> Result<Option<String>, String> {
    match rfd::FileDialog::new().set_file_name(&name).save_file() {
        Some(path) => {
            std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

fn main() {
    tauri::Builder::default()
        // 桌面原生通知（ADR-0076）：可靠系統 toast、點擊 action 回跳；瀏覽器路徑另走 Web Notification。
        .plugin(tauri_plugin_notification::init())
        // 背景在線（Phase B ②）：關閉視窗＝隱藏到系統匣，保留 webview 存活＝引擎續連、
        // 仍收得到訊息；真正結束走系統匣選單「結束」。
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            // 系統匣圖示 + 選單（顯示 / 結束）。左鍵點圖示＝顯示視窗。
            let show = MenuItem::with_id(app, "show", "顯示 Cinder", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "結束 Cinder", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .tooltip("Cinder")
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

            // 啟動時向 webview 廣播一次連線狀態（示範單一事件通道；
            // 之後由原生 relay 引擎於狀態變化時持續 emit）。
            let handle = app.handle().clone();
            handle.emit(
                EVENT_CHANNEL,
                BridgeEvent::Connection { state: ConnectionState::Connecting },
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_ready,
            focus_window,
            key_set,
            key_get,
            key_delete,
            store_load,
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
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("執行 Tauri 應用程式時發生錯誤");
}
