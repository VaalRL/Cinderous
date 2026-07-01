# nostr-buddy-desktop（Tauri 原生殼）

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
pnpm --filter @nostr-buddy/desktop build            # 產出前端 dist/
pnpm --filter @nostr-buddy/desktop exec tauri build  # 打包各平台安裝檔
# 開發： pnpm --filter @nostr-buddy/desktop exec tauri dev
```

`tauri.conf.json` 的 `frontendDist` 指向 `../dist`，`devUrl` 指向 Vite 開發伺服器
（`http://localhost:5173`）。圖示產生見 `icons/README.md`。

## 現況與後續

- ✅ **B1 殼**：視窗、設定、圖示、build script、能力（capabilities）。
- ✅ **B2 契約**：`ipc.rs` 的 DTO（`SelfDto`/`ContactDto`/`MessageDto`/`BridgeEvent` …）
  與前端 `types.ts` 對齊，serde `camelCase`，已單元測試。
- ⏳ **B3–B6**：Rust 背景長連線（tokio + tungstenite，套用 `reconnect::Backoff`）、
  SQLCipher 持久化、OS 金鑰庫（keyring）、打包/更新——於 Tauri 環境接續。
