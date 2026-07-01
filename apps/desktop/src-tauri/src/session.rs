//! 背景長連線的「政策驅動器」（與 I/O 無關，便於單元測試）。
//!
//! [`Session`] 掌管：訂閱集合、離線期間的送出佇列、連線狀態與重連退避。
//! 它不做任何實際網路 I/O，而是回傳一串 [`Action`] 由執行期（`net` feature 的
//! tokio + tungstenite 執行緒）落實。如此「即使視窗關閉仍維持在線、斷線自動重連
//! 並重送訂閱」的核心邏輯可完整測試。

use std::collections::BTreeMap;
use std::time::Duration;

use crate::reconnect::{Backoff, ConnectionState};

/// 驅動器要求執行期採取的動作。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// 立即建立一條新連線。
    Connect,
    /// 等待指定時間後再連線（指數退避）。
    ScheduleReconnect(Duration),
    /// 送出一則 relay 協定訊框（如 `["REQ",...]` / `["EVENT",...]` / `["CLOSE",...]`）。
    Send(String),
}

/// 背景 relay 連線的政策狀態機。
#[derive(Debug, Clone)]
pub struct Session {
    state: ConnectionState,
    backoff: Backoff,
    /// subId → REQ 訊框；重連後全部重送（BTreeMap 讓順序穩定、便於測試）。
    subscriptions: BTreeMap<String, String>,
    /// 離線期間累積、待連上後補送的送出訊框。
    pending: Vec<String>,
}

impl Session {
    pub fn new(base: Duration, max: Duration) -> Self {
        Self {
            state: ConnectionState::Disconnected,
            backoff: Backoff::new(base, max),
            subscriptions: BTreeMap::new(),
            pending: Vec::new(),
        }
    }

    pub fn state(&self) -> ConnectionState {
        self.state
    }

    fn connected(&self) -> bool {
        self.state == ConnectionState::Connected
    }

    /// 啟動（或退避計時到期後）發起一次連線。
    pub fn start(&mut self) -> Vec<Action> {
        self.state = ConnectionState::Connecting;
        vec![Action::Connect]
    }

    /// 連線成功：重置退避、重送所有訂閱、補送離線期間累積的訊框。
    pub fn on_opened(&mut self) -> Vec<Action> {
        self.state = ConnectionState::Connected;
        self.backoff.reset();
        let mut actions: Vec<Action> = Vec::new();
        for frame in self.subscriptions.values() {
            actions.push(Action::Send(frame.clone()));
        }
        for frame in self.pending.drain(..) {
            actions.push(Action::Send(frame));
        }
        actions
    }

    /// 連線中斷：轉為離線並排定下一次重連（退避遞增）。
    pub fn on_closed(&mut self) -> Vec<Action> {
        self.state = ConnectionState::Disconnected;
        vec![Action::ScheduleReconnect(self.backoff.next_delay())]
    }

    /// 新增／更新一個訂閱。連線中即送出；否則保留，待重連時重送。
    pub fn subscribe(&mut self, sub_id: impl Into<String>, req_frame: impl Into<String>) -> Vec<Action> {
        let frame = req_frame.into();
        self.subscriptions.insert(sub_id.into(), frame.clone());
        if self.connected() {
            vec![Action::Send(frame)]
        } else {
            Vec::new()
        }
    }

    /// 取消一個訂閱。連線中送出 `["CLOSE", subId]`。
    pub fn unsubscribe(&mut self, sub_id: &str) -> Vec<Action> {
        let existed = self.subscriptions.remove(sub_id).is_some();
        if existed && self.connected() {
            vec![Action::Send(format!("[\"CLOSE\",{}]", json_string(sub_id)))]
        } else {
            Vec::new()
        }
    }

    /// 發佈一則訊框（如 `["EVENT",...]`）。連線中直送；否則排入佇列待補送。
    pub fn publish(&mut self, frame: impl Into<String>) -> Vec<Action> {
        let frame = frame.into();
        if self.connected() {
            vec![Action::Send(frame)]
        } else {
            self.pending.push(frame);
            Vec::new()
        }
    }
}

