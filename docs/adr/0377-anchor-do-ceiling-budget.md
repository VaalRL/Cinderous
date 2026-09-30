# 0377. 錨點的 DO 天花板有總預算：所有可能 DO 加總 ≤ 免費 5 GB 的 80%，`dochost` 加大

- 狀態：已接受 (Accepted)——2026-09-30 使用者核准；**尚未部署**
- 日期：2026-09-30
- 相關文件：ADR-0006（免費額度）、0241（分片＝爆炸半徑）、0366（車道、已知租戶 `APP_LANES`）、
  0367（見習保存、DO 容量天花板、淘汰制 vs 拒收制）、0371（檔案車道、1 GiB 天花板與成本）、
  0373（`ws_subs` 溢位表）、0375（嚴格平面滿了回 `OK false`）；
  SDK ADR 0036（DocHost 共用 DO 約 64 位重度使用者互擠）、SDK ADR 0039（暫時容量借用，本 ADR 是其 B0／(e1)）；
  `relay/src/host-config.ts`（`DO_CEILINGS_MIB`、`worstCaseStorage`）、`relay/src/shard.ts`（`allDoNames`）、
  `relay/src/worker.ts`、`relay/wrangler.toml`、`relay/src/wrangler-vars.test.ts`

## 背景與問題

兩座官方錨點都在 Cloudflare **免費方案**：DO SQLite 儲存每帳號 5 GB，**超過後整帳號同類操作都失敗**——
不是某條車道寫不進去，而是所有 DO（包括 Cinderous 主訊息平面）一起失敗。

每顆 DO 的天花板（ADR-0367、0371）是寫死的常數，而帳號總量是「天花板 × DO 數」，沒有人設計過這個乘積。
SDK ADR 0039 算出來大約是額度的兩倍：

### 盤點：路由會建立的每一顆 DO 與它的天花板（改動前）

DO 名由 `relay/src/shard.ts` 的 `routeForPath` 決定（worker 以 `idFromName(route.doName)` 取 DO）：

| DO | 路徑 | 顆數 | 天花板（離線＋可尋址） | 程式位置 | 小計 |
|---|---|---|---|---|---|
| `global`（舊全域，嚴格） | `/` | 1 | 128 MiB＋128 MiB | `host-config.ts` `DO_OFFLINE_MAX_BYTES`、`DO_ADDRESSABLE_MAX_BYTES` | 256 MiB |
| `presence`（嚴格） | `/presence` | 1 | 128＋128 | 同上 | 256 MiB |
| `shard-0..f`（嚴格） | `/s/<hex>` | 16（core `SHARD_COUNT`） | 128＋128 | 同上 | 4 GiB |
| `app-0..7`（共用車道分片） | 名單外的 `/app/<id>` | 8（`shard.ts` `APP_LANE_SHARDS`） | 128＋128 | 同上 | 2 GiB |
| `app:<id>`（名單上的一般車道） | `/app/<APP_LANES 上的 id>` | 5（lwd、elementalist、nagd、soleague、dochost） | 128＋128 | 同上 | 1.25 GiB |
| `app:<id>`（檔案車道） | `/app/cindersync`、`/app/cinder-coffice` | 2 | **1 GiB**＋128 | `FILE_LANE_OFFLINE_MAX_BYTES`（`storeOptions` 在 `maxFileMb` 有值時換上） | 2.25 GiB |
| **合計** | | **33** | | | **10 GiB（10,737,418,240 bytes）** |

- 天花板由 `sql-message-store.ts` 的 `fitsOfflineCeiling`（以 `bytes` 欄＝`LENGTH(json)` 計，每位收件人一列）與
  `fitsAddressableCeiling`（`SUM(LENGTH(json))`）執行；嚴格平面拒收、車道淘汰最快到期者（`ceilingEvicts`，ADR-0367 §決策 2）。
