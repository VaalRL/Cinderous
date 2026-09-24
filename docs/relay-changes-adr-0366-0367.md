# Relay 修改前後對照：第三方應用車道與見習保存（ADR-0366／0367）

> 範圍：PR #6（merge commit `e7de3e3f`）對 `relay/` 與 `packages/core` 的全部行為變更。
> 基準：**修改前＝`e7de3e3f^1`**（合併前的 main）；**修改後＝`e7de3e3f`**。
> 決策理由不在本文重複，請看 [ADR-0366](./adr/0366-third-party-app-lane.md)、
> [ADR-0367](./adr/0367-probation-retention-and-do-ceiling.md) 與
> [`research/game-layer-spec.md`](./research/game-layer-spec.md) §十。
>
> 🔴 **「修改前」就是目前的線上狀態。** 兩座錨點（`cinder-relay.cinderous1` / `.jt0856`）
> 的 NIP-11 自報 `version: 0.0.15`，但已含 ADR-0089 的贊助欄位；經比對，線上部署點
> （≥ `8074c162`）與合併前 main 之間，`relay/src` 與 `wrangler.toml` 只差
> `version.ts` 的版號字串（三個 release commit）。⇒ 本文「修改前」一欄可直接當作線上行為讀。

---

## 〇、一頁摘要

| 面向 | 修改前（線上現況） | 修改後 |
| --- | --- | --- |
| 路由 | `/s/<hex>`、`/presence`，**其他一律落舊全域 DO** | 另加 `/app/<laneId>`；**認不得的路徑拒絕**（送 NOTICE 附文件網址後關閉，ADR-0368） |
| 政策 | 所有 DO 同一套（嚴格，`requireAuth: true`） | 兩份政策：`strict`（不變）／`app`（第三方車道）；每顆 DO 釘住一種 |
| 訂閱形狀 | 必須帶 `#p`（自己）或 `authors`（ADR-0123） | 嚴格不變；車道另接受「任一非 `#p` 標籤」filter |
| 可尋址讀取閘 | 整個 30000–39999 只回作者 | 只有 `30078`（雲端快照）只回作者 |
| 每連線訊息上限 | 無 | **240 則／分**，超過即 NOTICE ＋ 關線（**兩個平面都套**） |
| 車道升級限速 | 無 | 以 IP 計，30 次／分（`APP_LANE_LIMIT`），只套車道 |
| 可尋址配額 | 5 位址／(作者, kind)、256KB／顆 | 嚴格不變；車道 64（已知租戶）／16（公用），32KB／顆 |
| 每作者可尋址總量 | 無 | 嚴格 8MB、已知租戶 8MB、公用 2MB |
| DO 容量天花板 | 無 | 可尋址 128MB、離線留言 128MB／DO；車道淘汰、嚴格拒收 |
| `recipient = ''` 桶 | **無任何上限**（只有 TTL） | 納入離線留言天花板 |
| 保存期 | 留言 ≤ 7 天（可設）、可尋址 30 天 | 嚴格與已知租戶不變；**公用分片兩者皆 2 小時** |
| tag 查詢 | 先 `LIMIT` 再在 JS 過濾（會回空集合） | tag 條件下推 SQL |
| NIP-11 | 單一份、`auth_required` 寫死 | 依路徑回文件；新增時鐘窗、訂閱政策、可尋址 TTL 欄位 |
| PoW | 嚴格恆 0 | 不變；車道可由 `APP_LANE_POW` 開（預設 0） |
| node-relay | 單一 profile | 仍單一 profile、明示恆為嚴格；補上訊息上限 |

---

## 一、路由（`shard.ts`、`worker.ts`）

### 修改前

```ts
shardNameForPath(pathname): string
  /s/<hex>    → shard-<hex>
  /presence   → presence 層
  其他（含 /）→ LEGACY_GLOBAL_NAME   // catch-all
```

