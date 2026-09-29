# 0373. 大訂閱不再撞 WebSocket attachment 16KB 上限：放不下的溢位到 DO SQLite

- 狀態：已接受
- 日期：2026-09-29
- 相關文件：ADR-0059（休眠式 WebSocket、attachment 還原）、ADR-0056（DO SQLite）、ADR-0123（`authors`
  上限 1024）、ADR-0235 C1（例外圍籬）、ADR-0241（分片與 presence 層）、ADR-0366／0369（車道）、
  ADR-0371（REQ 位元組預算）、ADR-0372〈另一個上限〉與〈後續 1〉（本問題的首次記錄，PR #12）、
  `relay/src/conn-persistence.ts`、`relay/src/worker.ts`、`relay/src/relay-core.ts`

## 背景與問題

ADR-0059 讓 `RelayRoom` 以休眠式 WebSocket 收發，並把每條連線的「挑戰／已認證 pubkey／主機／**全部訂閱
filter**」存進該 WebSocket 的 attachment，喚醒時從所有存活連線的 attachment 重建 `RelayCore`。

Cloudflare 官方對 attachment 的上限：

> `serializeAttachment` — "Maximum serialized size is 16,384 bytes"
>
> 來源：<https://developers.cloudflare.com/durable-objects/api/websockets/>（2026-09-29 查閱）

一把 pubkey 在 filter JSON 裡約 67 bytes ⇒ **同一條連線的 `authors` 合計約 240 把**就超過。`persist()`
在 `webSocketMessage` 裡直接呼叫 `serializeAttachment`，而它**不在** `RelayCore.handle` 的例外圍籬
（ADR-0235 C1）之內 ⇒ **未捕捉例外**：

- `dispatch` 不會執行 ⇒ 客戶端**什麼都收不到**（沒有 EOSE、NOTICE、CLOSED）；
- 訂閱已經登錄在記憶體 ⇒ 醒著的時候扇出照常，看起來能用；
- DO 休眠一次（閒置約十秒）⇒ 記憶體清空，attachment 仍是舊值 ⇒ **訂閱無聲消失**。

### 正式環境影響

App 的心跳訂閱是 `{kinds:[20000], authors:[全部聯絡人]}`（`packages/engine/src/backend/relay-backend.ts`
`subscribeOn`）。分片模式下 presence 層那條連線一次訂全部聯絡人 ⇒ **聯絡人約 240 位以上**，休眠後就
收不到任何人的心跳（綠點全滅，直到重連）。非分片模式所有訂閱合併成一個 REQ，門檻更低。FS（實驗性）的
`{kinds:[10040], authors}` 同形。

### 重現（`wrangler dev`，本機 workerd，origin/main 73756982，嚴格平面 `/presence`，已 NIP-42 認證）

一條連線 `REQ {kinds:[20000], authors:[N 把]}`，另一條以第 N 把金鑰發心跳；`等待後`＝閒置 25 秒再發一次。

| N | 修正前 REQ 回應 | 修正前即時扇出 | 修正前等待 25 秒後 |
| --- | --- | --- | --- |
| 50（對照） | EOSE | 收到 | **收到**（休眠還原正常） |
| 200 | NOTICE 內部錯誤（ADR-0372 的綁定參數問題，與本 ADR 無關） | 收到 | — |
| 260 | **無回應** | 收到 | **收不到** |
| 1024 | **無回應** | 收到 | — |

workerd 記錄：`Uncaught Error: A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was
17435 bytes.`（260 把：REQ JSON 17,462 bytes ⇒ structured clone 與 JSON 長度只差幾十 bytes）。
「50 把等待後收到、260 把等待後收不到」同時證明了 `wrangler dev` 會在 25 秒內讓 DO 休眠。

## 官方限制（2026-09-29 查閱）

- attachment：16,384 bytes（上引 WebSockets API 頁）。「Serialized attachments persist through hibernation
  as long as the WebSocket remains healthy」；「Code updates disconnect all WebSockets」——部署會重啟每顆 DO，
  官方**沒有**保證那時會呼叫 `webSocketClose`。
- DO 儲存（<https://developers.cloudflare.com/durable-objects/platform/limits/>）：KV API 單值 **128 KiB**、
  鍵 2 KiB；SQL 單一字串／BLOB／列 **2 MB**、每次查詢綁定參數 100；每顆 SQLite DO 10 GB；帳號 5 GB（免費）。
- 計費（<https://developers.cloudflare.com/durable-objects/platform/pricing/>）：SQLite 後端寫入列數
  免費 **100,000／天**、付費每月 5,000 萬列內含；讀取列數免費 500 萬／天；「Deletes are counted as rows written」。

單一訂閱最大可到 384KB（訊息上限）⇒ 超過 KV API 的 128 KiB，**只能放 SQLite**。

## 考量的選項

- **選項 A：訂閱一律存 DO storage，attachment 只存識別資訊。** 最單純，但每次 REQ／CLOSE 都寫一列、
  **每次喚醒都要讀**全部連線的訂閱——正是 ADR-0059 刻意避開的成本（心跳每分鐘把 DO 叫醒一次）。
