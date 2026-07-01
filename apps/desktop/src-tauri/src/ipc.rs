//! Rust ⇄ WebView 之間的 IPC 資料契約（DTO）。
//!
//! 這些型別對應前端 `apps/desktop/src/backend/types.ts` 的 `ChatBackend` 介面，
//! 以 serde `camelCase` 序列化，讓 Tauri `invoke`/`emit` 兩端欄位一致。
//! 本模組與平台無關、可單元測試；實際的 `#[tauri::command]` 綁定在 `main.rs`
//! （需 `tauri-app` feature 與 Tauri 工具鏈）。

use serde::{Deserialize, Serialize};

/// 使用者可見狀態（對應前端 `Status`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Online,
    Away,
    Busy,
    Offline,
}

/// 與中繼站的連線狀態（對應前端 `ConnectionState`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Connecting,
    Online,
    Offline,
}

/// 自己的身分與狀態。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfDto {
    pub pubkey: String,
    pub name: String,
    pub status: Status,
    pub status_message: String,
}

/// 一位聯絡人。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactDto {
    pub pubkey: String,
    pub name: String,
    pub status: Status,
    pub status_message: String,
    pub now_playing: String,
}

/// 一則對話訊息（`expires_at` 僅限時訊息才有）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDto {
    pub id: String,
    pub outgoing: bool,
    pub text: String,
    pub at: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expires_at: Option<i64>,
}

// ── invoke 參數（前端 → Rust） ──────────────────────────────────────────────

/// 登入：顯示名稱 + 中繼站網址（空字串為示範模式）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInArgs {
    pub name: String,
    pub relay_url: String,
}

/// 送訊：對象、內容、可選限時秒數。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageArgs {
    pub to: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ttl_seconds: Option<u32>,
}

/// 設定狀態。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetStatusArgs {
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub message: Option<String>,
}

// ── emit 事件（Rust → 前端） ────────────────────────────────────────────────

/// 從原生層推送給 WebView 的事件（對應 `ChatBackendEvents`）。
/// 以 `type` 標籤區分，`payload` 承載資料，前端 `listen` 後分派。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BridgeEvent {
    Contacts { contacts: Vec<ContactDto> },
    Message { contact: String, message: MessageDto },
    Typing { contact: String },
    Nudge { contact: String },
    Connection { state: ConnectionState },
}

/// Tauri 事件名稱（單一事件通道，payload 為 [`BridgeEvent`]）。
pub const EVENT_CHANNEL: &str = "nb://event";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Status::Online).unwrap(), "\"online\"");
        assert_eq!(serde_json::to_string(&Status::Offline).unwrap(), "\"offline\"");
    }

    #[test]
    fn message_uses_camel_case_and_omits_absent_expiry() {
        let m = MessageDto {
            id: "e1".into(),
            outgoing: true,
            text: "hi".into(),
            at: 1700,
            expires_at: None,
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(!json.contains("expiresAt"), "缺 TTL 時不應出現欄位: {json}");
        let back: MessageDto = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn message_includes_expiry_when_present() {
        let m = MessageDto {
            id: "e2".into(),
            outgoing: false,
            text: "bye".into(),
            at: 1701,
            expires_at: Some(1800),
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"expiresAt\":1800"), "應含 camelCase 到期欄位: {json}");
    }

    #[test]
    fn contact_and_self_use_camel_case() {
        let c = ContactDto {
            pubkey: "ab".into(),
            name: "Bob".into(),
            status: Status::Away,
            status_message: "brb".into(),
            now_playing: "song".into(),
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"statusMessage\":\"brb\""));
        assert!(json.contains("\"nowPlaying\":\"song\""));
        let back: ContactDto = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn send_message_args_round_trip_with_optional_ttl() {
        let a = SendMessageArgs { to: "p".into(), text: "yo".into(), ttl_seconds: Some(60) };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"ttlSeconds\":60"));
        assert_eq!(serde_json::from_str::<SendMessageArgs>(&json).unwrap(), a);

        let b = SendMessageArgs { to: "p".into(), text: "yo".into(), ttl_seconds: None };
        let json = serde_json::to_string(&b).unwrap();
        assert!(!json.contains("ttlSeconds"));
    }

    #[test]
    fn bridge_event_is_tagged() {
        let e = BridgeEvent::Connection { state: ConnectionState::Online };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"type\":\"connection\""));
        assert!(json.contains("\"state\":\"online\""));
        let back: BridgeEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(e, back);
    }
}