- 回傳值只有 DO 名，沒有政策；每顆 DO 的 `RelayCore` 都寫死 `requireAuth: true`。
- `/s/zz`、`/s/ab`、`/anything`、`/app/xxx` 全部**靜默落進舊全域 DO**，套嚴格政策。

### 修改後

```ts
routeForPath(pathname, knownLanes): RelayRoute | undefined
  / 或 ""           → { strict, "global" }         // ADR-0241 舊客戶端回退，保留
  /s/<hex>          → { strict, "shard-<hex>" }
  /presence         → { strict, presence 層 }
  /app/<laneId>     → 名單上：{ app, "app:<laneId>", known: true }
                      不在名單：{ app, "app-<fnv1a(laneId) % 8>", known: false }
  其他              → undefined ⇒ worker 回 404 "unknown relay path"
```

- `laneId` 形狀：`^[a-z0-9][a-z0-9._-]{0,63}$`（先轉小寫）；不合法**直接拒絕**，不清洗。
- 尾斜線容忍（`/s/a/`、`/app/lwd/` 視同無斜線）。
- 已知租戶用 `app:<id>`（冒號）命名，與雜湊分片 `app-<n>` 的命名空間不可能相撞。
- 雜湊分片數 `APP_LANE_SHARDS = 8`：取模是為了上界，否則亂數 id 可生出無數冷 DO。
- **名單不是白名單**：不在 `APP_LANES` 的車道照常服務，只是共用雜湊分片、配額較保守。
- 404 只發生在 **WebSocket 升級**請求；非升級的 HTTP GET（健康檢查、NIP-11）不受影響。
- ⚠ **後續變更（ADR-0368）**：404 與車道限速的 429 改為「接受、送一則 `NOTICE`、以 1008 關閉」，
  關閉原因與 NOTICE 都附官網開發者文件網址；仍不碰任何 DO。

### DO 端的政策釘選（`RelayRoom`）

| | 修改前 | 修改後 |
| --- | --- | --- |
| 政策來源 | 建構子寫死 | 首次 `fetch` 用**同一個** `routeForPath` 算出，寫入 DO storage |
| storage 新鍵 | — | `cinder:lane-profile`（`strict`／`app`）、`cinder:lane-known`（bool） |
| 休眠喚醒後 | — | 先以 `strict` 組 core，再從 storage 還原 |
| 同一顆 DO 收到不同政策的請求 | 不可能發生 | **409 `lane profile mismatch`**，不切換 |
| `fetch` 簽章 | 同步 | `async`（要寫 storage） |

> 既有 DO（`global`、`shard-*`、presence）部署後第一次被連線時會釘成 `strict`，
> 與它們原本的行為一致；車道 DO 全是新名字，不會與既有 DO 衝突。

---

## 二、政策（`host-config.ts`、`relay-core.ts`）

### 兩份 profile

```ts
guardFor("strict") = { requireAuth: true, ...ABUSE_GUARD }          // 與修改前等價＋訊息上限
guardFor("app")    = { ...ABUSE_GUARD, publicLane: true, requireAuth: false }
```

- 兩座宿主（worker、node-relay）都從 `guardFor` 取政策，不各自組裝。
- 車道**只放寬訂閱形狀與認證**；事件大小、tag 數、時鐘窗、訂閱數、事件速率全部同嚴格。

### 訂閱形狀 `scoped()`

| filter | 修改前（全站） | 修改後：嚴格 | 修改後：車道 |
| --- | --- | --- | --- |
| `{"#p":[自己]}` | ✅ | ✅ | ✅ |
| `{"#p":[別人]}` | ❌ | ❌ | ❌（刻意保留） |
| `{"authors":[…]}` | ✅ | ✅ | ✅ |
| `{"kinds":[31081],"#d":["deck"]}` | ❌ | ❌ | ✅ |
| `{"kinds":[20000],"#t":["lobby"]}` | ❌ | ❌ | ✅ |
| `{"#t":[]}`（空陣列） | ❌ | ❌ | ❌ |
| `{"kinds":[…]}`／`{}` | ❌ | ❌ | ❌ |

