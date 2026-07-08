# 0054. 加密儲存基質：AES-256-GCM 加密 blob（純 Rust，免 SQLCipher/Perl）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：ADR-0053（Tauri 基質替換）、0020（原生持久化 SQLite/SQLCipher）、0045（多身分命名空間）；PRD §3（靜態落地加密）
- 精化：ADR-0020 的 SQLCipher 選擇——於「桌面實際儲存基質」改採純 Rust AES-GCM（理由見下）

## 背景與問題

ADR-0053 基質替換要把訊息庫從 WebView2 的 localStorage（**明文落地**）換成**加密落地**（PRD §3）。ADR-0020 原選 SQLCipher，但其 `bundled-sqlcipher-vendored-openssl` 需 **Perl 編譯 OpenSSL**，而目標開發機**無 Perl**（`cargo test --features sqlcipher` 實測卡在此）。需一條在現機即可實作、且達成靜態加密的路。

## 考量的選項

- **選項 A（採用）：AES-256-GCM 加密 blob（純 Rust）。** 以 `aes-gcm` crate（RustCrypto，純 Rust、免 OpenSSL/Perl）將前端整包狀態快照加密，金鑰存 OS 金鑰庫（keyring，複用 B5/ADR-0053），密文寫入 app 資料夾檔案。
- **選項 B（否決於此環境）：SQLCipher（ADR-0020 原案）。** 需 Perl 建 vendored OpenSSL，現機不可用；保留為「有 Perl 環境時」的替代路徑（granular schema、B4 已備）。
- **選項 C（否決）：未加密 bundled SQLite。** 免 Perl 但**未加密**，安全上不優於現況 localStorage，未達 PRD §3。

## 決策

**採選項 A。桌面加密儲存以 AES-256-GCM 加密 blob 實作：**

1. **加密原語（Rust `encstore`，`encstore` feature）：** `aes-gcm`（AES-256-GCM）。`generate_key()`（32 bytes）、`encrypt(key, plaintext)→ nonce(12)‖ciphertext`、`decrypt(key, data)`。純函式、無 I/O、`cargo test --features encstore` 可 headless 驗（roundtrip / 錯金鑰 / 竄改）。
2. **金鑰保管：** 每命名空間（身分，ADR-0045）一把隨機 AES 金鑰，base64 存 OS 金鑰庫（keyring，account `db:<namespace>`）。金鑰不落明文磁碟——與 B5 私鑰同源保護（Windows DPAPI 後備）。
3. **落地：** 密文寫 app 資料夾 `store/<namespace>.enc`。IPC `store_load(namespace)→Option<String>`（解密回 JSON 快照）、`store_save(namespace, json)`（加密寫檔）。
4. **前端（TS `TauriStorage`，增量2）：** 實作 `AppStorage`——內層包一個同步 `MemoryStorage`；開機 async `store_load` 灌入記憶體、同步讀取；寫入即更新記憶體 + **防抖 async `store_save`**（整包快照）。同步介面不變＝後端零改（ADR-0053 的 async/sync 摩擦以「開機 hydrate + write-through 記憶體快取」解）。
5. **範圍：** 僅 Tauri 執行期用 `TauriStorage`；瀏覽器維持 `LocalStorage`（不變）。

## 理由

- **現機即可做、可測：** 純 Rust、免 Perl/OpenSSL；加密原語單元測試 headless 通過。
- **達成 PRD §3：** 訊息/狀態密文落地；金鑰於 OS 金鑰庫、不明文落地。
- **複用 B5：** DB 金鑰走既有 keyring，與私鑰同源保護。
- **後端零改：** write-through 記憶體快取保住同步 `AppStorage` 介面，`RelayChatBackend` 不動。

## 後果

- 正面：桌面訊息庫加密落地、金鑰入 OS 金鑰庫；瀏覽器路徑零回歸；免 Perl。
- 負面 / 已知限制：
  - **整包快照**持久化（非 granular）：每次變更防抖後存整份。以 `MESSAGES_PER_CONVO` 等既有上限，快照有界（數 MB 級），可接受；未來大量資料可再切 granular。
  - AES-GCM 加密**整份 JSON**——非 SQL 可查詢加密庫；本機 AI/RAG（PRD 遠期）若需結構化查詢，屆時再評估 SQLCipher（需 Perl）或 SQLite+欄位加密。
  - 與 ADR-0020 的 SQLCipher 為兩條路：本 ADR 為現機採用路；SQLCipher 保留為有 Perl 時的替代（granular、B4 store）。
- 後續行動：
  1. **增量1（Rust）：** `encstore` 模組 + `aes-gcm` 相依 + `store_load/store_save` IPC（含 keyring 金鑰 get-or-create + 檔案 I/O）+ cargo 測試。
  2. **增量2（TS）：** `TauriStorage`（write-through `MemoryStorage` + 快照 export/import + 防抖持久化）+ 開機 hydrate + `buildBackend` 於 Tauri 用之。
