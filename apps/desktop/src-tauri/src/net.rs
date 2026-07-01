//! 背景 WebSocket 連線執行期：把 [`Session`](crate::session::Session) 政策接上
//! 真實中繼站（tokio + tokio-tungstenite）。需 `net` feature 與 async 執行環境。
//!
//! 這條連線由背景 tokio task 持有，**與視窗生命週期無關**——視窗關閉後仍維持在線、
//! 斷線自動重連並重送訂閱（政策由 [`Session`] 決定，本模組只負責 I/O 落實）。
//!
//! 註：本模組需 `--features net` 才編譯；預設 `cargo test` 不含之，故其正確性以
//! 檢視與整合環境為準。

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::session::{Action, Session};

const BACKOFF_BASE: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);

/// 應用層（Tauri 命令）對背景連線發出的指令。
#[derive(Debug, Clone)]
pub enum Command {
    Subscribe { sub_id: String, req_frame: String },
    Unsubscribe { sub_id: String },
    Publish { frame: String },
}

/// 背景連線送回應用層的事件。
#[derive(Debug, Clone)]
pub enum Incoming {
    /// 收到的 relay 協定訊框（原文，交由上層解析 EVENT/EOSE/OK…）。
    Frame(String),
    /// 連線狀態變化（供 UI 顯示連線/重連中）。
    State(crate::reconnect::ConnectionState),
}

/// 持續維持與 `url` 的連線，直到 `commands` 通道關閉才結束。
///
/// - `commands`：訂閱／取消／發佈指令來源。
/// - `events`：外送收到的訊框與連線狀態。
pub async fn run(url: String, mut commands: mpsc::Receiver<Command>, events: mpsc::Sender<Incoming>) {
    let mut session = Session::new(BACKOFF_BASE, BACKOFF_MAX);

    loop {
        let _ = session.start();
        let _ = events.send(Incoming::State(session.state())).await;

        let stream = match connect_async(&url).await {
            Ok((stream, _)) => stream,
            Err(_) => {
                if !backoff_then_continue(&mut session, &events).await {
                    return;
                }
                continue;
            }
        };

        let (mut write, mut read) = stream.split();
        // 連上：重送訂閱、補送離線佇列。
        for action in session.on_opened() {
            if let Action::Send(frame) = action {
                if write.send(Message::Text(frame.into())).await.is_err() {
                    break;
                }
            }
        }
        let _ = events.send(Incoming::State(session.state())).await;

        // 主迴圈：同時處理應用指令與 socket 訊息。
        let reconnect = loop {
            tokio::select! {
                cmd = commands.recv() => {
                    let Some(cmd) = cmd else { return; }; // 通道關閉 → 收工
                    let actions = match cmd {
                        Command::Subscribe { sub_id, req_frame } => session.subscribe(sub_id, req_frame),
                        Command::Unsubscribe { sub_id } => session.unsubscribe(&sub_id),
                        Command::Publish { frame } => session.publish(frame),
                    };
                    for action in actions {
                        if let Action::Send(frame) = action {
                            if write.send(Message::Text(frame.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            let _ = events.send(Incoming::Frame(text.to_string())).await;
                        }
                        Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                        // 關閉、錯誤或串流結束 → 重連
                        _ => break true,
                    }
                }
            }
        };

        if reconnect {
            if !backoff_then_continue(&mut session, &events).await {
                return;
            }
        }
    }
}

/// 依 [`Session`] 的退避排定等待後回傳是否應繼續重連。
async fn backoff_then_continue(session: &mut Session, events: &mpsc::Sender<Incoming>) -> bool {
    let mut delay = Duration::ZERO;
    for action in session.on_closed() {
        if let Action::ScheduleReconnect(d) = action {
            delay = d;
        }
    }
    if events.send(Incoming::State(session.state())).await.is_err() {
        return false;
    }
    tokio::time::sleep(delay).await;
    true
}