拒絕訊息也分開：車道回 `restricted: 訂閱必須指定標籤、#p（自己）或 authors（ADR-0366）`。

> 🔴 **更正（2026-09-24，ADR-0369）**：上表「車道」一欄是 ADR-0366 的**設計**，但 PR #6 的程式碼
> 並未做到——範圍檢查只在 `requireAuth` 時執行，而上線車道是 `requireAuth: false`，
> 所以在 `e7de3e3f` 上車道**不檢查任何訂閱範圍**（裸 filter 與別人的 `#p` 都放行）。
> ADR-0369 修正：範圍檢查改為 `requireAuth || publicLane`，車道另發**可選** AUTH 挑戰，
> 讓 `#p`（自己）在 AUTH 後可用；車道拒絕訊息改為英文。兩者都在部署前完成。

### 可尋址讀取閘（ADR-0071）

| | 修改前 | 修改後 |
| --- | --- | --- |
| 判斷函式 | `isAddressableKind(kind)`（30000–39999） | `isAuthorOnlyKind(kind)`（僅 `30078`） |
| 生效條件 | `requireAuth` 時，查詢與即時扇出都閘 | 同左 |

- 對 **Cinderous 本身零影響**：全 repo 唯一使用的可尋址 kind 就是 `SNAPSHOT_KIND = 30078`
  （已 grep `packages/`、`apps/` 確認）。
- 對嚴格平面上的**第三方可尋址事件**：修改前只有作者讀得到，修改後同一座嚴格 DO 內
  帶 `authors` 的查詢也讀得到（嚴格平面仍要求具名訂閱，所以不會變成消防水管）。
- 車道 `requireAuth: false` ⇒ 閘門整個不生效；但車道 DO 內沒有任何 Cinderous 快照。

### 每連線訊息上限（新增，兩個平面都套）

| | 修改前 | 修改後 |
| --- | --- | --- |
| 事件速率 | 120 EVENT／分／pubkey | 不變 |
| 訊息速率 | 無 | **240 則／分／連線**（任何訊息：REQ、CLOSE、EVENT、AUTH…） |
| 超限行為 | — | 回 `NOTICE rate-limited…` 後**伺服端關線**（close code 1008） |
| 檢查時機 | — | `handle()` 最前面，在 JSON.parse 與長度檢查之前 |
| 窗型 | — | 固定 60 秒窗（與事件速率同一套，理由：DO 休眠會清記憶體） |

- `Outbound` 新增 `close?: true`；worker 與 node-relay 的 `dispatch` 看到就關線。
- 不變量：訊息上限必須 > 事件上限（測試釘死），否則等於偷偷把事件上限改小。
- ⚠ **這是本批唯一會碰到 Cinderous 客戶端的新限制**，見 §九。

### 車道升級限速（新增，只套車道）

- worker 在選 DO **之前**：`route.profile === "app"` 且有 `APP_LANE_LIMIT` binding 且有
  `CF-Connecting-IP` ⇒ 以 IP 為 key 限速，超過回 **429**。
- 缺 `CF-Connecting-IP`（不在 CF 後面）⇒ 不限，避免全站共用一個桶。
- 嚴格平面刻意不套（行動網路共用 IP 會讓一整群使用者共用同一桶）。

---

## 三、儲存（`message-store.ts`、`sql-message-store.ts`）

### 新增的 `MessageStoreOptions`