/// 極簡 JSON 字串轉義（僅供組 `CLOSE` 訊框的 subId）。
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sess() -> Session {
        Session::new(Duration::from_secs(1), Duration::from_secs(8))
    }

    #[test]
    fn start_moves_to_connecting_and_asks_to_connect() {
        let mut s = sess();
        assert_eq!(s.start(), vec![Action::Connect]);
        assert_eq!(s.state(), ConnectionState::Connecting);
    }

    #[test]
    fn publish_while_offline_queues_then_flushes_on_open() {
        let mut s = sess();
        assert_eq!(s.publish("[\"EVENT\",1]"), vec![]); // 離線：不送
        assert_eq!(s.publish("[\"EVENT\",2]"), vec![]);
        let actions = s.on_opened();
        assert_eq!(
            actions,
            vec![Action::Send("[\"EVENT\",1]".into()), Action::Send("[\"EVENT\",2]".into())]
        );
        // 佇列已清空：再開一次不應重送
        assert_eq!(s.on_opened(), vec![]);
    }

    #[test]
    fn subscribe_while_offline_is_resent_on_reconnect() {
        let mut s = sess();
        assert_eq!(s.subscribe("dm", "[\"REQ\",\"dm\",{}]"), vec![]);
        // 首次連上重送訂閱
        assert_eq!(s.on_opened(), vec![Action::Send("[\"REQ\",\"dm\",{}]".into())]);
        // 斷線後再連上，仍會重送（背景維持在線的關鍵）
        s.on_closed();
        assert_eq!(s.on_opened(), vec![Action::Send("[\"REQ\",\"dm\",{}]".into())]);
    }

    #[test]
    fn subscribe_while_connected_sends_immediately() {
        let mut s = sess();
        s.on_opened();
        assert_eq!(s.subscribe("p", "[\"REQ\",\"p\",{}]"), vec![Action::Send("[\"REQ\",\"p\",{}]".into())]);
    }

    #[test]
    fn reconnect_uses_exponential_backoff_then_resets_on_open() {
        let mut s = sess();
        s.start();
        assert_eq!(s.on_closed(), vec![Action::ScheduleReconnect(Duration::from_secs(1))]);
        assert_eq!(s.on_closed(), vec![Action::ScheduleReconnect(Duration::from_secs(2))]);
        assert_eq!(s.on_closed(), vec![Action::ScheduleReconnect(Duration::from_secs(4))]);
        // 連上後退避重置，下次斷線又從 base 起算
        s.on_opened();
        assert_eq!(s.on_closed(), vec![Action::ScheduleReconnect(Duration::from_secs(1))]);
    }

    #[test]
    fn unsubscribe_sends_close_only_when_connected_and_present() {
        let mut s = sess();
        s.subscribe("dm", "[\"REQ\",\"dm\",{}]");
        s.on_opened();
        assert_eq!(s.unsubscribe("dm"), vec![Action::Send("[\"CLOSE\",\"dm\"]".into())]);
        // 已移除：再取消不送
        assert_eq!(s.unsubscribe("dm"), vec![]);
        // 未知 subId 不送
        assert_eq!(s.unsubscribe("nope"), vec![]);
    }

    #[test]
    fn resubscribe_after_reconnect_does_not_resend_flushed_pending() {
        let mut s = sess();
        s.subscribe("dm", "[\"REQ\",\"dm\",{}]");
        s.publish("[\"EVENT\",1]");
        // 首次連上：先訂閱再補送佇列
        assert_eq!(
            s.on_opened(),
            vec![Action::Send("[\"REQ\",\"dm\",{}]".into()), Action::Send("[\"EVENT\",1]".into())]
        );
        // 斷線重連：只重送訂閱，佇列已清空不再重送
        s.on_closed();
        assert_eq!(s.on_opened(), vec![Action::Send("[\"REQ\",\"dm\",{}]".into())]);
    }
}
