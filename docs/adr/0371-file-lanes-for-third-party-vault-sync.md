# 0371. 檔案車道：錨點只在指定的第三方車道收檔案塊（`FILE_LANES`，單檔 30MB）

- 狀態：已接受
- 日期：2026-09-29
- 相關文件：ADR-0162（組織檔案經 relay 暫存、`FILE_WRAP` 1060、`MAX_FILE_MB`）、
  ADR-0244（公共檔案後備——**提議中**；本 ADR 不取代它，見〈與 ADR-0244 的關係〉）、
  ADR-0366（第三方車道、已知租戶 `APP_LANES`）、ADR-0367（DO 容量天花板）、ADR-0369（車道的
  `#p` 須 AUTH）、ADR-0160（保存期）、ADR-0006（免費額度）、ARCHITECTURE §5、
  `relay/src/host-config.ts`（`filePolicyFor`）、`relay/src/worker.ts`、`relay/src/sql-message-store.ts`

## 背景與問題

CinderSync 與 Cinder Coffice（兩個 Obsidian 外掛，車道 id 即 manifest id，PR #11 已加入
`APP_LANES`）的 Vault 同步在 P2P 連不上時改走中繼，而那條路的外層就是檔案塊 kind 1060
（SDK ADR 0025／0026）。錨點沒設 `MAX_FILE_MB` ⇒ 整類拒收 ⇒ 同步在中繼上完全不動。

2026-09-29 使用者決定：**錨點開放 30MB，PR #11 合併部署**。

但 `MAX_FILE_MB` 今天只是一個**全站**開關：設了，整座 Worker 的每一顆 DO——包括 Cinderous 主訊息
平面的舊全域、16 片分片與 presence——都開始收檔案塊，配額沿用企業預設（每收件人 4000 塊、7 天）。
那正是 ADR-0244 **否決的選項 1**（「直接翻 `MAX_FILE_MB` 開公共、沿用企業預設」）。

要的是：只替這兩條車道開，主平面一個字都不動。

實作過程中另外量到三件事，它們讓「把數字調大」本身就會出事（§決策 5、6）：

1. 離線留言的天花板每次寫入都跑 `SUM(LENGTH(json))`——要把**每一列**的 json 從溢位頁讀出來。
   以 node:sqlite 實測，2000 顆 131KB 的列（262MB）約 **1.4 秒／次**。
2. 分桶修剪每次寫入都以 `json_extract(json, '$.kind')` 掃該收件人的**每一列**（`kind` 欄是後來
   `ADD COLUMN` 加的，排在 json 後面，讀它一樣要走完溢位頁）。1500 列約 **0.4 秒／次**。
3. 一次 REQ 最多回 1024 列（ADR-0235 C2），那是為聊天訂的。檔案塊一顆約 131KB，1024 顆就是
   **134MB**——超過 DO 的 128MB 記憶體上限，DO 會在組回應的途中被重置，客戶端重連、再 REQ、再重置。

## 考量的選項

- **選項 A：直接在錨點設 `MAX_FILE_MB`。** 一行設定。就是 ADR-0244 否決的選項 1。**不可取。**
- **選項 B：另寫一條「車道檔案」路徑（新的 kind 或新的旗標）。** 違反 Fix-First：ADR-0162 的
  整類拒收、獨立配額桶已經是對的形狀，只是開關的**範圍**不對。
- **選項 C（採用）：延伸既有的 `acceptFileEvents`，加一個站方設定 `FILE_LANES` 決定範圍。**

## 決策

### 1. `FILE_LANES` 的語意

新增站方設定 `FILE_LANES`（逗號分隔的車道 id，正規化同 `APP_LANES`：去空白、小寫）。
兩座宿主共用 `host-config.filePolicyFor(env, laneId)` 這一個函式判定：