- 其他不以天花板計的儲存：SQLite 索引與頁面開銷、`ws_subs`（每連線 512 KiB，連線關閉即刪，ADR-0373）、DO key-value（車道政策、DO 名）。
- 🔴 **名單上的每條車道都是一顆新的 DO**：`APP_LANES` 每多一條，總量就多一份天花板，而這件事沒有任何檢查。

B0 量測（2026-09-30，錨點 1）：實際總用量 **832 KiB**；只有 12 顆 DO 有活動
（`global`、`app:cindersync`、`app:soleague`、`presence`、`app:dochost`、`shard-a`、`app-7`、`app:lwd`、`app:cinder-coffice`、`shard-1`、`shard-f`、`shard-7`），
`app:elementalist`、`app:nagd`、其餘 12 片分片與 7 顆 `app-n` 本月無活動。

另外，`dochost` 的資料是 64 個**全狀態**可尋址桶（每人最多約 2 MB），128 MiB 約 64 位重度使用者就開始互相淘汰（SDK ADR 0036）——它需要**更大**的可尋址天花板。

## 考量的選項

- **A. 把常數整體調小**：一個數字改到底最簡單，但冷門的 `app-n` 與熱門的 `dochost` 被迫用同一個數字，`dochost` 反而要變小。
- **B. 天花板改由 `wrangler.toml` 設定（依類別＋可針對單顆 DO），並以測試守住總預算（採用）**。
- **C. 帳號總量閘**（SDK ADR 0039 (c)／B4：協調 DO 定時回報 `databaseSize`）：真正量實際用量，但要新 DO 類別與 migration，2–3 天；
  靜態預算是它的前提，不是替代品。列為後續。

## 決策

1. **預算＝4,000,000,000 bytes**（`host-config.ts` `ACCOUNT_STORAGE_BUDGET_BYTES`）。
   取十進位：Cloudflare 的「5 GB」不論解讀成 5×10⁹ 還是 5 GiB，4×10⁹（≈ 3.73 GiB）都不超過它的 80%，取保守的那個。
   剩下的 20%（≥ 1 GB）留給天花板不計入的索引、頁面開銷與 `ws_subs`。
2. **新增 `DO_CEILINGS_MIB`**（延伸既有 `APP_LANES`／`FILE_LANES` 的 vars 模式，Fix-First）：
   逗號分隔的 `<對象>=<離線 MiB>/<可尋址 MiB>`，對象是**類別**（`strict`／`public`／`lane`／`file`）或**單顆 DO 名**
   （`global`、`presence`、`shard-a`、`app-3`、`app:dochost`），單顆優先於類別、類別優先於預設。
   - **沒設＝與改動前完全相同**（每顆 128/128 MiB、檔案車道離線 1 GiB）——自架站與 node 宿主不受影響。
   - 設錯的項目（形狀不對、不是 1–8192 的整數、重複、不是路由會建立的 DO、`app:<id>` 不在 `APP_LANES` 上）**不生效**、
     DO 啟動時 `console.warn`；預算測試要求它為空（不生效＝退回較大的預設值，預算就不可信）。
   - 類別由 DO 名決定（`ceilingClassOf`）：`app:<id>` 且在車道模式下收檔案＝`file`，其他 `app:<id>`＝`lane`，`app-n`＝`public`，其餘＝`strict`——
     與 `storeOptions` 換檔案車道天花板是同一個條件。
3. **DO 記住自己的名字**（storage 鍵 `cinder:do-name`）：嚴格平面的 `global`／`presence`／`shard-*` 政策完全相同，
   休眠喚醒時（沒有 fetch）分不出是哪一顆。第一次連線時記下；升級前就存在的 DO 在下一次連線補記並換成自己的天花板（與 ADR-0371 補記車道 id 同一個做法）。
   DO 名在 `idFromName` 時就決定、一輩子不變，存下來不會過時。
4. **守門測試**：`wrangler-vars.test.ts` 依 `wrangler.toml` 兩份 vars、以**執行時同一個函式**（`doCeilingFor`）算出
   `allDoNames(APP_LANES)` 每一顆 DO 的天花板加總，超過預算就變紅，錯誤訊息列出每顆 DO 的數字、每條新車道的成本與調整方式。
   `shard.test.ts` 以大量路徑反查 `routeForPath`，確認路由出來的每個 DO 名都在 `allDoNames` 上、清單上每一顆也真的有路徑會打到（不多算也不少算）。
