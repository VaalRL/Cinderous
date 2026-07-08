# 0056. 離線留言持久層：Durable Object 內建 SQLite（非獨立 D1）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：ADR-0005（自建 Worker relay）、0006（心跳容量/免費層）；ROADMAP C1；`relay/src/message-store.ts`（同步行為＋測試）
- 精化：ADR-0005 原規劃「以 D1 為後備的 MessageStore」——改用 DO 內建 SQLite（理由見下）

## 背景與問題

C1 要讓 relay 真正**保存離線留言**（kind 1059 Gift Wrap），使離線收件人重連後拉得到。現況：Worker 的 `RelayCore` 未接 store，1059 僅即時轉發給在線訂閱者、離線即丟。

`MessageStore`（`message-store.ts`）的行為（NIP-40 過期、每收件人配額、`#p` 索引）**已定義且同步、有測試**；`RelayCore.handle` 亦為**同步**（`store.put`/`store.query` 同步呼叫）。

**關鍵約束**：D1 的 API 是**非同步**（`await env.DB...`）。接 D1 會撞回 sync/async 摩擦，逼 `RelayCore.handle` 全面 async 化（大改）。而 relay 的單一全域 `RelayRoom` Durable Object 我們已為免費層改成 **SQLite-backed（`new_sqlite_classes`）**——DO 內建的 `ctx.storage.sql.exec()` 是**同步**的。

## 考量的選項

- **選項 A（採用）：DO 內建 SQLite。** `SqlMessageStore` 走 `ctx.storage.sql`（同步）→ 完美對上同步 `MessageStore`/`RelayCore`，免 async 改動、免額外 binding、免費層已含。單一全域 DO 本就集中所有連線，離線留言存其 SQLite 最自然。
- **選項 B（否決於此）：獨立 D1。** ADR-0005 原案。API 非同步 → 需 `RelayCore` async 重構或 write-through 快取；且多一個 binding/資料庫。保留為「需獨立可查詢資料庫」時的替代。

## 決策

**採選項 A：離線留言持久化於 `RelayRoom` DO 的內建 SQLite。**

1. **介面抽取：** `OfflineStore`（`put`/`query`/`prune`，同步）。`MessageStore`（記憶體，測試用/小規模）與新 `SqlMessageStore` 皆 implements；`RelayCoreOptions.store` 型別改為 `OfflineStore`（結構相容，既有呼叫端不變）。
2. **`SqlMessageStore`（`relay/src/sql-message-store.ts`）：** 以可注入的 `SqlExec`（`(query, ...bindings) => rows`）為底，schema `offline_msgs(id, recipient, expiration, created_at, json)` + `recipient`/`expiration` 索引；`put`（每 `p` 標籤一列、`INSERT OR IGNORE`、per-recipient cap）、`query`（`#p` 走索引取候選 + 未過期 + `matchFilter`）、`prune`（刪已過期）。複用 `message-store.ts` 的 `getExpiration`/`recipientsOf`/`dedupById`/`matchFilter`。
3. **可測：** `SqlExec` 於產線包 `ctx.storage.sql.exec(...).toArray()`；測試以 `node:sqlite`（Node 內建）包出真 SQLite → **headless 驗真 SQL 邏輯**（put/query/#p/過期/cap）。
4. **DO 接線：** `RelayRoom` 建構子取 `ctx.storage.sql` → `new RelayCore({ store: new SqlMessageStore(exec, { maxPerRecipient }) })`。wrangler.toml **不需 D1 binding**（DO 已 SQLite-backed）。

## 理由

- **免 async 重構**：同步 DO SQLite 對上同步核心，最小侵入。
- **免費層、單一節點**：DO SQLite 已含於免費層；單一全域 DO 集中儲存，規模符合 ADR-0006（免費層數十並行）。
- **複用既有純邏輯與測試**：過期/收件人/matchFilter 共用；`node:sqlite` 讓 SQL 版仍 headless 可測。

## 後果

- 正面：離線留言真正持久（跨 DO 短暫休眠仍在），離線收件人重連即拉取；免 D1、免 async 改動。
- 負面 / 已知限制：
  - 儲存集中於單一 DO（DO SQLite 上限內；以 NIP-40 7 天過期＋per-recipient cap 有界）。需更大規模時再評估分片或 D1。
  - **NIP-40 實際刪除待 C2**（DO `alarm()` 定期 `prune`）；C1 的 `query` 已濾掉過期（不投遞），但過期列在 C2 前不自動刪。cap 已界定 per-recipient 成長。
  - 與 ADR-0005 的 D1 為兩條路：本 ADR 為採用路；D1 保留為需獨立資料庫時替代。
- 後續行動：`OfflineStore` 介面；`SqlMessageStore` + `node:sqlite` 測試；`RelayRoom` 接線；C2（alarm prune）；使用者 `wrangler deploy` 後驗離線收送。
