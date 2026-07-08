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
use tauri::{Emitter, Manager};

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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
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
            store_save
        ])
        .run(tauri::generate_context!())
        .expect("執行 Tauri 應用程式時發生錯誤");
}
