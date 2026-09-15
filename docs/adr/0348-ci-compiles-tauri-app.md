# 0348. 讓 CI 真的編譯 `main.rs`（`tauri-app` feature）

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0119（`partfile.rs`：把函式搬離 `main.rs` 才測得到）、ADR-0235（供應鏈與 CI 硬閘）、ADR-0347（收檔串流落盤——Tauri 原生路徑因此卡住）

## 背景與問題

`apps/desktop/src-tauri/src/main.rs` 是 `required-features = ["tauri-app"]` 的 bin target。CI 的 Rust job 跑的是 `cargo test` 與 `cargo clippy --all-targets`，**兩者都不開那個 feature** ⇒ `main.rs` 從來沒有被 CI 編譯過。

這件事早在 ADR-0119 就被記下來了（`partfile.rs` 檔頭：「**`cargo test` 永遠不會編譯它**」），當時的處理是把純函式搬出去，讓它們至少測得到。但 `main.rs` 本身——所有 `#[tauri::command]`、原生對話框、金鑰庫橋接、通知——**連編譯都沒有**。

ADR-0347 因此卡住：收檔串流落盤的 Tauri 原生路徑需要新增 command，而在一個沒有任何地方驗證得到的檔案裡加程式碼，等於在賭。

## 決策

新增一個 CI job `tauri-app`：

```yaml
- 安裝系統相依: libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev
- cargo check --features tauri-app
- cargo clippy --all-targets --features tauri-app -- -D warnings
```

**為什麼要裝系統庫**：Tauri 的 webview 綁定（`webkit2gtk-sys`／`javascriptcore-rs-sys`）在 **build script** 階段就要 pkg-config 找得到，沒裝連 `cargo check` 都過不了。

🔴 **為什麼不是 `cargo test --features tauri-app`**：`tauri-app` 會把 `keyring` 一起開進來，而 `keyring` 的測試會存取**真實 OS 金鑰庫**，CI 容器裡必定失敗。Cargo.toml 早就註明「`keyring` 不入 default」正是這個理由。實測確認：`cargo test --features tauri-app` ⇒ **24 passed、1 failed**。所以這個 job 只做 check ＋ clippy。

**不加快取 action**：本 repo 規定 action 必須釘 commit SHA（ADR-0235 C5），而憑記憶寫一個 SHA 只會讓 CI 掛掉。要加請自行查出正確 SHA 再釘。

## 落地時的實測結果

- `cargo check --features tauri-app` ✅ **乾淨通過**。
- `cargo clippy --all-targets --features tauri-app -- -D warnings` ✅ **乾淨通過**。

也就是說：**`main.rs` 目前沒有壞**。這個結果有點反高潮，但它正是應該先跑一次再決定下一步的理由——在知道之前，「那裡可能藏著一堆錯」和「那裡好好的」是同一種不確定。

**這個 job 確實看得到 `main.rs`**（不是推測）：在 `main.rs` 塞一個型別錯誤後——不開 feature 的既有 job 回報 **0 個 error**，開 feature 的新 job 立刻報錯。

## 後果

- 正面：`main.rs` 從此會被編譯與 lint。ADR-0347 §後續行動 1（Tauri 原生落盤）的前置條件解除。
- 負面／已知殘餘風險：
  - 🔴 **編譯 ≠ 測試。** 住在 `main.rs` 裡的邏輯**仍然一行測試都沒有**，而且因為 keyring 的關係短期內也不會有。ADR-0119 的結論沒有被這個 ADR 取代：**要測就得搬進 lib**。新增的 command 應該只留薄殼在 `main.rs`，可測邏輯放 lib（比照 `partfile.rs`）。
  - **CI 時間變長**：相依樹比 lib-only 大一個量級（tauri＋reqwest＋rfd＋keyring…），冷編約數分鐘，且沒有快取。
  - **只在 Linux 上編譯**。`main.rs` 有 `#[cfg(windows)]` 的分支（ADR-0252 的 GSMTC「正在聽」偵測），那一段**仍然沒有任何地方編譯得到**。
  - 新的 apt 相依讓這個 job 依賴 Ubuntu runner 的套件庫；套件改名（例如 webkit2gtk 4.0→4.1 那次）會直接讓 job 紅。
- 後續行動／待辦：
  1. Windows 分支的編譯覆蓋（加一個 `windows-latest` 的 matrix，或至少 `cargo check --target x86_64-pc-windows-msvc`）。
  2. ADR-0347 §後續行動 1：Tauri 原生落盤 command（薄殼在 `main.rs`、邏輯在 lib），順帶修掉 `invoke("save_file", { bytes: Array.from(bytes) })` ——`Array.from` 把 `Uint8Array` 變成 JS number 陣列再 JSON 過 IPC，100 MiB 的檔約 800 MB。
