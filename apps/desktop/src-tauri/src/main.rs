// Windows release 版隱藏主控台視窗。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Nostr Buddy 桌面 Tauri 二進位（B1 殼）。
//!
//! 目前包住 `apps/desktop` 前端（於 webview 執行既有 React UI + RelayChatBackend）。
//! 原生服務（背景長連線 B3、SQLCipher 持久化 B4、OS 金鑰庫 B5）將以 `ipc` 契約
//! 逐步經 `#[tauri::command]` / `emit` 接上；此檔先提供最小可執行殼與橋接示範。
//!
//! 需以 `--features tauri-app` 在具 Tauri 工具鏈與 webkit2gtk 的環境建置。

use nostr_buddy_desktop::ipc::{BridgeEvent, ConnectionState, EVENT_CHANNEL};
use tauri::{Emitter, Manager};

/// 橋接健康檢查：供前端確認原生層就緒（B2 IPC 契約的首個 command）。
#[tauri::command]
fn native_ready() -> String {
    format!("nostr-buddy native bridge {}", env!("CARGO_PKG_VERSION"))
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
        .invoke_handler(tauri::generate_handler![native_ready])
        .run(tauri::generate_context!())
        .expect("執行 Tauri 應用程式時發生錯誤");
}