| `MAX_FILE_MB` | `FILE_LANES` | 結果 |
| --- | --- | --- |
| 未設／<1 | 任意 | **哪裡都不收**（總開關，ADR-0162 不變） |
| ≥1 | **未設**（或空白） | **與過去完全相同**：全站收，`MAX_FILE_MB` 只是開關，NIP-11 不宣告單檔上限（企業自架相容；回歸測試釘住） |
| ≥1 | **有設** | **車道模式**：只有 `laneId ∈ FILE_LANES ∩ APP_LANES` 的 DO 收；Cinderous 主訊息平面（`/`、`/s/<n>`、`/presence`）、共用雜湊分片與其他車道一律整類拒收。`MAX_FILE_MB` 改當**單檔上限** |

- **必須同時在 `APP_LANES` 上**：不在名單上的車道沒有自己的 DO，落在共用分片——替它開檔案等於
  替那顆分片上所有陌生應用開檔案。這種 id 被**忽略**，Worker 在 DO 建構時 `console.warn`，
  `wrangler-vars.test.ts` 對錨點設定直接釘死「每一條都在 `APP_LANES` 上」。
- **全部 id 都無效時仍是車道模式**（fail-closed）：不會退回全站開放。
- **DO 記住的是車道 id，不是「收不收」**：新 storage 鍵 `cinder:lane-id`（休眠喚醒可能沒有 fetch）。
  「收不收」每次由 env 算——改 `FILE_LANES` 重新部署立刻生效；存下決定反而會把它永久釘在 DO 裡。
  升級前就釘住政策的 DO（沒有這個鍵）在下一次連線時補記，不回 409。
- **node 主機**沒有車道：以「不是任何車道」去問同一個函式 ⇒ 沒設 `FILE_LANES` 照舊全站開關；
  設了就整站不收（與 Cloudflare 版主平面一致）並在啟動時警告。

### 2. 單檔上限：宣告，由客戶端遵守

relay 看不到明文、也無法重組檔案（它只看到一顆顆互不相關的 Gift Wrap），所以 30MB 只能**宣告**。
該車道的 NIP-11（`GET /app/<id>`，`Accept: application/nostr+json`）新增：

- `cinder_accepts_files: true`（既有欄位；根路徑與其他車道仍為 `false`）
- `cinder_max_file_mb: 30`（新）
- `cinder_file_chunks_per_recipient: 1440`（新；客戶端據此決定送多快、一次送多少）

兩個新欄位只在車道模式、且該路徑收檔案時出現。文件與 DO 用同一個 `filePolicyFor`／`storeOptions`
算出，不另抄一份。

### 3. 每收件人配額：1440 塊

relay 端真正封頂的是**每收件人檔案塊配額**（ADR-0162 的獨立桶，FIFO，不擠聊天）：

- 每塊明文 48,000 B（core `FILE_CHUNK_BYTES`＝SDK `RELAY_FRAME_PAYLOAD_BYTES`），包兩層 NIP-44 後
  每顆事件約 **131KB**（SDK ADR 0009 實測）。
- 30MB（30 × 1,048,576 B）÷ 48,000 B ＝ 655.4 → **656 塊**，在中繼上約 **86MB**。
- 配額 ＝ 2 個上限檔 ＋ 128 塊餘裕（同步協調訊息、摘要、重送）＝ 2 × 656 ＋ 128 ＝ **1440 塊**
  ≈ 189MB（以單顆 sanity 上限 200KB 算的最壞情況 288MB）。
- 由 `MAX_FILE_MB` 推得（`fileLaneChunksPerRecipient`），改上限時配額跟著走。
- 對照：企業預設 4000 塊（≈524MB）。本配額約其 1/3，且只存在兩顆獨立 DO 裡。

### 4. 保存期：維持 7 天；每顆檔案車道 DO 另有 1GiB 天花板

