# 0105. 退役原生後端的死碼（ADR-0019 背景連線、ADR-0020 SQLite），並讓 `cargo test` 真的測到出貨的密碼學

- 狀態：已接受（已實作）
- 日期：2026-07-14
- 相關文件：ADR-0019（背景長連線 B3）、0020（原生持久化 SQLite/SQLCipher B4）、
  0034（多中繼路由）、0054（加密儲存基質）、0018（Tauri 殼）；`apps/desktop/src-tauri/`

## 背景與問題

盤點待辦時，0019 與 0020 都被記為「寫了但沒接線」。實際查證後，發現的東西比「沒接線」嚴重得多。

### 1. ADR-0019 的 `net.rs` 不只是沒接線——它**結構上已經服務不了現在的架構**

`net::run(url, commands, events)` 是**單一連線**的 WebSocket 執行期。但引擎早已改為**多中繼連線池**
（ADR-0034/0036/0039）：`relayPool = Map<url, RelayClient>` ＋ 錨點 ＋ 聯絡人 relay hint，
桌面同時維持**多條**連線。`net.rs` 的形狀（單一 url）根本套不上去。

### 2. ADR-0019 的功能目標**早就用別的方式達成了**

它要的是「關閉視窗仍在線」。而 `main.rs` 的系統匣做法——`window.hide()` ＋ `api.prevent_close()`
——讓 **webview 續存**，於是 JS 引擎持有的 WebSocket 也續存。**目標已達成，只是不是靠 `net.rs`。**

而且把 socket 搬到 Rust **也省不了資源**：金鑰、Gift Wrap 加密、群組、儲存、狀態機全在 TS 引擎，
webview 無論如何都得活著。要真正做到「原生背景代理」，得把**整個引擎**下沉 Rust——那是對一套
已高度測試的 TS 引擎做大規模重複實作，違反 SSOT。ADR-0019 自己也寫了：
「是否將引擎下沉 Rust 為**更大的獨立決策**」——那個決策從未被做。

### 3. `ipc.rs` 是「原生 ChatBackend」的契約——而**前端從未 listen 那個通道**

`ipc.rs` 定義了 `SignInArgs`／`SendMessageArgs`／`BridgeEvent`（原生後端的 DTO），`main.rs` 啟動時
還 emit 一個 `BridgeEvent::Connection` 示範。但 `grep` 全前端：**沒有任何 `listen("nb://event")`**。
那個 emit 是對著空氣喊的。

### 4. 最糟的一點：**CI 的 17 個 Rust 綠燈，全部在測死碼**

`cargo test`（預設 features）只編譯 `ipc` / `reconnect` / `session` —— **三者皆從未出貨**
（`net` 不在 `tauri-app` feature 裡、`ipc` 無人 listen）。

而真正會出貨的 `encstore`（AES-256-GCM 加密儲存）與 `passlock`（Argon2id 本地密碼＋忘記密碼救援）
是 feature-gated 的 → **預設不編譯 → 它們的 13 個測試從來沒有跑過一次。**

也就是說：**CI 一直在為死碼發綠燈，而真正保護使用者資料的密碼學零覆蓋。**

## 考量的選項

- **A. 把 `net.rs` 改寫成多連線管理器並接上 Tauri**：可行，但買不到東西——webview 仍須存活，
  資源沒省；等於多維護一條平行傳輸層與一整套 IPC 面。**不採**。
- **B. 把整個引擎下沉 Rust**：能真正做到原生背景代理，但要重複實作一套已高度測試的 TS 引擎，
  嚴重違反 SSOT／Fix-First。若日後真有需求，應另立專屬 ADR 從長計議。**本次不採**。
- **C（採用）. 承認原生後端的方向已被架構取代，退役死碼**，並把 `cargo test` 導向真正出貨的模組。

## 決策

### 1. 刪除死碼

- `net.rs`（單連線 WS 執行期）、`session.rs`＋`reconnect.rs`（**只**被 net.rs 使用）、
  `ipc.rs`（原生 ChatBackend 的 DTO，無人 listen）、`storage.rs`（SQLite，從未建置，已被 ADR-0054 取代）
- `main.rs` 中那個對著空氣喊的 `BridgeEvent` emit
- Cargo：移除 `net` / `persistence` / `sqlcipher` features，以及 `rusqlite` / `tokio-tungstenite` /
  `futures-util` / `tokio` 依賴（`tokio` 除 net.rs 外**無任何直接使用**）。`Cargo.lock` 少 195 行。

### 2. `default = ["passlock"]`（含 `encstore`）

讓 `cargo test` **預設就編譯並測試會出貨的密碼學**。`keyring` **不入 default**——它的測試會存取
**真實 OS 金鑰庫**，在 CI 容器裡不可用。

### 3. crate 定位寫進 `lib.rs`

這個 crate 的職責是**為 TS 引擎提供原生能力**（加密儲存、本地密碼、OS 金鑰庫、原生對話框），
**而不是重新實作它**。中繼連線、加密、群組、WebRTC 一律留在 `packages/engine`。

## 理由

- 留著一份「結構上無法接上、目標已由他法達成」的原生後端，只是**持續產生假訊號**
  （CI 綠燈、待辦清單上的幽靈項目），並讓後來的人以為那是還沒完成的功能。
- 把 `default` 指向出貨模組，是**把 13 個真測試從「從未執行」變成「每次 CI 都跑」**——
  這比新增任何測試都划算。

## 後果

- 正面：
  - Rust 端只剩**真正出貨的東西**；`cargo test` 從「17 個死碼假綠燈」變成「**13 個真・密碼學測試**」
    （加密儲存往返/竄改/錯鑰、Argon2id 包裹/錯密碼/竄改/救援/KDF 參數上限…）。
  - 依賴瘦身（`Cargo.lock` −195 行）：不再拉 tokio-tungstenite / futures-util / rusqlite。
  - ADR-0019/0020 這兩個「幽靈待辦」正式結案。
- 負面 / 已知殘餘風險：
  - **「原生背景代理」的能力就此明確放棄**（不是延後，是承認現行架構不走這條）。
    若日後要做（例如為了讓 webview 可被完全暫停），需**另立 ADR**、且勢必要處理「引擎下沉 Rust」
    這個大題目。
  - 現行「關窗仍在線」靠 **webview 續存**——資源占用（~100–200MB）是這個選擇的代價。
    另外**隱藏視窗是否會被 OS/WebView2 節流**（進而影響 30s 心跳）**未經實機驗證**，記於此備查。
  - `native_ready` 命令仍在（前端未用），保留作為橋接健康檢查的診斷入口。
- 測試：Rust `cargo test` 13 passed（過去 0——這些測試從未被編譯）；
  `cargo check --features tauri-app` 通過；JS 全 792 測試通過、typecheck 通過。
