# 0379. 錨點中繼移植 SDK 的容量功能：開粗分級預警與丟棄計數，溢位帶與保底先不開

- 狀態：已接受 (Accepted)——2026-10-01 使用者核准；**尚未部署**（PR 不合併、不部署，部署另需同意）
- 日期：2026-10-01
- 相關文件：ADR-0367（淘汰制 vs 拒收制）、0371（檔案車道）、0375（嚴格平面滿了回 `OK false`）、
  0376（拒收詞元）、**0377**（`DO_CEILINGS_MIB`、`cinder:do-name`、帳號預算守門）；
  SDK（cinderous-sdk-dev 6c36ebd，v0.34.0）ADR 0038（P2：保底、粗分級預警、M8 丟棄計數）、0039（B1 溢位帶）、
  0040（詞元表）、0041（`warning: borrowed:` 非耐久）、**0042**（本 ADR 的移植基準與 11 項清單）；
  `relay/src/capacity.ts`、`message-store.ts`、`sql-message-store.ts`、`relay-core.ts`、`reject-messages.ts`、
  `host-config.ts`、`worker.ts`、`nip11.ts`、`relay/wrangler.toml`、`relay/src/wrangler-vars.test.ts`、
  `packages/engine/src/backend/relay-capacity-compat.test.ts`

## 背景與問題

SDK v0.34.0（ADR 0042）把共用 DO 的容量政策做完：每顆 DO 的天花板設定（Cinderous ADR-0377 移植回 SDK）、保底份額、
溢位帶（天花板之上借用 2 小時）、粗分級預警（`OK true "warning: near-full: …"`）、每收件人丟棄計數
（讀收件匣時 EOSE 前的 `NOTICE "warning: dropped: …"`），全部**預設關閉**，並寫了給錨點的 11 項移植清單。

兩個理由要現在移植到錨點：

1. **PR #9（錨點改跑 SDK 中繼）**：兩邊的程式、句子、詞元、DO SQLite schema 必須逐字相同，切換時客戶端看到的與 DO 裡的資料才不必再變一次。
2. 錨點目前滿了只有兩種後果：嚴格平面「看得見的 `blocked: ceiling:`」、車道「別人成功後默默被擠掉」；
   收件人完全不知道「有 N 則在中繼上、還沒送到就被刪了」。預警與丟棄計數讓兩種情況第一次被說出來。

🔴 硬限制：**App v0.0.18 已上線**（engine／core 與 origin/main 相同：`git diff v0.0.18` 在這兩個套件只多了 core 的 PoW），
新中繼行為不能讓它壞。

## 考量的選項

- 選項 A：只移植程式，`wrangler.toml` 什麼都不開——PR #9 一致，但錨點拿不到任何新訊號。
- 選項 B：照 SDK ADR 0042 清單第 9 項的建議全開（溢位帶 `strict=25`、預警、丟棄計數）。
- 選項 C（採用）：移植全部程式；錨點**只開預警與丟棄計數**，溢位帶與保底等前置條件滿足再開。

## 決策

### 1. 移植（照 SDK ADR 0042 清單，逐字）

| SDK 清單 | 錨點 | 備註 |
|---|---|---|
| 1 `capacity.ts` | 整檔搬 | 位元組相同 |
| 2 `message-store.ts` | 7 個選項、`OfflinePutResult`、選用欄位與 4 個選用方法、`MessageStore` | 與 SDK v0.34.0 只差 import 路徑（`@cinderous/core`）與 ADR 編號的註解 |
| 3 `sql-message-store.ts` | 遷移、快取、`putResult`／`placeOffline`／`recordDrops`／`takeDropped`／`markDelivered`、`prune`／`vanish`／`enforceCap` | 同上；錨點多保留原本的 `MAX_QUERY_ROWS` import |
| 4 `relay-core.ts` | 收件匣追蹤、`setInboxProbe`、EOSE 前的 `NOTICE`、`admit` 的 `note`、`readsOwnInbox`／`okNote` | 同上 |
| 5 `reject-messages.ts` | `borrowedWarning`、`nearFullWarning`、`droppedNotice` | **句子逐字相同**（`reject-messages.test.ts` 釘住） |
| 6 `host-config.ts` | `KIB`、`DO_CAPACITY_LIMITS`、`CeilingEnv` 4 個變數、`doCapacitySettings`、`DoCapacity`、`doCapacityFor`、`borrowingPlanes`、`worstCaseBytes`、`computeCeilingBudget`；`worstCaseStorage` 含溢位帶；`storeOptions` 第 5 參數接 `DoCeiling \| DoCapacity` | ADR-0377 的那一段整段換成 SDK 的（同名同義） |
| 7 `worker.ts` | `Env` 4 個變數、啟動時 `doCapacitySettings(env).ignored` 警告、`buildCore` 用 `doCapacityFor`、`relayInfoFrom` 第 5 參數 `doName` | DO 名那段（ADR-0377）本來就相同 |
| 8 `nip11.ts` | `capacity` 與 `cinder_ceiling_policy`、`cinder_ceiling_bytes`（一律出現）及設了才出現的欄位 | |
| 9 `wrangler.toml` | 見決策 2（**與 SDK 建議不同**：溢位帶不開） | |
| 10 測試 | `capacity`／`capacity-core`／`ceiling-budget`／`capacity-compat`／`schema-compat`、`worker.test.ts`〈容量設定與 DO 名〉 | 見下 |
| 11 部署前後 | 見〈後果〉的部署注意 | |

