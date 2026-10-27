# 0372. 中繼查詢不再受 DO SQLite「每次查詢 100 個綁定參數」限制（`json_each(?)`）

- 狀態：已接受
- 日期：2026-09-29
- 相關文件：ADR-0371〈後續 4〉（本問題的首次記錄）、ADR-0235 C2（條件下推到 SQL）、
  ADR-0366 P1 #5（標籤下推，已在用 `json_each`）、ADR-0371 §決策 6（REQ 16MB 位元組預算）、
  ADR-0123（`authors` 上限 1024）、ADR-0059（WebSocket attachment 休眠還原）、
  `relay/src/sql-message-store.ts`、`relay/src/relay-core.ts`

## 背景與問題

Cloudflare 官方 Durable Objects 限制頁的 **SQL storage limits**（適用於 SQLite 後端的 DO）：

> Maximum bound parameters per query — **100**
> Maximum SQL statement length — 100 KB
>
> 來源：<https://developers.cloudflare.com/durable-objects/platform/limits/>（2026-09-29 查閱）

`SqlMessageStore.query()` 過去把 filter 的每個值都展開成一個 `?`：
`recipient IN (?,…)`（`#p`）、`pubkey IN (?,…)`（`authors`）、`id IN (?,…)`（`ids`）、
`kind IN (?,…)`（`kinds`）、標籤值 `json_extract(tg.value,'$[1]') IN (?,…)`，再加上 `nowSec` 與
`LIMIT` 兩個。於是**只要一個欄位有 99 個值**（99 ＋ 2 ＝ 101）`sql.exec()` 就拋例外。

- `relay-core.scoped()` 允許 `authors` 到 **1024** 把（ADR-0123），`ids`／`kinds`／標籤值沒有個別上限。
- 例外被 `RelayCore.handle` 的圍籬接住 ⇒ 客戶端收到 `NOTICE "error: 內部錯誤"`，**沒有 EOSE**；
  同一個 REQ 裡**排在它後面的 filter 全部不重播**（`handleReq` 逐 filter 迴圈被中斷）。
  訂閱本身在查詢前已登錄，即時扇出不受影響——壞的是「補歷史」。
- 本地單元測試用 node:sqlite（上限 32766），完全看不出來。

### Cinderous App 實際會不會送出這種 filter

會。引擎（`packages/engine/src/backend/relay-backend.ts` `subscribeOn`）的心跳訂閱是
`{kinds:[20000], authors:[聯絡人]}`：

- **分片模式（App 預設，`nb.sharding` 未設為 0）**：presence 層那條連線一次訂**全部**聯絡人
  ⇒ 聯絡人 ≥ 99 位就 NOTICE。心跳是 Ephemeral、庫裡本來就沒有東西可補，即時扇出照常 ⇒ 功能上
  幾乎無感；但聯絡人約 240 位以上會撞 attachment 上限（見下），休眠後 presence 訂閱消失。
  訊息片連線的 `authors` 只有落在該片的聯絡人（16 片），且分片模式不在訊息片訂心跳。
- **非分片模式（使用者關閉分片、或指向單一 relay）**：所有訂閱合併成**一個 REQ**，心跳 filter
  排第一 ⇒ 同一 relay 上聯絡人 ≥ 99 位時，後面的收件匣 `#p` filter **不重播**
  ⇒ 重連後補不到離線訊息。這是真實的訊息延遲／遺漏風險。
- FS（實驗性、預設關）的 `{kinds:[10040], authors}` 同形。
- 其他 filter 都是單值（`#p:[自己]`、`authors:[自己]`、維護者／管理者）。

### 重現（`wrangler dev`，本機 workerd，origin/main 73756982）

在 `/app/lwd` 車道發 260 顆事件（260 把不同金鑰），再送 REQ：

| filter | 修正前 | 修正後 |
| --- | --- | --- |
| `authors` 98（對照） | 98 顆 ＋ EOSE | 98 顆 ＋ EOSE |
| `authors` 99 | NOTICE 內部錯誤 | 99 顆 ＋ EOSE |
| `authors` 150／200／230 | NOTICE 內部錯誤 | 150／200／230 顆 ＋ EOSE |
| `#t` ＋ `ids` 150 | NOTICE 內部錯誤 | 150 顆 ＋ EOSE |
| `#t` ＋ `#e` 150 | NOTICE 內部錯誤 | 150 顆 ＋ EOSE |
| `#t` ＋ `kinds` 150 | NOTICE 內部錯誤 | 260 顆 ＋ EOSE |
| `authors` 260／1024 | 無回應（見〈另一個上限〉） | 無回應（同左，**不在本 ADR 範圍**） |

回傳順序皆為 `created_at` 由新到舊（與修正前相同）。

## 考量的選項

- **選項 A：`json_each(?)`——整串值序列化成一個 JSON 字串、只佔一個綁定參數**：
  `pubkey IN (SELECT value FROM json_each(?))`。SQL 形狀、`ORDER BY`、`LIMIT`、兩段式位元組預算
  全部不變。
- **選項 B：分批查詢（每批 ≤ ~90 個值），應用層合併、排序、去重、截斷 `limit` 並共用位元組預算**：
  1024 把 `authors` ＝ 12 次查詢；每批都得各取 `limit` 列才能保證合併後取到真正最新的 N 顆
  ⇒ 讀取列數（Cloudflare 以此計費）最多放大 12 倍；多欄位同時超量時要做笛卡兒積或挑一欄分批；
  位元組預算的「先讀大小再讀 json」兩段式要改寫成跨批合併。複雜度與出錯面都大得多。
