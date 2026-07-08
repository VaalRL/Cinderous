//! Cinder 桌面原生橋的可測邏輯。
//!
//! 目前提供與平台無關的 relay 重連退避；完整 Tauri 整合（背景 WebSocket
//! 長連線、OS 金鑰安全儲存、IPC）將在具 Tauri 工具鏈的環境擴充。

#[cfg(feature = "encstore")]
pub mod encstore;
pub mod ipc;
#[cfg(feature = "keyring")]
pub mod keyvault;
#[cfg(feature = "net")]
pub mod net;
pub mod reconnect;
pub mod session;
#[cfg(any(feature = "persistence", feature = "sqlcipher"))]
pub mod storage;

pub use reconnect::{Backoff, ConnectionState};
pub use session::{Action, Session};