- **選項 B：壓縮 filter（authors 轉 32 bytes 二進位＋base64，約省 1/3）。** 上限從約 240 把推到約 360 把，
  離 ADR-0123 承諾的 1024 還遠；只能當輔助。**不採用**：多一套編解碼、多一個會錯的地方，換不到正確性。
- **選項 C（採用）：混合——小的照舊放 attachment，放不下的溢位到 SQLite 表 `ws_subs`。**
- **選項 D：收緊 `authors` 上限到約 200。** 違反 ADR-0123，且等於把「聯絡人超過 200 位」變成協定錯誤。

## 決策

採**選項 C**，實作集中在 `relay/src/conn-persistence.ts` 的 `ConnPersistence`，`RelayRoom` 只接線。

1. **表**：`ws_subs(conn_id TEXT, sub_id TEXT, filters TEXT, PRIMARY KEY (conn_id, sub_id))`，
   在 DO 建構時 `CREATE TABLE IF NOT EXISTS`（與 `SqlMessageStore` 同一個做法）。
2. **放置**：訂閱依 filter JSON 大小**由小到大**塞進 attachment 預算（`INLINE_BUDGET_BYTES`＝12KiB，扣掉
   連線 id／挑戰／pubkey／主機；對 16KiB 留 4KiB 餘裕），放不下的寫進 `ws_subs`，attachment 的 `spilled`
   欄記下它們的訂閱 id。規則與插入順序無關 ⇒ 喚醒還原後再存一次**不會搬家**。
3. **只在變了才寫**：記住上一次成功寫入的 attachment JSON 與每條訂閱的 filter JSON；心跳 EVENT 這類不改
   訂閱的訊息**零寫入**，連 `serializeAttachment` 都不做（修正前每則訊息都重做一次）。喚醒時把讀回的狀態
   當成「已持久化」，所以喚醒後的第一則訊息也不會重寫。
4. **寫入順序**：先寫溢位列 → 再寫 attachment → 最後刪不再溢位的列。中途失敗最多留下孤兒列，**不會**
   出現「attachment 指著一條不存在的列」。
5. **每連線合計上限 `MAX_CONN_SUB_BYTES`＝512KiB**（filter JSON）：1024 把 authors 一條約 70KB，放得下
   7 條。超過時只砍**這次新增或改過**的（由大到小），回 `CLOSED <subId> "invalid: … exceed 512 KiB …
   (ADR-0373)"`，那條的 EVENT／EOSE 不送。沒有這一道，一條連線 16 條 × 384KB 訊息上限 ≈ 6MB 會落進
   storage。1024 上限（ADR-0123）**不收緊**。
6. **不靜默失敗**：`save()` 不拋例外；storage 或 `serializeAttachment` 出錯 ⇒ `console.error`、把這次新增或
   改過的訂閱從 `RelayCore` 移除（新增 `RelayCore.dropSubscription`，客戶端 `CLOSE` 也改走它），回
   `CLOSED "error: … please resubscribe (ADR-0373)"`，再存一次讓持久化狀態與記憶體一致。
   `webSocketMessage` 從此沒有未捕捉例外的路徑。
7. **喚醒還原**：`ensureHydrated` 讀所有存活連線的 attachment；**只有 attachment 記著溢位時**才讀整張表
   （否則只做一次 `SELECT 1 … LIMIT 1` 確認表是空的）。attachment 記著、表裡卻沒有的訂閱 ⇒ 回
   `CLOSED "error: subscription was lost … please resubscribe"` 並立刻更正該連線的 attachment——
   **不假裝還在**。
8. **清理**：`webSocketClose`／`webSocketError`／伺服端主動關閉（限速）都會刪該連線的列（先還原，才知道
   有哪些列）。**異常斷線**（部署重啟時 handler 不保證執行）留下的孤兒列，在下一次喚醒還原時刪掉；
   `alarm()`（NIP-40 定期清理，DO 休眠仍會被叫醒）也會觸發還原，所以「之後再也沒有連線進來」的 DO 也清得到。
9. **相容**：舊版 attachment 沒有 `spilled` 欄 ⇒ 照舊整份還原（有回歸測試）。

## 成本與延遲的取捨

- **一般情況完全不變**：聯絡人不到約 180 位（12KiB 預算）的連線，行為與 ADR-0059 一樣——零 storage 讀寫。
- 大訂閱：REQ 或改訂閱時寫 1 列（改回小的或 CLOSE 時刪 1 列，同樣計入寫入）；心跳不寫。以免費額度
  100,000 列／天而言，就算 1,000 位大通訊錄使用者每天各重連 20 次也只有 20,000 列。
- 喚醒時讀取列數＝目前溢位的列數（每條大訂閱 1 列），落在免費額度每天 500 萬列內。
- 延遲：DO 的輸出閘門會讓回應等到寫入確認才送出 ⇒ **只有溢位的那個 REQ** 多一次本地寫入延遲；
  心跳與一般訊息不受影響。

## 後果