| 選項 | 預設（未設） | 用途 |
| --- | --- | --- |
| `addressablePerAuthor` | 5 | 每 (pubkey, kind) 位址數 |
| `addressableTtlSeconds` | 30 天 | 可尋址壽命 |
| `addressableMaxBytes` | 256KB | 單顆可尋址大小 |
| `addressableBytesPerAuthor` | 不限 | 每作者跨 kind 總位元組（取代既有位址時算差額） |
| `addressableMaxTotalBytes` | 不限 | 整顆 DO 可尋址天花板 |
| `offlineMaxTotalBytes` | 不限 | 整顆 DO 離線留言天花板 |
| `ceilingEvicts` | false | 撞天花板時：true＝淘汰最快到期者；false＝拒收 |

### 三種 DO 實際套用的值（`storeOptions(maxTtlDays, profile, knownLane)`）

| 參數 | 修改前（全部 DO） | 嚴格（`global`／`shard-*`／presence） | 已知租戶（`app:lwd` 等） | 公用分片（`app-0..7`） |
| --- | --- | --- | --- | --- |
| 離線留言 TTL 上限 | 7 天（或 `MAX_TTL_DAYS`） | 同左 | 同左 | **2 小時** |
| 每收件人 FIFO | 500 | 500 | 500 | 500 |
| 可尋址 TTL | 30 天 | 30 天 | 30 天 | **2 小時** |
| 位址數／(作者, kind) | 5 | 5 | **64** | **16** |
| 單顆可尋址 | 256KB | 256KB | **32KB** | **32KB** |
| 每作者可尋址總量 | 不限 | **8MB** | **8MB** | **2MB** |
| DO 可尋址天花板 | 不限 | **128MB，拒收** | **128MB，淘汰** | **128MB，淘汰** |
| DO 離線留言天花板 | 不限 | **128MB，拒收** | **128MB，淘汰** | **128MB，淘汰** |

- 可尋址每次更新都會刷新到期時間，所以 2 小時是「**持續更新才留著**」，不是硬性 2 小時後刪。
- 公用分片的 TTL 取「站方上限」與 2 小時的較小者，站方上限恆為權威（ADR-0160）。

### 天花板的實作細節

- 每次寫入跑一次 `SELECT SUM(LENGTH(json))`；未達上限不做其他事。
- 淘汰：`ORDER BY expiration ASC LIMIT 256`，逐列刪到放得下為止；一次最多刪 256 列，
  仍放不下就拒收。
- 單顆事件本身 > 天花板 ⇒ 直接拒收（否則會把整顆 DO 淘汰到空）。
- 離線留言照「列」算：一則事件在每位收件人底下各一列，無 `p` 者一列（`recipient = ''`）。
- 記憶體版與 SQL 版行為一致，有比對「接受與否＋倖存者名單」的測試。
- ⚠ 大小用 `JSON.stringify().length`／`LENGTH(json)`，兩者都是**字元數**不是位元組數；
  以中文為主的內容實際佔用會略大於名目值。

### `recipient = ''` 破口

| | 修改前 | 修改後 |
| --- | --- | --- |
| 無 `p` 標籤的持久化事件 | 全落 `recipient = ''`，`enforceCap` 不對它執行 ⇒ **無上限** | 計入 DO 離線留言天花板 |
| 刻意不做 | — | 不用 500 則 FIFO 去補（一場對決約 20 則 ⇒ 只夠 25 場） |

### tag 查詢下推 SQL（正確性修正）

| | 修改前 | 修改後 |
| --- | --- | --- |
| 非 `#p` 的 tag 條件 | 先 `ORDER BY created_at DESC LIMIT n`，再在 JS 端過濾 | `EXISTS (SELECT 1 FROM json_each(json,'$.tags') …)` 放進 WHERE |
| 症狀 | 目標事件被較新的事件擠出 LIMIT ⇒ **回空集合** | 正確 |
| 空值陣列 `{"#t":[]}` | — | 直接回空，不查 |

- 刻意不建標籤索引表（要在 6 條刪除路徑同步，漏一條就是孤兒列）；`json_each` 掃的是已被
  kind／pubkey／since 縮小、且受 TTL 有界的候選集。