- **選項 C：在 `relay-core` 收緊 filter 陣列合計上限到 ~90**：違反 ADR-0123 已對外承諾的 1024，
  而 App 的心跳訂閱正是 `authors: [全部聯絡人]`——等於把「聯絡人超過 90 位」變成協定錯誤。

## 決策

採**選項 A**。`sql-message-store.ts` 新增 `inJson(column, values)`，`query()` 的 `#p`／`authors`／
`ids`／`kinds`（離線表與可尋址表）及標籤值一律改用 `IN (SELECT value FROM json_each(?))`。

- 綁定參數總數與 filter 陣列長度脫鉤：離線表最多 **9 ＋ 2 × 標籤鍵數**，可尋址表最多
  **5 ＋ 2 × 標籤鍵數**。
- 非陣列的 filter 值照舊拋例外（修正前是 `values.map` 拋），由例外圍籬轉成 NOTICE——不改變
  惡意 filter 的可見行為。
- 寫入與刪除路徑（`put` 逐收件人一列 INSERT、`putAddressable`、`prune`、`vanish`、分桶修剪、
  天花板淘汰）本來就是固定個數的綁定參數，**不需修改**；已加測試釘住。

## 理由

- **DO 上可用已證實**：`json_each` 早已在產線跑（ADR-0366 P1 #5 的標籤下推），這次在 `wrangler dev`
  上也實測通過。
- **索引照用**：以 node:sqlite 20 萬列 `EXPLAIN QUERY PLAN` 比對，新舊形狀都是
  `SEARCH offline_msgs USING INDEX idx_offline_pubkey (pubkey=?)`（`#p` 走 `idx_offline_bucket`），
  只多一個 `LIST SUBQUERY`（把 JSON 陣列展成暫存 B-tree，每次查詢一次）。
- **效能**（同一資料、20 次平均）：`authors` 1024 → 7.0 ms vs 8.4 ms；`#p` 150 → 2.1 ms vs 2.6 ms；
  熱路徑 `#p` 單值 → 0.07 ms vs 0.12 ms。差距在 0.1 ms 等級，換掉的是「整個 REQ 失敗」。
  讀取列數：`json_each` 虛擬表的列可能計入 rows read，每次查詢多 N 列（N＝值的個數）——
  比選項 B 的最多 12 倍 `limit` 列少得多。
- 語意與記憶體版 `MessageStore` 的對照測試全綠（見〈後果〉）。

## 另一個上限（不在本 ADR 範圍，另立）

實測時撞到**第二個、獨立的既有問題**：`RelayRoom.persist()` 把連線的全部訂閱存進 WebSocket
attachment（ADR-0059 休眠還原），而 attachment **上限 16,384 bytes**（workerd 錯誤訊息：
`A WebSocket 'attachment' cannot be larger than 16384 bytes`）。一把 pubkey 在 JSON 裡約 67 bytes
⇒ 約 **240 把以上**的 `authors`（同一連線所有訂閱合計）就會讓 `serializeAttachment` 在
`webSocketMessage` 裡拋出**未捕捉例外**：`dispatch` 不會執行（客戶端既沒 EVENT 也沒 EOSE/NOTICE），
訂閱只留在記憶體、休眠醒來就消失。修正需要設計（訂閱改存 DO storage、或 attachment 只存摘要），
故不併入本 ADR，列為後續 1。

## 後果

- 正面：`authors`／`ids`／`kinds`／`#p`／標籤值超過 98 個的 REQ 恢復正常（在 attachment 上限內）；
  同一 REQ 後面的 filter 不再因前面一個失敗而漏重播。
- 正面：不需分批合併，`limit`、16MB 位元組預算、排序、去重的語意逐字不變。
- 負面 / 已知殘餘風險：
  - 單一 filter 的**不同標籤鍵**超過 45 個（`#a`…`#z`…）時，綁定參數仍會超過 100（每鍵 2 個）→
    行為與修正前相同（NOTICE）。合法客戶端不會這樣送；有測試釘住 40 鍵可用。
  - JSON 陣列作為單一字串參數受「單一字串 2MB」上限約束——`relay-core` 的訊息上限 384KB 已先擋。
  - 惡意 filter 放了非字串值（物件、巢狀陣列）時，修正前綁定就拋、現在序列化後比對不到 → 回 EOSE 空集合
    而非 NOTICE。屬「原本失敗的查詢現在成功」。
- 測試：`sql-message-store.test.ts` 新增 12 個測試，以「綁定參數 > 100 即拋錯」的 `SqlExec` 替身模擬
  DO（修正前 11 個紅；寫入路徑那個本來就綠，是回歸釘子），並與記憶體版逐一對照結果集合、順序、`limit` 與位元組預算。
- 後續行動 / 待辦：
  1. **WebSocket attachment 16KB 上限**（見上節）：約 240 把以上的 `authors` 讓 `persist()` 拋未捕捉
     例外、REQ 無回應、休眠後訂閱遺失。另立 ADR 修正（至少 `persist()` 需 try/catch＋降級策略）。
  2. **SDK（`cinderous-sdk-dev`，另有代理人在改，本 ADR 不動）**：SDK `src/relay/sql-message-store.ts`
     需移植同一修正（`inJson`／`pushIn`、標籤值改 `json_each(?)`）與上限替身測試；PR #9（relay 改用 SDK）
     合併前須先補齊，否則部署它等於把本 ADR 撤銷。
  3. 部署後以正式錨點冒煙：`/app/<車道>` 送 `authors` 150 的 REQ，應收到 EOSE。