- 正面：`authors` 到 1024（ADR-0123 的完整範圍）的訂閱都能回應、都能跨休眠還原；超過合計上限、存不住、
  還原不回來的情況**都會告訴客戶端**並留下記錄。修正前每則訊息都重做的 `serializeAttachment` 變成只在
  狀態改變時做。
- 負面 / 已知殘餘風險：
  - 新增 `ws_subs` 表（見〈部署與回滾〉）。
  - 連線 id／挑戰／主機本身不可能超過 16KB，但若平台未來調低 attachment 上限，`serializeAttachment` 會在
    `fetch` 的首次存檔失敗——那時連線沒有訂閱，只會記錄錯誤、之後的訊息找不到 connId 而被忽略（與修正前相同）。
  - `CLOSED` 之後要不要重訂由客戶端決定；目前引擎沒有對 `CLOSED` 自動重訂（見〈後續〉）。在本 ADR 下
    合法客戶端只有「表列遺失」這個極罕見情況會拿到它。
- 實測（`wrangler dev`，嚴格平面 `/presence`，已認證）：

  | 情境 | 修正前 | 修正後（只有本 ADR） | 修正後＋PR #12（ADR-0372） |
  | --- | --- | --- | --- |
  | 260 把，REQ 回應 | 無回應 | NOTICE（ADR-0372 的問題） | **EOSE** |
  | 260 把，閒置 25 秒後扇出 | **收不到** | 收到 | 收到 |
  | 1024 把，REQ 回應 | 無回應 | NOTICE（ADR-0372） | **EOSE** |
  | 1024 把，閒置 25 秒後扇出 | — | 收到 | 收到 |
  | 同一連線 8 條 × 1024 把 | — | 第 8 條多一則 `CLOSED invalid: … 512 KiB` | 前 7 條 EOSE、第 8 條 `CLOSED invalid:` |
  | 連線關閉後 `ws_subs` | — | 0 列 | 0 列 |
  | 持有 1024 把訂閱時直接殺掉 dev server（模擬部署重啟） | — | 留下 1 列孤兒；重啟後第一條新連線進來即清為 0 列 | — |

- 測試：`worker.test.ts` 的假 DO 改為與 workerd 相同地在 attachment 超過 16,384 bytes 時拋錯（否則以下
  測試全是空轉），新增 14 個測試（修正前 12 紅；「替身會拋」與「舊版 attachment 照常還原」是釘子）：
  260／1024 把不拋且回 EOSE、休眠後仍收得到、大小訂閱混合、小訂閱不碰溢位表、心跳零寫入（含喚醒後）、
  CLOSE 或縮小後刪列、close／error 清列、部署重啟孤兒在下一次還原與 alarm 時清掉、溢位列遺失回 CLOSED、
  合計上限回 CLOSED 且不影響既有訂閱、storage 寫入失敗回 CLOSED 且不留在記憶體。
- 與 PR #12（ADR-0372）：**可獨立合併**（沒有重疊的程式碼；`docs/adr/README.md` 索引同一處各加一列，
  後合併的那個要手動解衝突）。兩個問題在同一條心跳訂閱上接連出現（99 把起 NOTICE、240 把起無回應），
  **建議一起部署**，否則 99–1024 把之間只修好一半。

## 部署與回滾

- **Storage schema**：新增 `ws_subs` 表，`CREATE TABLE IF NOT EXISTS`，不需 wrangler migration（DO 類別本來
  就是 `new_sqlite_classes`）。錨點 2（另一個 CF 帳號）部署時照舊需設 `CLOUDFLARE_ACCOUNT_ID`，並指定 `wrangler.toml` 與 `--env=""`。
- **部署當下**：所有 WebSocket 會被平台斷開、客戶端重連重訂 ⇒ 不存在「舊 attachment ＋新程式」以外的混合
  狀態，而那種狀態有測試。
- **回滾到舊版**：舊程式不認得 `spilled` 欄、不讀 `ws_subs` ⇒ 大訂閱在休眠後遺失、`serializeAttachment` 再度
  拋出——**就是修正前的行為**，不會更糟。`ws_subs` 表留在 DO 裡（每條大訂閱一列，連線斷了也不會再被清），
  佔用極小；需要時可再部署新版讓它自己清，或忽略。

## 後續行動 / 待辦

1. **SDK（`cinderous-sdk-dev`，另有代理人在改，本 ADR 不動）**：SDK 的 `src/relay/worker.ts` 有同一個
   `persist()`，需移植 `ConnPersistence`、`RelayCore.dropSubscription` 與假 DO 的 16KB 替身測試；PR #9（relay
   改用 SDK）合併前須先補齊，否則部署它等於把本 ADR 撤銷。與 ADR-0372〈後續 2〉一併處理。
2. 部署後以正式錨點冒煙：`/presence` 認證後送 `authors` 1024 的 REQ，應收到 EOSE（需 ADR-0372 一起上）；
   閒置一分鐘後以其中一把發心跳，應收到扇出。
3. 引擎對 `CLOSED` 的處理：目前不自動重訂。可評估收到 `error:` 前綴的 `CLOSED` 時重送該訂閱（另立）。
