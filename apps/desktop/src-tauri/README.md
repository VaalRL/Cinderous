# cinder-desktop（Tauri 原生殼）

包住 `apps/desktop` 前端的 Tauri 2 桌面二進位，並提供原生服務所需的
IPC 資料契約與可測邏輯。

## 兩種角色

| 角色 | 內容 | 需要 |
| --- | --- | --- |
| **可測 lib**（預設） | `reconnect`（重連退避）、`ipc`（Rust⇄WebView DTO 契約） | 只需 Rust（`cargo test`） |
| **Tauri 二進位**（`tauri-app` feature） | `main.rs` 殼、視窗、`#[tauri::command]`、事件 emit | Tauri 工具鏈 + webkit2gtk 等系統庫 |

## 測試（不需 Tauri 工具鏈）

```bash
cargo test            # 只編譯與測試 lib（reconnect + ipc）
```

## 建置完整桌面 App（需 Tauri 環境）

先安裝系統相依（Linux 例）：`webkit2gtk-4.1`、`libsoup-3.0`、`librsvg2` 等，
以及 Tauri CLI（擇一）：

```bash
pnpm add -D @tauri-apps/cli          # 或： cargo install tauri-cli
```

然後於 repo 根目錄：

```bash
pnpm --filter @cinderous/desktop build            # 產出前端 dist/
pnpm --filter @cinderous/desktop exec tauri build  # 打包各平台安裝檔
# 開發： pnpm --filter @cinderous/desktop exec tauri dev
```

`tauri.conf.json` 的 `frontendDist` 指向 `../dist`，`devUrl` 指向 Vite 開發伺服器
（`http://localhost:5173`）。圖示產生見 `icons/README.md`。

## 現況與後續

- ✅ **B1 殼**：視窗、設定、圖示、build script、能力（capabilities）。
- ✅ **B2 契約**：`ipc.rs` 的 DTO（`SelfDto`/`ContactDto`/`MessageDto`/`BridgeEvent` …）
  與前端 `types.ts` 對齊，serde `camelCase`，已單元測試。
- ✅ **B3 背景長連線**：`session`（政策驅動器，7 單元測試）＋ `net`（tokio +
  tokio-tungstenite 執行期，`net` feature）。以本機 WS 伺服器即時整合測試：

  ```bash
  cargo test --features net    # 含 net::run 即時整合測試（連上→訂閱→收事件）
  ```

- ✅ **B4 原生持久化**：`storage::Store`（rusqlite）schema 對齊前端 `AppStorage`；
  `PRAGMA key` 支援 SQLCipher。

  ```bash
  cargo test --features persistence   # bundled SQLite（明碼，快速）
  cargo test --features sqlcipher     # 實際 SQLCipher 加密（含錯誤金鑰無法開啟）
  ```

  `persistence` 與 `sqlcipher` 互斥（rusqlite 後端二擇一）；正式版用 `sqlcipher`。

- ⏳ **GUI 接線 / B5–B6**：把 `net`/`storage` 經 `#[tauri::command]`/`emit` 橋到
  webview、前端切 `TauriChatBackend`；OS 金鑰庫（keyring）託管主金鑰、打包/更新
  ——於 Tauri 環境接續。
