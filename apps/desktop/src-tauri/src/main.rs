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

/// 取得或建立某命名空間的 DB 金鑰（存 OS 金鑰庫，account `db:<namespace>`）。
fn db_key(namespace: &str) -> Result<[u8; encstore::KEY_LEN], String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let account = format!("db:{namespace}");
    match cinder_desktop::keyvault::get_key(&account).map_err(|e| e.to_string())? {
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

// ── Ollama 本機 AI 改寫 IPC（ADR-0060）：webview → Rust reqwest → 本機 Ollama（無 CORS）──

fn ollama_url(endpoint: &str, path: &str) -> String {
    format!("{}{}", endpoint.trim_end_matches('/'), path)
}

/// 請本機 Ollama 生成（改寫用）；回傳純文字結果。
#[tauri::command]
async fn ollama_generate(endpoint: String, model: String, prompt: String) -> Result<String, String> {
    let body = serde_json::json!({ "model": model, "prompt": prompt, "stream": false });
    let resp = reqwest::Client::new()
        .post(ollama_url(&endpoint, "/api/generate"))
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

/// 偵測本機 Ollama 是否可用（GET /api/tags）。
#[tauri::command]
async fn ollama_available(endpoint: String) -> bool {
    matches!(
        reqwest::Client::new().get(ollama_url(&endpoint, "/api/tags")).send().await,
        Ok(r) if r.status().is_success()
    )
}

/// 列出本機已安裝的模型名稱（GET /api/tags）。
#[tauri::command]
async fn ollama_models(endpoint: String) -> Result<Vec<String>, String> {
    let resp = reqwest::Client::new()
        .get(ollama_url(&endpoint, "/api/tags"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("ollama {}", resp.status()));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let names = data
        .get("models")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Ok(names)
}

fn main() {
    tauri::Builder::default()
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
            key_set,
            key_get,
            key_delete,
            store_load,
            store_save,
            ollama_generate,
            ollama_available,
            ollama_models
        ])
        .run(tauri::generate_context!())
        .expect("執行 Tauri 應用程式時發生錯誤");
}