- **保存期維持 7 天**（`APP_LANES` 上的車道本來就是 7 天，不動）。不採 ADR-0244 階段 A 的 2–3 天：
  那是替**公共**主平面訂的，而這裡是兩個已知租戶；成本的上界由配額與下述天花板決定，**不是**由 TTL。
  對 Vault 同步的影響：**一台裝置離線 7 天內回來都補得齊**（前提是這段期間寄給它的檔案塊沒超過
  1440 塊——超過的最舊那幾塊會被 FIFO 擠掉，要靠同步協調器重新索取）。若縮到 2–3 天，筆電關一個
  長週末就會掉資料，而 SDK 的批次補送（ADR 0026 §3）是以 7 天設計的。
- **每顆檔案車道 DO 的離線留言天花板 1GiB**（`FILE_LANE_OFFLINE_MAX_BYTES`；一般 DO 維持 128MB）。
  128MB 連兩位收件人各收一個 30MB 檔都裝不下，而車道天花板是**淘汰**制（ADR-0367 §決策 2）——
  裝不下就會默默刪掉別人還沒領的塊。1GiB 容得下三位收件人的整份最壞配額（測試釘住）。

### 5. 儲存層前提：寫入的代價不能隨資料量成長（全站生效，行為不變）

- `offline_msgs` 新增 `bytes` 欄（每列 json 長度），升級前的列由部分索引
  `idx_offline_bytes_missing`（只收 `bytes IS NULL`，新列恆不進）回填，每次喚醒不必掃全表。
- 新增覆蓋索引 `idx_offline_bucket(recipient, kind, created_at, expiration, bytes)`，**取代**
  `idx_offline_recipient`（前綴相同；少一個索引＝每次寫入少寫一列）。分桶修剪與加總只讀索引。
- 總量與分桶列數**快取在 store 實例裡**：寫入時加、修剪時減，prune／vanish 作廢後下次重算一次。
  理由不只 CPU：Cloudflare 以「讀取列數」計費（免費層每日 500 萬列），就算走索引，每次寫入都
  `SUM` 一次，滿載的檔案車道 DO 上傳一個 30MB 檔（656 塊 × 數千列）就把一整天的額度讀光。
- 重複寫入同一顆（`INSERT OR IGNORE`）不再重複計入。
- 修剪只看這次寫入落到的那一桶（另一桶的列數沒變）。語意與記憶體版一致，既有測試全綠。

### 6. REQ 的位元組預算：16MB（全站生效）

- `OfflineStore.query(filter, now, maxBytes?)`：只回**最新**、累計 JSON 不超過預算的那幾顆；
  一顆都放不下就回空。SQL 版分兩步——先只讀大小（`bytes` 在覆蓋索引上）算出放得下幾列，再取
  那幾列的 json——結果集從頭到尾不超過預算。排序加 `rowid` 決勝，兩步挑中同一批列。
- `RelayCore` 一個 REQ 的**所有 filter 共用**一份預算（`maxQueryBytes`，預設 `MAX_QUERY_BYTES`
  ＝16MB）——多塞幾個 filter 不能繞過。
- 16MB ≈ 120 顆檔案塊、上萬則聊天；聊天碰不到它。更舊的由客戶端依 NIP-01 以 `until` 分頁取回。

### 7. 錨點設定

`relay/wrangler.toml` 的 `[vars]` 與 `[env.unified.vars]` 都加：

```toml
MAX_FILE_MB = "30"
FILE_LANES = "cindersync,cinder-coffice"
```

`wrangler-vars.test.ts` 釘住：兩個區段都設了、就是這兩條、每一條都在 `APP_LANES`，而且
**有 `MAX_FILE_MB` 就一定要有 `FILE_LANES`**（少了它＝整站開放）。
`wrangler.relay2.toml`（同帳號第二座）照既有做法不帶任何 vars（第二座錨點在另一個帳號、
用主設定部署），因此不需同步；它沒有 `MAX_FILE_MB` ＝ 不收檔案。

## 成本（Cloudflare；依 ADR-0244 的計價與 ADR-0006 的免費額度）

