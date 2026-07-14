//! Cinder 桌面原生服務（ADR-0105）。
//!
//! 這個 crate 的定位是**為 TypeScript 引擎提供原生能力**，而不是重新實作它：
//!   - `encstore`：加密儲存 blob（AES-256-GCM，ADR-0054）
//!   - `passlock`：本地密碼 KEK 包裹＋忘記密碼救援（Argon2id，ADR-0067/0073）
//!   - `keyvault`：OS 金鑰庫（ADR-0053）
//!   - `partfile`：部位檔的檔名白名單／原子寫入／毀損隔離（ADR-0119）
//!
//! 中繼站連線、Gift Wrap 加密、群組、WebRTC、狀態機等**一律留在 `packages/engine`（TS）**
//! ——那是單一真實來源。原本 Phase B3 的「原生背景連線＋原生 ChatBackend」（ADR-0019）
//! 與 B4 的「SQLite 持久化」（ADR-0020）已於 ADR-0105 退役：前者假設**單一** relay 連線，
//! 而引擎早已改為多中繼連線池（ADR-0034）；後者被加密 blob（ADR-0054）取代。
//! 「關窗仍在線」實際上是靠 `main.rs` 的系統匣隱藏（webview 續存）達成的。

#[cfg(feature = "encstore")]
pub mod encstore;
#[cfg(feature = "keyring")]
pub mod keyvault;
#[cfg(feature = "passlock")]
pub mod passlock;
// 部位檔的檔案安全原語（ADR-0119）：**無 feature 閘門**——只用 std，且是資料安全的關鍵。
pub mod partfile;