測試的差異：
- `capacity-core.test.ts`：SDK 版用客戶端的 `classifyRelayMessage`／`parse*`（錨點沒有依賴 `@cinderous/client`），
  改成以同一個形狀的正規式解析，並多一條「App v0.0.18 的 `classifyOk` 把 `OK true` 的 warning 判成送達」。
- `capacity-compat.test.ts`：對照組從 SDK v0.33.0 換成**移植前的錨點 store 原樣**
  （`relay/src/fixtures/main-22e3860c-stores.mjs`，`gen-main-stores.mjs` 從 origin/main 22e3860c 打包）——沒設任何新選項時，
  400 則混合寫入 × 3 變體 × 3 種子，每一則結果與每 25 則的庫存都相同；新版遷移過的 DB 交給移植前的程式照常讀寫（回滾路徑）。
- `schema-compat.test.ts`（新）：移植前的建構子建出來的 schema、升上來不丟例外且冪等、從零建的＝移植前的＋SDK ADR 0042 §8 的六條（**逐字抄自 SDK**），
  所以錨點與 SDK 中繼從零建的 schema 相同，PR #9 切換不必再遷移。

### 2. 錨點設定（`relay/wrangler.toml` 兩份 vars）

| 變數 | 值 | 狀態 |
|---|---|---|
| `DO_NEAR_FULL_PERCENT` | `strict=80,lane=80,file=80` | ✅ 開 |
| `DO_DROP_NOTICES` | `strict,file` | ✅ 開 |
| `DO_BORROW_PERCENT` | （不設） | ❌ 先不開 |
| `DO_GUARANTEE_KIB` | （不設） | ❌ 先不開 |

- **預警**開在嚴格平面、名單上的車道與檔案車道；共用分片（陌生應用、見習保存 2 小時）不開。只有兩級（80 與 95），不回精確百分比。
- **丟棄計數**開在嚴格平面（私訊收件匣）與檔案車道（Vault 同步的檔案塊有收件人）。一般車道不開：遊戲房間事件多半沒有收件人、
  dochost 是可尋址（作者用讀回稽核，SDK ADR 0041），計數沒有對象。
- **溢位帶不開**：App v0.0.18 不認得 `warning: borrowed:`，只看 `OK` 的布林——借用會被當成送達（`sent`），
  收件人 2 小時內沒上線，訊息就無聲消失。這比 ADR-0375 之後「看得到的 `blocked: ceiling:`」（App 標紅、可重試）更糟。
  `relay-capacity-compat.test.ts` 最後一段以真的 engine 證明了這一點。
- **保底不開**：保底把「別人成功後被擠掉」變成「超出保底的人被拒或只借得到 2 小時」，要客戶端接得住（SDK ADR 0038 P1：拒收後補到備援中繼），
  第三方車道的客戶端還沒全部採用。**車道的溢位帶也因此不開**：依 SDK 設計，淘汰制要同時有保底溢位帶才生效（沒有保底時淘汰制本來就收下每一則，帶子沒有好處）。
- **預算**：預警與丟棄計數不改變最壞儲存量，`computeCeilingBudget` 以兩份 vars 的全部容量設定重算＝3,724,541,952 bytes（與 ADR-0377 的表逐位元相同），≤ 4,000,000,000。
  `inbox_drops` 表不計入天花板：每顆 DO 最多 10,000 位收件人（每列一個 hex 公鑰＋四個整數），在 ADR-0377 留的 20% 裡。

### 3. App v0.0.18 相容性（結論：不會壞）

逐一檢查 `packages/core`、`packages/engine` 收到新訊息的路徑：

1. **`OK true` 附非空訊息**：`RelayClient.receive` 把 `msg[3]` 原樣交給 `onOk`；engine 的 `onOk` 先交外送匣 `classifyOk`
   （`accepted` 為真就是 `confirmed`，不看訊息），再 `markSent`。配對信令（`pairing-transport`）只在 `!accepted` 時看訊息。
   探測（`relay-probe`）只看 `m[0] === "OK"` 與 id。⇒ 判為送達、不報錯。
2. **未知內容的 `NOTICE`（EOSE 之前）**：`RelayClient` 只轉給 `onNotice`，engine 與配對信令**都沒有註冊 `onNotice`**，也都沒有註冊 `onEose`；
   探測與一鍵部署驗證（`cf-deploy`）各自解析，只認 `EOSE`／`OK`／`AUTH`。⇒ 被忽略；訂閱與回放不受影響。
3. **NIP-11 多出的欄位**：App 只在 `relay-info.ts` 讀 NIP-11，只取 `cinder_donations` 與 `name`。⇒ 無害。