5. **錨點的分配**（`relay/wrangler.toml`，2026-09-30 使用者決定）：

   | DO | 顆數 | 離線／可尋址（MiB） | 小計（MiB） | 理由 |
   |---|---|---|---|---|
   | `global` | 1 | 64／64 | 128 | 最低版本閘前的舊客戶端仍走這裡，B0 最活躍 |
   | `presence` | 1 | 16／16 | 32 | 客戶端只送 ephemeral 心跳（不落地）；持久化事件在這裡本來就是誤用 |
   | `shard-a`、`shard-1`、`shard-f`、`shard-7` | 4 | 96／64 | 640 | B0 有活動的分片 |
   | 其餘 12 片（`strict` 類別） | 12 | 24／24 | 576 | B0 無活動；新使用者落進來時仍容得下數十位收件人的完整佇列 |
   | `app-0..7`（`public`） | 8 | 16／16 | 256 | 陌生應用、見習保存 2 小時（ADR-0367），穩態水位低 |
   | `lwd`、`elementalist`、`nagd`、`soleague`（`lane`） | 4 | 32／32 | 256 | 遊戲的牌組／房間事件以 KB 計 |
   | `app:dochost` | 1 | 64／**512** | 576 | 全狀態可尋址桶（SDK ADR 0036）：約 256 位重度使用者才開始互擠（原 128 MiB 約 64 位） |
   | `cindersync`、`cinder-coffice`（`file`） | 2 | **512**／32 | 1088 | 檔案塊；見〈後果〉 |
   | **合計** | **33** | | **3552 MiB＝3,724,541,952 bytes（≈ 3.47 GiB）** | 預算的 93.1%；餘裕 262.7 MiB |

   **每多一條已知租戶車道＝多一顆 DO＋`lane` 一份（64 MiB）**：目前還能再加 4 條，第 5 條會讓測試變紅，要先調降別處。
6. **淘汰制與拒收制不變**：嚴格平面仍只拒收（`OK false "blocked: ceiling: …"`，ADR-0375），車道仍淘汰最快到期者。本 ADR 只改數字與數字的來源。

## 與 SDK ADR 0039 的對應

SDK ADR 0039（提議中）的建議方案第 1 步是「(e1) 先依實測調整天花板；`dochost` 等熱門車道的天花板改成依車道設定」，
分階段表的 **B0** 是「量測＋`storeOptions` 支援每條車道不同的天花板＋部署」。本 ADR 是錨點這一側的 B0／(e1)：

- 它的〈研究結果一〉第 2 點（「沒有任何一條政策保證帳號總量低於 5 GB」）由本 ADR 的靜態預算與守門測試回答——**以政策上界而言**；
  實際 `databaseSize` 的閘門仍是它的 (c)／B4，不在本 ADR。
- 它的 (b) 溢位帶（B1）會把每顆 DO 的最壞儲存乘上 1 + r：做 B1 時，`worstCaseStorage` 要把溢位帶算進去，否則這裡的預算就是假的。
- SDK 中繼（`@cinderous/client/relay`）目前仍是寫死常數。錨點若經 PR #9 改用 SDK 中繼，`DO_CEILINGS_MIB` 與守門測試要一起搬過去（或在 SDK 做同一件事），否則合併後會退回 10 GiB。
- 本 ADR **不修改** SDK repo。

## 理由

- 預算要守的是**帳號**，所以守門的單位必須是「所有可能 DO」，而不是任何一顆；把它放在測試裡，是因為 `APP_LANES` 的每一次變更都經過 PR。
- 單顆 DO 名的覆寫讓冷熱分配成為可能（冷門的 12 片分片與 7 顆 `app-n` 佔了原本總量的一半以上），而且日後改分配只是改 vars、重新部署。
- 預設值不變：`DO_CEILINGS_MIB` 是錨點的選擇，自架站（尤其付費方案）沒有理由被迫跟著縮。