- 新增索引 `idx_addressable_pubkey`（`CREATE INDEX IF NOT EXISTS`，DO 啟動時自動建立）。

---

## 四、NIP-11（`nip11.ts`、`worker.ts`）

| | 修改前 | 修改後 |
| --- | --- | --- |
| 文件份數 | 一份 | **依路徑**：`/app/<id>` 回車道版；其餘（含認不得的路徑）回嚴格版 |
| `auth_required` | 寫死 `true` | 由 `guardFor(profile)` 推得（嚴格 true／車道 false） |
| `retention` | 自己由 `MAX_TTL_DAYS` 算 | 直接問 `storeOptions`（公用分片會如實顯示 2 小時） |
| 新欄位 | — | `cinder_max_past_skew_sec`（176400＝2 天＋1 小時）<br>`cinder_max_future_skew_sec`（900）<br>`cinder_subscription_scope`（`named`／`tagged`）<br>`cinder_addressable_ttl_sec`（2592000 或 7200） |

---

## 五、PoW（`packages/core/src/pow.ts`、`host-config.ts`）

| | 修改前 | 修改後 |
| --- | --- | --- |
| `leadingZeroBits` | 在 `relay-core.ts` | 搬到 core，relay 轉引（挖礦端與驗證端同一份定義） |
| 挖礦 | 無 | core 新增 `minePow`、`meetsPow`、`DEFAULT_MAX_ITERATIONS = 2^24` |
| 嚴格平面難度 | 0 | 0（恆為 0，不受環境變數影響） |
| 車道難度 | — | `APP_LANE_POW`，未設＝0，上限 32 |

- PoW 只檢查持久化事件；ephemeral（大廳心跳、信令）不受影響。
- 預設 0 的原因：《元素使》已有能跑的客戶端在發持久化事件，打開會弄壞它。

---

## 六、node-relay（`node-relay.ts`）

| | 修改前 | 修改後 |
| --- | --- | --- |
| profile | `ABUSE_GUARD` ＋ `requireAuth` | `guardFor("strict")` ＋ `requireAuth`（**恆為嚴格**，無車道） |
| 訊息上限 | 無 | 240／分，可用 `MAX_MESSAGES_PER_MINUTE` 覆寫；恆 ≥ 事件上限 × 2；設 0 關閉 |
| 超限關線 | — | 與 worker 同（close 1008） |
| 儲存選項 | `storeOptions(MAX_TTL_DAYS)` | 同左，但預設 profile 為 strict ⇒ 新增每作者 8MB、兩個 128MB 天花板（拒收） |

自架站升版**不會**變成公共站；要跑第三方車道只能用 Cloudflare 版（有 DO 隔離）。

---

## 七、NIP-66 發現（`relay/bootstrap/discover.ts`，新檔）

- 純函式模組：讀 kind 30166 事件，產出候選 relay 清單。
- 條件：≥ 2 位**不同**監測者、明說 `!payment`、clearnet；不因要求認證扣分；依監測者數排序。
- **不寫回 `relays.json`**，也沒有接到任何 CI／執行路徑；背書仍由維護者人工決定。
- 對線上中繼**零影響**。

---

## 八、設定與綁定（`wrangler.toml`）

| 項目 | 修改前 | 修改後 |
| --- | --- | --- |
| `vars.APP_LANES` | — | `"lwd,elementalist"`（頂層與 `env.unified` 各一份） |
| `ratelimits` | `TURN_LIMIT`（1001，20/60s） | 另加 `APP_LANE_LIMIT`（**namespace 1002**，30/60s） |
| 可選 env | — | `APP_LANE_POW`（未設＝0） |
| DO migrations | — | **無變更**（沿用 `RelayRoom` SQLite class） |

⚠ `APP_LANES` 加入或移除一條車道＝換一顆 DO，舊 DO 的資料不搬，等 TTL 到期。

---

## 九、對現有使用者的影響