`packages/engine/src/backend/relay-capacity-compat.test.ts` 以**真的** `RelayChatBackend` 接**真的** `RelayCore`＋開了容量選項的 `MessageStore`
（NIP-42 AUTH 開著）證明：預警下每一則都是 `sent`、沒有 `failed`、外送匣不報「未送達」、收件人上線全部收到；
`warning: dropped:` 在 EOSE 之前送達、回放照常、之後的即時訊息照常收到；多了容量欄位的 NIP-11 解析結果不變。
（記憶體網路是同步的，測試讓 relay 的訊息在 engine 建構完、`start` 之後才交付，與真的 WebSocket 相同。）

第三方客戶端：SDK ≤ v0.33 對 `OK true` 一律當成功；`warning: dropped:` 的 `NOTICE` 走 `onRelayProblem`（記錄），
前綴 `warning` 不在拒收表裡，不算拒收（SDK v0.33 `classifyRelayMessage` 回 `unknown`）。SDK v0.34 起有 `onRelayDropped` 與健康狀態的 `nearFull` 軟標記。

### 4. 開啟溢位帶與保底的前置條件

- **嚴格平面的溢位帶**（`DO_BORROW_PERCENT = "strict=25"`）：App 發版，認得 `warning: borrowed:`——借用收下算即時送達、**不算耐久收下**，
  補一份到備援中繼（SDK ADR 0041 的語意）；而且那一版在使用者裝置上**普及**（v0.0.18 及更早版本仍會把借用當成送達）。
  開之前要改 `wrangler-vars.test.ts`〈哪些先不開〉，並以 `computeCeilingBudget` 重算（`strict=25` 是 3740 MiB，仍在預算內）。
- **保底**（`DO_GUARANTEE_KIB = "lane=2048"` 之類）：使用那些車道的客戶端都完成 SDK ADR 0038 P1（拒收後補到其他中繼）；
  保底開了之後，車道的溢位帶才有意義（同時要設保底才生效）。

## 理由

- 移植全部程式（不只開的那兩項）：PR #9 的切換條件是兩邊逐字相同；schema 遷移不論設定開不開都跑，之後打開設定不必再遷移、不必再部署程式。
- 只開「不改變送達語意」的兩項：預警是 `OK true`（收下了、耐久）、丟棄計數是 `NOTICE`（NIP-01 客戶端只記錄或顯示）。
  兩者對 v0.0.18 都是「多一段沒人看的文字」，對 SDK v0.34 客戶端是新的訊號。
- 溢位帶與保底都會改變「收下」的意義（只存 2 小時、或改成拒收），必須等客戶端接得住。

## 後果

- 正面：
  - 錨點與 SDK 中繼（v0.34.0）的容量程式、句子、詞元、schema 一致，PR #9 合併後不會退回 10 GiB、也不必再遷移一次。
  - 寫入者第一次知道「這類資料快滿了」（兩級），收件人第一次知道「有 N 則在這座中繼上、送到之前就被刪了」（只有數量與時間範圍）。
  - 設錯的容量項目啟動時 `console.warn`，守門測試要求兩份 vars 的 `doCapacitySettings(v).ignored` 為空。
- 負面 / 已知殘餘風險：
  - 對寫入者透露這顆 DO 的粗略用量分級；對收件人透露本人有幾則被刪（SDK ADR 0042 已接受）。
  - 開了丟棄計數的 DO：每次讀收件匣多 1 讀＋1 寫、每次收件匣訂閱結束多 1 寫、每批被刪的列按收件人各 1 讀＋1 寫（DO SQLite 的列讀寫次數，免費方案有每日上限）。
  - 共用車道（淘汰制）一旦滿了會一直帶 `near-full: 95`——它本來就是滿的，這是事實，不是故障。
  - 計數的殘餘：多裝置以公鑰計（一台讀了就歸零）；rowid 重用、REQ 被 1024 列／16 MB 截斷時少算（SDK ADR 0042 §5）。
  - App v0.0.18 不顯示這兩個訊號——要讓使用者看到，要等 App 發版。
- 部署注意（不在這個 PR 做）：
  - 先記兩座的回滾點（`wrangler deployments list`）；錨點 2 在另一個 Cloudflare 帳號，部署要帶 `CLOUDFLARE_ACCOUNT_ID`，用 `wrangler.toml`＋`--env=""`（`npx wrangler@4`）。
  - 部署後每顆 DO **第一次喚醒**會跑遷移（兩個 `ADD COLUMN`、兩個部分索引、一張表，都是 `IF NOT EXISTS`／吞掉「欄位已存在」，SQLite 不重寫表），之後每次喚醒冪等；量一次 `databaseSize`。
  - 回滾到移植前的程式：舊的 `INSERT` 不帶 `borrowed`（預設 0）、新表不碰，`capacity-compat.test.ts` 驗證過。
- 後續行動 / 待辦：App 認得 `warning: borrowed:`／`near-full:`／`dropped:` 並發版 → 依決策 4 開溢位帶；各車道客戶端完成 P1 → 開保底。