## 後果

- 正面：錨點的天花板最壞加總從 10 GiB 降到 3.47 GiB，第一次有東西守著帳號總量；新增車道超出預算時 PR 就變紅；`dochost` 的可尋址空間變成 4 倍。
- 對使用者的影響（依目前用量，**部署當下沒有任何資料會被刪或拒收**：B0 總用量 832 KiB，最小的天花板 16 MiB）：
  - **檔案車道 1 GiB → 512 MiB**：單檔上限（30 MB）與每收件人 1440 塊都不變。一個 30 MB 檔在中繼上約 86 MB（656 塊 × 131 KB），
    一位收件人的整份配額約 189 MB（最壞 288 MB）。512 MiB ≈ 同時待領的 6 個上限大小檔、或 2.8 位收件人的整份配額（原本 5.6 位）。
    超過時車道**淘汰最快到期的塊**，那個檔案就要重送——同步外掛會看到重傳變多，而不是錯誤。ADR-0371 §決策 4「容得下三位收件人的最壞配額」不再成立；
    守門測試改守「至少容得下一位收件人的最壞配額」。
  - **嚴格平面冷門分片 24/24 MiB**：一則 Gift Wrap 約 1.5–4 KB，每收件人最多 500 則（約 2 MB）⇒ 一片容得下十幾到數十位收件人塞滿的佇列；
    雲端快照（ADR-0071）每人約 1.25 MB ⇒ 約 19 人。滿了回 `OK false "blocked: ceiling:"`（看得見、外送匣會重試）。使用者成長時改 vars 即可。
  - `lane` 32/32 MiB：遊戲牌組約 2 KB；一個作者可尋址上限 8 MB，最多 4 位作者用滿就會開始淘汰——目前沒有這種用量。
- 調低天花板不會搬資料也不會立即刪除：拒收制的 DO 在降到天花板以下之前寫不進；淘汰制的 DO 在下一筆寫入時淘汰（每次最多 256 列，
  超出太多時那一筆寫入會先被拒，連續幾次才降到天花板以下）。以目前用量兩者都不會發生。
- 負面／已知殘餘風險：
  - 🔴 **預算是政策上界，不是實際用量**：天花板只算 `LENGTH(json)`。小事件的每列索引開銷（主鍵 `(id, recipient)`、`idx_offline_bucket`、pubkey／kind 索引，約數百 bytes）
    相對比例高；若有人用極小的事件塞滿天花板，實際 `databaseSize` 可能超過 20% 的餘裕。真正的閘門是 SDK ADR 0039 的 B4（量 `databaseSize`）。
  - 嚴格 DO 每次喚醒多組一次 store（知道 DO 名後要換成自己的天花板）——與車道 DO 原本就付的成本相同（幾條 `CREATE … IF NOT EXISTS` 與有索引的 `UPDATE`）。
  - `wrangler.relay2.toml`（同帳號第二座的舊範本）沒有任何 vars，照舊是預設天花板；兩座錨點都用 `wrangler.toml`，不受影響。
  - 以 B0 的冷熱分配分片會洩漏「目前有使用者的 pubkey 前綴」這種 1/16 粒度的資訊；分片本來就公開於 URL，影響可忽略。
- 後續行動／待辦：
  - 部署（需使用者另行同意）：先記兩座的回滾點；錨點 2 在另一個 CF 帳號，要 `CLOUDFLARE_ACCOUNT_ID` 並以 `wrangler.toml`＋`--env=""` 部署。
  - 部署後各量一次 `databaseSize`，校正 `LENGTH(json)` 與實際大小的比例（SDK ADR 0039 B0 的另一半）。
  - SDK ADR 0039 B4（帳號總量閘）；B1 溢位帶上線時把溢位帶算進 `worstCaseStorage`。
  - PR #9（改用 SDK 中繼）合併前，確認 `DO_CEILINGS_MIB` 在 SDK 中繼也有等價的設定與守門。
