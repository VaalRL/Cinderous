# 0053. Tauri 原生整合：基質替換（重用 TS 引擎）＋ B5 金鑰庫

- 狀態：已接受
- 日期：2026-07-07
- 相關文件：ROADMAP Phase B（B2/B5）；docs/adr/0018（Tauri 殼）、0019（背景長連線）、0020（原生持久化 SQLCipher）、0045（多身分）；PRD §3（靜態落地加密）、§4（私鑰不離裝置）
- 精化：ADR-0018/0019/0020 的 Tauri 整合方式；修正 `ipc.rs` 原「Rust 自建 backend」方向

## 背景與問題

B1（ADR-0018）讓 Tauri 殼可建可跑，但原生視窗目前仍跑**瀏覽器版前端**（`localStorage` + 瀏覽器 `WebSocket`），未用到原生能力。B2/B5 要讓 App 真正取得：加密落地（SQLCipher）、OS 金鑰庫、背景長連線。

`ipc.rs` 現有契約（`SignInArgs`/`SendMessageArgs`/`BridgeEvent`）反映「**Rust 端自建 backend**」的想法。但 Cinder 的**整個通訊引擎**（Nostr 事件、NIP-44、Gift Wrap、群組、通話、貼圖、@提及、對話串、企業…全部 M1–M9）都在 **TS `@cinder/core`**。在 Rust 重做一份＝違反 SSOT、需維護兩套加密、稽核面加倍。

## 考量的選項

- **選項 A（否決）：Rust 重host 引擎。** 依 `ipc.rs` 原方向，把 backend 邏輯搬到 Rust。需在 Rust 重寫 Nostr/加密/群組/通話…全部，與 TS core 雙重 SSOT，工程與稽核成本極高。
- **選項 B（採用）：基質替換（substrate swap）。** webview 繼續跑既有 TS 引擎（`RelayChatBackend` + `@cinder/core`，零重寫），native 僅以 IPC adapter 接管三個「基質」：金鑰庫、加密儲存、背景連線。此為 web 技術前端的標準 Tauri 做法。

## 決策

**採選項 B。native 經 IPC 提供三個基質，前端偵測 Tauri 環境時以 adapter 替換瀏覽器版：**

1. **金鑰庫（B5，本 ADR 首個增量）：** 私鑰 `nsec` 存 OS 安全儲存（Windows Credential Manager / macOS Keychain / Linux Secret Service），**不再明文落地** localStorage/SQLite。Rust `keyvault` 模組（`keyring` crate，`keyring` feature）以 `SERVICE="app.cinder.desktop"` + **pubkey 為帳號**（支援多身分 ADR-0045）提供 set/get/delete；經 `#[tauri::command]` `key_set/key_get/key_delete` 暴露。
2. **加密儲存：** `AppStorage` 由 Rust `storage::Store`（SQLCipher，B4/ADR-0020 已備）經 IPC 承載，取代 `localStorage`。
3. **背景長連線：** WebSocket 由 Rust `session`/`net`（B3/ADR-0019 已備）持有，關窗/隱藏仍在線；前端以 `TauriConnector`（比照 `webSocketConnector` 介面）經 IPC 收送。

**引擎仍是 TS core（SSOT 不變）**；native 只換「資料落哪、金鑰放哪、socket 誰持有」。`ipc.rs` 原高階 DTO（`SignInArgs`/`BridgeEvent` 等）不再是整合主軸，後續改為基質層級的 IPC 契約（保留或移除另評）。

### async/sync 界面摩擦

`AppStorage` 為同步介面（localStorage 同步），IPC `invoke` 為非同步。逐基質處理：金鑰於啟動時一次 async 載入後交給引擎；儲存基質改造時再定 async 化策略（該增量的 ADR 補充）。B5 金鑰以**獨立的 async KeyVault 抽象**承載，不污染同步的 `AppStorage`。

## 理由

- **SSOT 乾淨、零功能重寫：** 全部 M1–M9／企業功能沿用 TS core；native 只補瀏覽器缺的三項能力。
- **重用既有 Rust 核心：** B3/B4 的 `session`/`net`/`storage` 已寫好且測過，缺的是 IPC 接線與前端 adapter。
- **符合 PRD §3/§4：** 私鑰入 OS 安全儲存、資料庫 SQLCipher 加密落地，達成「私鑰不明文落地、不離裝置」。
- **漸進可驗：** 三基質可獨立增量交付；金鑰庫最小、最安全價值明確，作為首刀並打通 IPC 管路。

## 後果

- 正面：原生 App 取得加密落地/金鑰庫/背景在線，且不動引擎；瀏覽器版與原生版共用同一 TS 引擎。
- 負面 / 已知限制：
  - `AppStorage` 同步 vs IPC 非同步的界面摩擦——逐基質解，非一次到位。
  - 金鑰庫測試（`cargo test --features keyring`）會存取**真實 OS 金鑰庫**（以專用測試帳號 + 測後清除隔離）。
  - Linux 需 Secret Service（libsecret/keyring daemon）在場；無頭環境金鑰庫可能不可用（部署文件註明）。
  - `ipc.rs` 原 DTO 方向被本 ADR 取代方向，實際清理待儲存/連線增量。
- 後續行動：
  1. **B5-Rust（本增量）：** `keyvault` 模組 + `keyring` feature + cargo 測試；main.rs `key_*` IPC 命令。
  2. **B5-前端：** async `KeyVault` 抽象 + Tauri 偵測；`nsec` 存取改走 keyring，`AppStorage` 不再存私鑰。
  3. **儲存基質：** `TauriStorage`（IPC → `storage::Store` SQLCipher）+ async 化策略。
  4. **連線基質：** `TauriConnector`（IPC → `session`/`net`）+ 背景在線。
