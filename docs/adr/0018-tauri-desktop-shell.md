# 0018. Tauri 桌面殼與 IPC 契約（Phase B1/B2）

- 狀態：已接受
- 日期：2026-07-01
- 相關文件：docs/ROADMAP.md（Phase B）；ARCHITECTURE.md §7（M1–M5）；docs/adr/0016（前端重連）

## 背景與問題

要把已產品化的 `apps/desktop` 前端裝進原生桌面殼（Phase B1），並定義原生層與
WebView 之間的 IPC 契約（B2）。難點：本專案 CI／開發容器**沒有** Tauri 工具鏈
與 `webkit2gtk` 系統庫，無法編譯 Tauri GUI；但仍希望有可測、可提交、可在 Tauri
環境直接建置的成果，且不破壞既有的 `cargo test`。

## 決策

- **單一 crate、雙角色**：`apps/desktop/src-tauri` 同時是（1）與平台無關、可
  `cargo test` 的 **lib**（`reconnect` 重連退避、`ipc` 資料契約），以及（2）由
  **`tauri-app` feature** 啟用的 **Tauri 二進位**（`main.rs`）。Tauri／tokio／
  tauri-build 皆為 **optional dependency**，預設 `cargo test` 不編譯它們（不需
  webkit2gtk），只有 `--features tauri-app` 才拉進 GUI 相依。`[[bin]]` 以
  `required-features = ["tauri-app"]` 隔離。
- **近期架構（B1）**：Tauri webview 直接執行**既有前端**（React UI + TS
  `RelayChatBackend` + `packages/core`），透過 webview 內建的 WebSocket 連中繼——
  UI 與通訊邏輯**不需改動**即可打包成桌面 App。`tauri.conf.json` 的
  `frontendDist` 指向前端 `dist/`。
- **IPC 契約（B2）**：`ipc.rs` 以 serde `camelCase` 定義與前端 `types.ts` 對齊的
  DTO（`SelfDto`/`ContactDto`/`MessageDto`/`SignInArgs`/`BridgeEvent` …），並經
  單元測試鎖定欄位命名與可選欄位語意。此契約是**後續原生服務**（B3 背景長連線、
  B4 持久化、B5 金鑰庫）經 `#[tauri::command]`／`emit` 對接前端時的單一真實來源。

## 後果

- 正面：`cargo test`（10 測試）在無 Tauri 環境下持續綠燈；殼與契約可提交、可在
  具工具鏈的環境以 `--features tauri-app` 直接 `tauri build`。IPC 命名不一致的風險
  由 Rust 測試 + 前端 TS 型別雙側鎖定。前端零改動即可上桌面。
- 負面 / 未來：`Cargo.lock` 已解析完整 Tauri 相依樹（~420 套件，含 `wry`/
  `webkit2gtk-sys`）以利重現建置，但這些在本環境不編譯。GUI 二進位、實際視窗行為、
  打包產物**無法在此環境驗證**，須於 Tauri 環境確認。背景長連線（B3）將把 relay
  socket 移入 Rust（tokio + tungstenite，套用 `reconnect::Backoff`），屆時原生層改以
  `ipc` 契約 emit 事件、前端以對應 `TauriChatBackend` 接管（UI 不變），需另立細節 ADR。
