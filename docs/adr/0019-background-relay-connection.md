# 0019. 背景長連線：政策驅動器 + I/O 執行期（Phase B3）

- 狀態：**被取代 by [0105](./0105-retire-native-backend-dead-code.md)**（原生實作已退役）
  - 本 ADR 的 `net.rs`／`session.rs` 已刪除：它假設**單一** relay 連線，而引擎早已改為多中繼連線池（ADR-0034）。
  - 其功能目標「關窗仍在線」由 `main.rs` 的系統匣隱藏（webview 續存）達成；
    並經 [0106](./0106-webview-throttling-measurement.md) **實測確認心跳未被節流**（隱藏 412 秒，30s 心跳誤差 ±17ms）。
- 日期：2026-07-01
- 相關文件：docs/ROADMAP.md（Phase B3）；docs/adr/0016（前端重連）、docs/adr/0018（Tauri 殼）

## 背景與問題

桌面版要讓中繼站連線**與視窗生命週期脫鉤**——關閉視窗仍在線、斷線自動重連並
重送訂閱。挑戰：既要有可在無 GUI 環境驗證的核心邏輯，又要有實際的 async I/O，
且不破壞預設精簡的 `cargo test`。

## 決策

- **政策與 I/O 分離**：
  - `session::Session`（預設編譯、純邏輯）掌管**政策**：訂閱集合（重連後重送）、
    離線送出佇列（連上補送）、連線狀態、以既有 `reconnect::Backoff` 決定重連間隔。
    它不做 I/O，而是回傳一串 `Action`（`Connect` / `ScheduleReconnect(d)` / `Send`）。
    → 可用假時序完整單元測試（7 測試涵蓋佇列、重送、退避重置、CLOSE）。
  - `net::run`（`net` feature）為 **I/O 執行期**：tokio + tokio-tungstenite 持有背景
    連線，把 socket 事件餵給 `Session`、落實其 `Action`；以 `mpsc` 通道接受上層
    `Command`（Subscribe/Unsubscribe/Publish）、外送 `Incoming`（Frame/State）。
- **feature 隔離**：async I/O 相依（tokio-tungstenite、futures-util、rustls）置於
  `net` feature，預設 `cargo test` 不編譯，維持精簡快速；`net` 可**獨立於 GUI**
  建置測試（不需 webkit2gtk）。
- **背景持有**：連線由背景 tokio task 擁有，UI（webview）只透過通道互動；視窗關閉
  不影響連線存續，達成「關窗仍在線」。

## 後果

- 正面：B3 在本環境**完全可驗證**——政策 7 單元測試 + `net` feature 即時整合測試
  （本機 WS 伺服器驗證「連上→送訂閱→收事件→外送」），`cargo check --features net`
  亦通過。與 `reconnect::Backoff`（ADR-0016 同語意）一致，避免前後端重連策略分歧。
- 負面 / 未來：`net::run` 尚未接上 Tauri（B2 的 `#[tauri::command]`/`emit` 與
  `ipc::BridgeEvent`）——需在 Tauri 環境把 `Command`/`Incoming` 橋到 webview，並將
  前端切到對應 `TauriChatBackend`（UI 不變）。訊框解析（EVENT/EOSE/OK/NOTICE）目前
  原文外送、由上層處理；未加 ping/keepalive 與網路變更（睡眠/喚醒）偵測，列為後續。
  加密與 Gift Wrap 仍在前端 `packages/core`；是否將引擎下沉 Rust 為更大的獨立決策。