計價：DO SQLite 儲存 $0.20/GB-月（**5GB 免費、帳號層級共用**——主訊息平面也在裡面）、
列寫入 $1／百萬（免費層每日 10 萬）、列讀取 $0.001／百萬（免費層每日 500 萬）、
請求 $0.15／百萬（免費層每日 10 萬；WebSocket 進站訊息以 20:1 計）。**不收 egress 流量費。**

- **儲存天花板（每個帳號）**：兩條檔案車道各一顆獨立 DO（`app:cindersync`、`app:cinder-coffice`），
  各 1GiB ⇒ **最壞 2GiB**，低於 5GB 免費額度且留 3GB 給其他 DO。每位收件人最多佔
  1440 × 131KB ≈ 189MB（最壞 288MB），所以天花板＝ min(配額 × 收件人數, 1GiB) × 2。
  即使帳號其他部分已用滿免費額度，這 2GiB 的邊際成本是 **≤ $0.40／月**。
  ⇒ 與 ADR-0244 估的「天花板隨使用者數成長（5TB、$1000／月）」不同：這裡有與人數無關的硬上限。
- **列寫入（免費層最先撞到的一項）**：每顆塊寫 1 列＋4 個索引項（expiration、pubkey、kind、bucket；
  部分索引對新列不寫）≈ 5 列。一個 30MB 檔送給一位收件人 ≈ 656 × 5 ≈ **3,300 列**。
  免費層每日 10 萬列 ⇒ 約 **30 次「30MB 檔 × 一位收件人」／日／帳號**，而且與主訊息平面共用。
  付費方案下 30MB 檔約 $0.003。
- **列讀取**：有了 §決策 5 的快取，每次寫入只讀常數列（查重 1 列＋超量時要刪的那幾列）；
  每次喚醒各重算一次總量與用到的分桶。REQ 讀 ≤ 1024 列 × 2 步。
- **請求**：656 塊 ÷ 20 ≈ 33 次請求／30MB 檔。

## 與 ADR-0244 的關係

**不取代 ADR-0244。** ADR-0244 談的是 Cinderous **主訊息平面**對一般使用者的公共檔案後備，仍是
提議中、待拍板；本 ADR 在主平面上**一個字都不動**（車道模式下主平面照舊整類拒收，測試釘住）。
這裡定的是「**第三方應用車道**的檔案政策」，而它刻意避開了 ADR-0244 否決選項 1 的每一個理由：

- 不是全站開放：只有列名的兩條車道，各在自己的 DO（ADR-0244 的「單一全域 DO 爆炸半徑」不適用）。
- 不沿用企業預設：配額 1440 塊（企業 4000）、另有每顆 DO 1GiB 的硬天花板。
- 天花板不隨使用者數成長（見〈成本〉）。

ADR-0244 日後若採用，主平面的公共檔案後備可以沿用本 ADR 做好的零件（`filePolicyFor`、
檔案車道配額、查詢預算、儲存層快取），但數字與後端（R2）仍依 0244 另議。

## 後果

- 正面：
  - CinderSync／Cinder Coffice 的 Vault 同步在中繼上能動，單檔 30MB，主平面零變化。
  - 企業自架零變化（沒設 `FILE_LANES` 的行為由回歸測試釘住）。
  - 全站的寫入代價不再隨 DO 資料量成長；一次 REQ 不再能把 DO 撐爆（這兩點對主平面也是修正）。