### Cinderous 客戶端（嚴格平面）

| 變更 | 影響 |
| --- | --- |
| 路由：`/`、`/s/<hex>`、`/presence` | 不變 |
| 路由：其他路徑改 404 | 只影響「算錯分片」的客戶端；正常客戶端不會連到這些路徑 |
| 訂閱形狀、AUTH、可尋址閘（30078） | 不變 |
| 保存期、FIFO 500、單顆 256KB、5 位址 | 不變 |
| 🟡 **每連線 240 訊息／分，超過即關線** | 新限制。正常用量遠低於此（事件本身已限 120／分）；若有客戶端在啟動或重連時短時間大量 REQ／CLOSE，會被關線後重連 |
| 🟡 每作者可尋址 8MB | 雲端快照 5 台 × 256KB ≈ 1.25MB，遠低於上限 |
| 🟡 DO 天花板 128MB（**拒收不淘汰**） | 超過時新留言／快照回 `OK false`；以目前用量不會觸及，但若某顆既有 DO 已接近 128MB，部署後會開始拒收 |

### 第三方應用

| 應用 | 修改前 | 修改後 |
| --- | --- | --- |
| 連 `/app/<id>` | 落舊全域 DO、套嚴格政策（要 AUTH、要具名訂閱） | 落車道 DO、不要 AUTH、接受 tag 訂閱 |
| 連 `/` 或其他路徑 | 嚴格 | 嚴格／404 |
| 《辭職信》（不處理 AUTH） | 每顆事件被 `auth-required` 拒 | 改連 `/app/lwd` 即可用 |
| 《元素使》（`#d` 牌組查詢） | 被 `scoped()` 擋、可尋址只回作者 | 在車道上可讀；但仍需自行讓出 kind 30078（該 kind 在車道以外的平面仍是作者專屬） |

---

## 十、部署後驗證清單

以下每項在**兩座錨點**各跑一次。

1. **版號與新欄位**：`curl -H 'Accept: application/nostr+json' https://<host>/`
   - `version` 為 `0.0.18`
   - 出現 `cinder_max_past_skew_sec: 176400`、`cinder_subscription_scope: "named"`、
     `cinder_addressable_ttl_sec: 2592000`、`auth_required: true`
2. **車道文件**：同上改打 `/app/lwd`
   - `auth_required: false`、`cinder_subscription_scope: "tagged"`、`cinder_addressable_ttl_sec: 2592000`
3. **公用分片文件**：改打 `/app/some-stranger`
   - `cinder_addressable_ttl_sec: 7200`、`retention` 顯示 2 小時
4. **WebSocket 路由**（需帶 `Upgrade: websocket` 等標頭）
   - `/`、`/s/a`、`/presence`、`/app/lwd` → 101
   - `/s/zz`、`/foo` → 101，第一則是 `NOTICE unknown relay path…`（附文件網址），隨即 1008 關閉（ADR-0368）
   - `/app/Bad!Id` → 同上，NOTICE 為 `invalid app lane…`
   - 車道連線一開始收到 `["AUTH", …]`（可選）；送 `{"kinds":[20000]}` 回 `CLOSED restricted:`（ADR-0369）
5. **健康檢查不受影響**：`/healthz` → `ok`；不帶 Accept 的 `GET /` → 純文字 200
6. **Cinderous 實機**：兩台裝置互傳訊息、離線留言、雲端快照同步各一次

## 十一、回滾

- 程式：重新部署 `e7de3e3f^1`（或任一更早版本）即可；wrangler 不需要 migration 回退。
- 殘留：車道 DO（`app:*`、`app-*`）與其 storage 會留著，但回滾後不再有路由指向它們；
  既有 DO 多出的 `cinder:lane-*` 兩個鍵與 `idx_addressable_pubkey` 索引對舊版無害。
- `APP_LANE_LIMIT` binding 在舊版程式碼中未被讀取，無害。
