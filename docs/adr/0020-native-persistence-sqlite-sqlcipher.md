# 0020. 原生持久化：SQLite / SQLCipher（Phase B4）

- 狀態：**被取代 by [0054](./0054-encrypted-storage-substrate-aes-gcm.md)**（改用 AES-256-GCM 加密 blob）；
  死碼已由 [0105](./0105-retire-native-backend-dead-code.md) 移除
  - 本 ADR 的 SQLite/SQLCipher **從未被建置**（`rusqlite` 與 `persistence`/`sqlcipher` feature 皆已刪除）。
- 日期：2026-07-01
- 相關文件：docs/ROADMAP.md（Phase B4）；docs/adr/0018（Tauri 殼）；前端 A2 localStorage 層

## 背景與問題

桌面版要把 A2 的 localStorage 資料層換成**原生、加密**的資料庫，落地身分、聯絡人、
訊息、回應、收回與封鎖名單，且明文與私鑰不離開裝置。挑戰：既要可在無 GUI 環境
測試，又要能實際加密（SQLCipher），且不拖慢預設 `cargo test`。

## 決策

- **資料層**：`storage::Store`（rusqlite）schema 對齊前端 `apps/desktop/src/storage/types.ts`
  的 `AppStorage`——`identity`（單列 upsert）、`contacts`、`messages`（含
  `expires_at` 限時、`INSERT OR IGNORE` 去重、`ORDER BY rowid` 保序）、`reactions`、
  `deleted`、`blocked`；`remove_contact` 連帶清對話、`block_contact` 移出聯絡人並記入
  封鎖名單。與前端記憶體/localStorage 實作語意一致，便於 B2 IPC 對接。
- **加密（SQLCipher）**：`Store::open(path, key)` 在 `key` 非空時發出 `PRAGMA key`。
  - `persistence` feature → `rusqlite/bundled`（純 SQLite）：`PRAGMA key` 被忽略，明碼，
    供開發/測試（快速、可 CI）。
  - `sqlcipher` feature → `rusqlite/bundled-sqlcipher-vendored-openssl`：整庫加密，
    正式版採用。**兩者互斥**（rusqlite 後端二擇一）。
  程式碼路徑單一，僅後端 feature 不同。
- **feature 隔離**：rusqlite 為 optional，預設 `cargo test` 不編譯 SQLite；storage
  模組 gate 於 `any(persistence, sqlcipher)`，維持基礎測試精簡。

## 後果

- 正面：B4 在本環境**完全可驗證**——`persistence` 9 個 CRUD/schema 測試；`sqlcipher`
  以真實 SQLCipher + vendored OpenSSL 建置並跑同套測試，另加「**錯誤/無金鑰無法開啟
  加密庫**」測試，證實加密於磁碟落地。與 A2 語意一致，避免資料層行為分歧。
- 負面 / 未來：私鑰目前存於 DB 的 `identity`；更安全的作法是把主金鑰交由 **OS 金鑰庫
  （B5 keyring）** 託管，DB 金鑰由其保護（本 ADR 僅提供加密庫，金鑰託管另議）。
  尚未接上 Tauri（B2 命令/`ipc` DTO ↔ webview），亦未做資料遷移（A2 localStorage →
  SQLite 的一次性匯入），列為後續。多設備一致性沿用既有對帳（ADR-0009）。
