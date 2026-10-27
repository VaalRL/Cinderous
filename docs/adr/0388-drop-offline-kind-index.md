# 0388. 中繼拿掉 `idx_offline_kind`：每則離線留言少寫一列

- 狀態：已接受（未部署）
- 日期：2026-10-19
- 相關文件：SDK ADR 0098（同一件事在 SDK 中繼，DDL 逐字相同）；ADR-0235 C2（authors／kinds 下推到 SQL、加 pubkey／kind 索引）、ADR-0371 §決策 5（分桶索引）、ADR-0379（schema 與 SDK 逐字相同）、ADR-0387（DO 額度用完時說明原因）

## 背景與問題

2026-10-19 錨點 1 的 Durable Objects 免費每日寫入額度被用光，整座中繼一整天連不上（ADR-0387）。DO SQLite 依「寫入列數」計費，每個索引都算一列：一則離線留言寫入時，表本身加上各索引大約要寫 5–6 列，刪除時也一樣。

`offline_msgs` 目前的索引有：
- `idx_offline_expiration`
- `idx_offline_pubkey`
- `idx_offline_kind`
- `idx_offline_bucket(recipient, kind, created_at, expiration, bytes)`
- 三個部分索引（`bytes_missing`、`borrowed`、`batch`），平常不收列

其中 `idx_offline_kind` 是 ADR-0235 C2 為了把 `kinds` 下推到 SQL 而加的。後來 ADR-0371 加了以 `recipient, kind` 開頭的分桶索引，它就少有用處了。

## 實測：各種查詢的計畫

`relay-core.scoped()` 只放行三種形狀的過濾條件：
- 帶 `#p`（只能是自己）；
- 帶 `authors`；
- 第三方車道上，帶任一標籤。

用 node:sqlite 對 `query()` 實際組出來的 SQL 跑 `EXPLAIN QUERY PLAN`，比較有沒有 `idx_offline_kind` 時的差別：

| 形狀 | 有 `idx_offline_kind` | 拿掉後 |
|---|---|---|
| `#p`（＋kinds＋since） | 分桶索引 | 分桶索引（不變） |
| `authors` | pubkey 索引 | pubkey 索引（不變） |
| `authors`＋kinds（快照、稽核、IoT） | **kind 索引**：同 kind 的所有列都掃一遍 | pubkey 索引 |
| 標籤（車道） | 掃到期索引（≈全表） | 不變 |
| 標籤＋kinds、不帶 authors（車道） | kind 索引 | 掃到期索引（≈全表） |
| 每收件人上限的計數與修剪 | 分桶索引（涵蓋） | 不變 |

`authors`＋kinds 時，規劃器在沒有統計資料的情況下選了 kind 索引。但同一個 kind 的列遠多於同一位作者的列，所以拿掉它反而比較快。

SDK 送出的標籤過濾條件全部都帶 `authors`（`durability/audit.ts`、`iot/client.ts`），會走 pubkey 索引。只有「標籤＋kinds、不帶 authors」這一種形狀會變慢，而且只出現在第三方車道的自訂用法。

## 考量的選項

- 選項 A：拿掉 `idx_offline_kind`。
- 選項 B：保留。
- 選項 C：把 `idx_offline_pubkey` 改成 `(pubkey, kind)` 複合索引。

## 決策

採用選項 A：
1. 建構子不再建 `idx_offline_kind`，改成 `DROP INDEX IF EXISTS idx_offline_kind`。這是等冪的，每次喚醒都跑也沒有成本。
2. SDK 中繼做同樣的修改（SDK ADR 0098），兩邊從零建出來的 schema 仍逐字相同（ADR-0379）。PR #9 切換時不必遷移。
3. 測試：
   - `schema-compat.test.ts` 的期望 schema 加上 `ADR_0388_REMOVALS`；
   - 新增「離線留言查詢的索引」：記下 `query()` 實際下的 SQL、看查詢計畫。`#p` 要走分桶索引；`authors`＋kinds 要走 pubkey 索引、不能是 kind 索引。

## 理由

- 每則離線留言的寫入與刪除各少一列，大約省下離線留言寫入量的六分之一。額度用完就是整座中繼停擺，這是直接的效益。
- 合法用戶端的查詢一個都沒有變慢，`authors`＋kinds 還變快了。
- 選項 B 保留了一個主要作用是讓規劃器選錯的索引。
- 選項 C 不會省下任何寫入列數，只是把 `authors`＋kinds 再快一點，現在沒有需要。

## 後果

- 正面：寫入額度的消耗下降；`authors`＋kinds 查詢改走選擇性高的索引。
- 負面 / 已知殘餘風險：
  - 第三方車道上「標籤＋kinds、不帶 authors」的查詢，從 kind 索引退成掃到期索引。不帶 kinds 的標籤查詢本來就是這樣掃。車道是各自獨立的 DO，資料量小，查詢一律帶 `LIMIT` 與位元組預算（ADR-0371 §決策 6）。
  - 錨點升級後第一次喚醒時，要刪掉整個索引，這是一次性的寫入。
  - 回滾到舊版時，舊版會把索引建回來，也是一次性的寫入。
- 後續行動 / 待辦：
  - 部署到錨點要使用者同意。
  - PR #9 升級 SDK 時，要升到包含 SDK ADR 0098 的版本。
