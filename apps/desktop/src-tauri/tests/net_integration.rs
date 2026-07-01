//! B3 背景連線的即時整合測試：以本機 WebSocket 伺服器驗證
//! 「連上 → 送出訂閱 → 收到事件 → 外送給上層」整條迴圈。
//!
//! 僅在 `--features net` 下編譯與執行（預設 `cargo test` 不含）。

#![cfg(feature = "net")]

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use nostr_buddy_desktop::net::{run, Command, Incoming};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[tokio::test]
async fn subscribes_on_connect_and_forwards_incoming_event() {
    // 本機 WS 伺服器：收到第一則訊框（REQ）後回一則 EVENT。
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("ws://{addr}");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = accept_async(stream).await.unwrap();
        let first = ws.next().await.unwrap().unwrap();
        let text = first.to_text().unwrap().to_string();
        assert!(text.contains("REQ"), "伺服器應先收到訂閱 REQ，實得：{text}");
        ws.send(Message::Text("[\"EVENT\",\"s1\",{}]".to_string().into()))
            .await
            .unwrap();
        // 保持連線直到測試結束
        let _ = ws.next().await;
    });

    let (cmd_tx, cmd_rx) = mpsc::channel::<Command>(8);
    let (evt_tx, mut evt_rx) = mpsc::channel::<Incoming>(8);
    let client = tokio::spawn(run(url, cmd_rx, evt_tx));

    cmd_tx
        .send(Command::Subscribe {
            sub_id: "s1".to_string(),
            req_frame: "[\"REQ\",\"s1\",{}]".to_string(),
        })
        .await
        .unwrap();

    // 應收到伺服器回送的 EVENT 訊框（略過 State 狀態事件）。
    let got = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match evt_rx.recv().await {
                Some(Incoming::Frame(f)) => return f,
                Some(Incoming::State(_)) => continue,
                None => panic!("事件通道提前關閉"),
            }
        }
    })
    .await
    .expect("等待 EVENT 逾時");

    assert!(got.contains("EVENT"), "應外送收到的 EVENT 訊框，實得：{got}");

    drop(cmd_tx); // 關閉指令通道 → run 收工
    let _ = tokio::time::timeout(Duration::from_secs(2), client).await;
    server.abort();
}