- 負面／已知殘餘風險：
  - **車道不要求 AUTH（ADR-0366），pubkey 不用錢**：任何人都能往這兩條車道寫檔案塊、指定任意
    `#p`。一條連線每分鐘最多 240 則 × 131KB ≈ 31MB，約 35 分鐘就能把一顆 1GiB 的 DO 填滿，而天花板是
    淘汰制 ⇒ 會擠掉別人還沒領的塊（同步協調器會重新索取，但那需要雙方再上線）。現有的擋法只有
    IP 升級限速與每連線訊息上限；PoW（`APP_LANE_POW`）要等客戶端會挖礦才能開。
  - **客戶端必須分頁**：一位收件人名下超過 16MB（≈120 塊）的積壓，一次 REQ 拿不完，要以 `until`
    分頁。SDK 目前不分頁 ⇒ 離線回來時只拿得到最新的約 120 塊（沒有預算時是直接把 DO 撐爆，所以
    這不是退步，但 30MB 的離線補送要等 SDK 補上分頁才完整）。
  - **每 pubkey 每分鐘 120 則**（ADR-0235 H1）：一個 30MB 檔最快約 5.5 分鐘才送得完。
  - **首次部署的一次性遷移**：每顆既有 DO 第一次喚醒時建 `idx_offline_bucket`、回填 `bytes`，要讀過
    一次整張離線表（主平面舊全域最多約 128MB，估計 1 秒以內），之後不再發生。
- 後續行動／待辦：
  1. **SDK（`cinderous-sdk-dev`，另有代理人在改，本 ADR 不動）**：
     - 收端檔案塊層上限目前是 360 塊（≈16.5MB，`src/sync/ingest.ts`）、`VAULT_SYNC_MAX_FILE_MB = 17`
       ——要真的用到 30MB 得調到 ≥ 656 塊，並改讀 NIP-11 的 `cinder_max_file_mb`。
     - 批次補送速率 `DEFAULT_RELAY_BULK_PER_HOUR = 20` 是以「4000 塊／7 天」設計的（20 × 168 ＝ 3360）；
       本車道配額 1440 ⇒ 連續補送超過 72 小時就會 FIFO 擠掉最舊的塊。應改讀
       `cinder_file_chunks_per_recipient` 與 `retention` 自行算速率（1440 ÷ 168 ≈ 8.5 則／小時）。
     - 訂閱歷史要以 `until` 分頁（§決策 6）；車道上的 `#p` 訂閱須先 AUTH（ADR-0369）。
  2. **PR #9（`claude/relay-on-sdk`，relay 改用 SDK）**：SDK 的 relay（`src/relay/*`）需要同一套功能
     ——`FILE_LANES`／`filePolicyFor`、車道 id 持久化、NIP-11 兩個新欄位、檔案車道配額與 DO 天花板、
     §決策 5 的儲存層前提與 §決策 6 的查詢預算。合併 PR #9 之前要先補齊，否則部署它等於把本 ADR 撤銷
     （錨點會退回「`MAX_FILE_MB` 全站開關」＝選項 1）。本 ADR 不動該分支。
  3. **可尋址表**同樣有 `SUM(LENGTH(json))` 的天花板查詢（ADR-0367）；目前單顆上限小（車道 32KB），
     尚未量到問題，列為觀察。
  4. **（既有，非本 ADR 引入）DO SQLite 每次查詢最多 100 個綁定參數**（Cloudflare Limits 頁）：
     `query()` 把 `authors`（`scoped()` 允許到 1024）、`ids`、`kinds`、標籤值都組成 `IN (…)`，
     超過 100 會讓 `sql.exec()` 拋例外。本地測試用 node:sqlite（上限 32766）看不出來。
     另立修正：filter 陣列合計上限對齊、或分批查詢；上線前以 `wrangler dev` 對 DO 建構子的遷移路徑
     （部分索引、`DROP INDEX`、`rowid`）做一次真實冒煙測試。
     → **已由 ADR-0372 處理**（改用 `json_each(?)`，整串值只佔一個綁定參數；實測另發現 WebSocket
     attachment 16KB 上限，列於 ADR-0372 後續）。
  5. **監看**：兩顆檔案車道 DO 的儲存量、帳號每日列寫入量；逼近免費額度時先收緊 `MAX_FILE_MB`
     （配額跟著縮）或把 `FILE_LANE_OFFLINE_MAX_BYTES` 調小。
