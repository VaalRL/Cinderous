# 研究：把 Cinderous relay 當成四款遊戲的共用後端，程式碼要改什麼

> 目的：四個獨立專案（《華爾街／辭職信》《菜鳥教頭 SoLeague》《元素使》《沒當好爸爸》）都把
> `wss://cinder-relay.cinderous1.workers.dev` 寫成主力中繼。本文盤點它們對中繼的實際需求、
> 與現行實作逐條對照，判定**哪些非改不可、哪些不該改、哪些要先裁示**。
> 相關：ADR-0005（自建 Worker relay）、ADR-0006（心跳容量與免費額度）、ADR-0057（NIP-42 AUTH）、
> ADR-0071（可尋址快照）、ADR-0123（訂閱必須具名）、ADR-0160/0065（TTL）、ADR-0235（濫用防護）、
> ADR-0241（分片與 presence 層）、ADR-0260（NIP-11／NIP-62）、`docs/research/public-relay-fallback.md`。
>
> 本文件為**研究記錄、非決策**。任一路線啟動時另立 ADR。

## 結論摘要

**現行 relay 不能原樣承接這四款遊戲。** 不是效能問題，是**設計前提相反**：

| | Cinderous | 四款遊戲 |
| --- | --- | --- |
| 訂閱形狀 | 你得先知道要問誰（`#p` 自己／`authors`；ADR-0123） | 開放式大廳：**不知道對手是誰**才要找 |
| 中繼看得到什麼 | 盡量什麼都看不到（Gift Wrap／封裝 presence） | 牌組、戰績、房間都**刻意公開** |
| 房間 | 無伺服器端房間（群組是客戶端成對扇出，ADR-0027／0241） | 房間／牌桌是核心 |
| 保存 | 一切壽命有界（7 天／30 天），孤兒資料在數學上不可能（ADR-0065） | 牌組、勳章、存檔要**永久** |

而且這不是紙上推論——**《沒當好爸爸》是唯一有真實程式碼的一款，它已經實測撞到並繞過去了**：
其 `docs/adr/0007` 2026-09-04 補記載明「大廳的 `#g` 廣播訂閱會被它以 `restricted` 關掉，
**由公共備援回應**」。目前該遊戲的大廳跑在 nos.lol／damus 上，cinder-relay 只接得住指名信令。
`docs/research/public-relay-fallback.md` 第 2 節列為「🔴 收件匣變成公開可讀」的那條路，
已經是某個下游專案的**預設路徑**。

---

## 一、四款遊戲要什麼（交集）

實作成熟度差距極大，先分清楚：

| 專案 | 狀態 | 對中繼最硬的需求 |
| --- | --- | --- |
| 沒當好爸爸 | **已實作**（`packages/nostr`，含 NIP-42） | `#t`+`#g` 大廳廣播訂閱；WebRTC 信令；SDP 事件可達 64KB |
| 辭職信（WallStreet） | **已實作**（M8 完成，有兩份 mini-relay 參考實作） | kind 1078 持久化且不可覆寫；kind 1059 離線收禮；**客戶端不會回 AUTH** |
| 元素使 | 只有文件（`src/` 尚未建立） | kind 30078 牌組公開發布＋`#t` 標籤瀏覽；kind 20078 遊蕩者心跳 |
| SoLeague | 只有文件（零 nostr 程式碼） | NIP-58 勳章；NIP-44 跨端存檔（40–110KB／顆） |

### Kind 一覽

| Kind | 誰用 | 類別 | 與 Cinderous 的關係 |
| --- | --- | --- | --- |
| **1078** | 辭職信（房間協議、承諾/揭曉） | regular，**必須持久且不可覆寫** | 無衝突（區間空著） |
| **1059** | 辭職信（跨遊戲贈禮） | regular | **共用 Cinderous 的離線留言桶** ⚠ |
| **20078** | 沒當好爸爸（大廳＋信令）、辭職信（道具/聊天）、元素使（遊蕩者心跳） | ephemeral | 無衝突 |
| **20079** | 沒當好爸爸（後備走棋，未實作） | ephemeral | 無衝突 |
| **24000** | 元素使（大廳＋出牌） | ephemeral | 無衝突 |
| **30078** | **四款全部**（牌組／玩家檔案／贈禮／存檔） | addressable | 🔴 **正面衝突＝ `SNAPSHOT_KIND`** |
| **30009 / 8 / 30008** | SoLeague、沒當好爸爸、元素使（NIP-58 勳章） | addressable / regular | 無衝突，但要求永久保存 |
| **22242** | 沒當好爸爸（NIP-42 AUTH 回覆） | — | 已支援 |

Ephemeral 區間運氣不錯：`20078`／`20079`／`24000` 都避開了 Cinderous 的
`20000/20001/20100` 與 `21000–21999`（`packages/core/src/constants.ts`）。**唯一的 kind 衝突是 30078。**

---

## 二、六個硬衝突（逐條附程式碼位置）

### A. 🔴 開放式大廳在 ADR-0123 下無解

`relay/src/relay-core.ts:426-447` 的 `scoped()`：每個 filter 要嘛帶 `#p` 且**值全等於自己**，
要嘛帶 `authors`（上限 1024）。下面這些**全部**會拿到 `CLOSED restricted`：

```jsonc
{"kinds":[20078], "#t":["nagd"], "#g":["chess"]}        // 沒當好爸爸 大廳
{"kinds":[1078,20078], "#t":["lwd"], "#r":["AB3K9XZ2"]} // 辭職信 房間（events.ts:197）
{"kinds":[30078], "#t":["openetg-deck"]}                // 元素使 牌組瀏覽
```

**「共用一把大廳公鑰」的繞法也會壞**：`#p:[LOBBY]` 要求 `authState.pubkey === LOBBY`，
所以每個客戶端都得以 LOBBY 身分 AUTH；而速率限制是**以認證身分計數**
（`relay-core.ts:538`，這是 ADR-0235 H1 為了擋 Gift Wrap 一次性金鑰而刻意改的），
於是全體玩家擠在同一個 120 事件/分的桶裡。同理 `MAX_PER_RECIPIENT = 500` 會讓大廳桶
只留得住最新 500 則。**這條路是死的。**

### B. 🔴 kind 30078 語意衝突（會吃掉使用者的裝置備份）

`packages/core/src/snapshot.ts:13` — `SNAPSHOT_KIND = 30078`，是加密雲端快照。relay 對它有三條規則：

| 規則 | 位置 | 對遊戲的後果 |
| --- | --- | --- |
| 每 (pubkey,kind) 只准 **5 個 `d` 位址** | `message-store.ts:106` | 元素使「每人可發多套牌組」直接撞牆；**而且遊戲牌組會把玩家真正的裝置快照擠掉**（`putAddressable` 回 false，第 6 顆起一律拒收——所以其實是新的被拒，但兩邊搶同一個 5 格配額） |
| 壽命 30 天 | `message-store.ts:108` | 牌組／勳章／存檔「永久保存」不成立 |
| `requireAuth` 時**只回給作者本人** | `relay-core.ts:473` 與 `:584`（ADR-0071） | **收禮的人永遠看不到禮物；牌組永遠沒有第二個人看得到** |

第三條是致命的：四款遊戲的 30078 用途（贈禮、公開牌組、公開檔案）**全部都需要別人讀得到**，
而現行實作對可尋址事件的查詢與即時扇出都閘在作者本人。

### C. 🔴 `requireAuth` 寫死，而辭職信的客戶端**不會回 AUTH**

`relay/src/worker.ts:239` 的 `RelayRoom` 建構子寫死 `requireAuth: true`
（`nip11.ts` 的 `authRequired` 也因此寫死，註解說得很清楚：拿獨立旗標描述它遲早會說謊）。

而 `last-working-day-dev/packages/platform-browser/src/relay.ts:185-213` 的訊息 switch
只處理 `EVENT`／`EOSE`／`CLOSED`／`OK`，`default: return;` —— **`["AUTH", challenge]` 被靜默丟棄**。
接著 `:456-458` 把非 disconnected／timeout 的拒絕當成硬失敗，往上拋 `RELAY_UNAVAILABLE`。

⇒ **辭職信對 cinder-relay 目前是 100% 不通的**，每一顆事件都拿 `auth-required` 被拒、每個 REQ 都被
`CLOSED`，然後靜靜退到 damus／nos.lol。它自己的 ADR-0009 卻把 cinder-relay 寫成主站。
這是一個現在就成立、可驗證的缺陷，而且**不在 relay 這一側**。

### D. 🟠 保存期：一切壽命有界 vs 遊戲要永久

ADR-0065 的立場是「任何一列的壽命都有界，孤兒資料在數學上不可能」。預設 7 天
（`DEFAULT_MAX_TTL_SECONDS`），可尋址 30 天。但：

- 辭職信的 **kind 1059 贈禮**：送方已實質扣款，收方可能數天後才上線。relay 清掉＝**禮物永久消失且不可逆**。
  它的 `giftFilter` 還刻意往前多抓 2 天（`gifts.ts:36`）就是在對抗這件事。
- 辭職信的 **kind 1078 房間事件**：斷線重連靠歷史重放，整場對局期間絕不能被清。同學會一場約 220 則。
- 元素使的牌組、SoLeague 的 NIP-58 勳章：文件明寫「永久存在 Nostr Relay 中」。

⚠ 另一個方向的問題：1059 贈禮會進**與使用者聊天訊息同一個** 500 則 FIFO 桶
（`message-store.ts:326` `enforceCap`，只有 1060 檔案塊被分桶）。遊戲禮物多了，會把真人的離線訊息擠掉。

### E. 🟠 容量：算術上不可能

ADR-0006 的模型是「並行上線 ≈ 100,000 / 每人每日進站訊息數」，30 秒心跳時約 **34 人**。
DO 的外送不計費，**瓶頸純粹是進站 WS 訊息數**。對照遊戲端的宣稱：

| 來源 | 宣稱 | 實際換算 |
| --- | --- | --- |
| 元素使 `ref/40:39,53-54` | 遊蕩者**每 30 秒**廣播一次，「無論全網有多少萬名玩家在走動」，因為 ephemeral「零 DB 寫入，永不超標免費額度」 | **前提就是錯的**。ephemeral 不落盤，但每一則進站訊息照樣計費 ⇒ 2,880 req/日/人 ⇒ **約 34 人封頂** |
| 沒當好爸爸 `ref/01:13`、`ref/04:37-39` | 「萬人同時在線」「10,000 局/日…遠在 100,000 次免費額度之內」 | 大廳心跳 10 秒一次＝8,640 req/日/人 ⇒ **約 11 人** |
| 辭職信 `relay.ts:256-268` | 每客戶端**每 15 秒**一次 `REQ {kinds:[1078], limit:1}` 探針 | 5,760 req/日/人 ⇒ 約 17 人，**且這是無 tag filter 的全庫查詢** |

「Ephemeral ⇒ 免費」這個誤解在三個 repo 的文件裡都有，而 PRD §8 與 ADR-0006 早就否定過它
（「原 PRD 曾稱 Ephemeral『零消耗』，但實際仍消耗請求數」）。**這件事光改 relay 的程式碼解決不了。**

### F. 🟠 全部遊戲流量會壓在同一顆 legacy DO 上

`relay/src/shard.ts:29-34`：只有 `/s/<nibble>` 與 `/presence` 會分流，**其他（含 `/`）一律回
`LEGACY_GLOBAL_NAME = "global"`**（`shard.test.ts:48-51` 釘著這個行為）。四款遊戲全部連根路徑
⇒ 所有遊戲連線與事件都落在**同一個** Durable Object——單執行緒、~128MB，正是 ADR-0241
花力氣要消滅的那顆單點。而遊戲的公開大廳流量又天然無法用「收件人 pubkey」分片。

---

## 三、次級問題（不致命但會咬人）

1. **tag 索引只有 `p`。** `sql-message-store.ts` 只對 `recipient`／`pubkey`／`kind`／`expiration` 建索引，
   `#t`／`#g`／`#r`／`#d` 只能在 `matchFilter` 於 JS 端判（`filters.ts:16-24`，而且它接受任意長度 tag 名，
   非單字母也能用——這點比 NIP-01 寬鬆）。**真正的問題是順序**：SQL 先 `ORDER BY created_at DESC LIMIT 1024`
   才交給 JS 過濾（`:215`、`:237`），所以「數萬套牌組裡找 `#t:fire`」會在事件量超過 1024 之後**回空集合**，
   而不是回少一點。這是正確性 bug，不是效能問題。
2. **NIP-11 誠實性。** `SUPPORTED_NIPS = [1,11,13,40,42,62]`（`nip11.ts:44`）。四款遊戲全部要靠
   NIP-11 探針「自動過濾收費節點」；真要承接它們，`supported_nips`、`limitation.max_message_length`、
   `retention` 都得反映新政策——否則就違反這份檔案自己訂的「誠實的清單」原則。
3. **位址錯誤（兩個 repo）。** SoLeague（`PRD/ref/21:34`）與元素使（6 處）寫的是
   `wss://cinderous.cinderous1.workers.dev` —— 那是**網頁版 App**（`README.md:9`），純資產 Worker，
   官方錨點沒開 ADR-0354 統一模式，連過去只會拿到 HTML。正確位址是
   `wss://cinder-relay.cinderous1.workers.dev`。沒當好爸爸已經自己查出來並修正了（ADR-0007 補記）。
4. **本地微中繼 `ws://127.0.0.1:4869`。** 四份文件都列為梯隊④。`node-relay.ts` 打包後只有 97KB，
   但它需要 Node runtime；遊戲端是 Tauri(Rust)／瀏覽器。`build:worker` 產出的 `relay-worker.js` 是給
   ADR-0356 上傳 Cloudflare 用的，不是本機宿主。**這條要嘛另做 Rust 宿主，要嘛從四份文件裡拿掉。**
5. **SoLeague 的存檔同步事件 40–110KB。** 在 256KB 上限內沒問題，但會吃掉 30078 的 5 格配額。

---

## 四、若決定承接，relay 要改什麼

核心主張：**不要放寬 ADR-0123，而是另開一條有明確邊界的「公開廣播車道」。**
把遊戲流量與 Cinderous 的隱私平面**結構性分離**，而不是把隱私規則挖個洞。

### P0（沒有就不能動）

| # | 改什麼 | 檔案 | 做法 |
| --- | --- | --- | --- |
| 1 | 公開車道路由 | `relay/src/shard.ts`、`worker.ts:211` | 新增 `/app/<appId>` → `idFromName("app-<appId>")`。每個 app 一顆獨立 DO，與訊息片／presence 層完全隔離。順手把「其他路徑落到 global」這條遷移期回退收掉 |
| 2 | 車道專屬的訂閱政策 | `relay-core.ts` `scoped()` | 新增 `publicLane?: boolean`。開啟時 `scoped()` 改為「**至少要有一個 `#`-tag 或 `authors`**」——擋掉 `{"kinds":[…]}` 的裸消防水管，但放行 `#t`+`#g`／`#r`／`#d`。ADR-0123 對訊息片**一字不動** |
| 3 | 車道專屬的 kind allowlist | `host-config.ts` | 沿用既有 `allowedKinds`（ADR-0048），每個 app 宣告自己的 kind 集合。30078 **不放進任何遊戲車道** |
| 4 | 解 30078 衝突 | 四個遊戲 repo，非 relay | 遊戲改用自己的 addressable kind（如 `30100+`）。**這是唯一乾淨的解**——改 relay 讓 30078 同時是私密快照又是公開牌組，等於讓 ADR-0071 的「只回作者本人」永遠說不清楚 |
| 5 | 車道的保存政策 | `message-store.ts`、`host-config.ts` | 車道用獨立的 `MessageStoreOptions`：自己的 TTL、自己的 per-recipient 桶（禮物絕不與聊天訊息互踐）、可尋址事件的 `MAX_PER_AUTHOR` 可調 |
| 6 | 可尋址事件的公開讀 | `relay-core.ts:473`、`:584` | 「只回作者本人」改為**只對 `SNAPSHOT_KIND` 生效**，而不是對整個 30000–39999 區間生效。現行寫法是 `isAddressableKind(kind)`，語意過寬 |

### P1（不改會壞資料或難查）

| # | 改什麼 | 檔案 |
| --- | --- | --- |
| 7 | tag filter 下推 SQL（至少 `t`/`g`/`r`/`d`），修掉「LIMIT 1024 先截斷再過濾」回空集合的正確性 bug | `sql-message-store.ts:189-238` |
| 8 | NIP-11 反映新政策：`supported_nips`、per-lane `limitation`、`retention`、`max_message_length` | `nip11.ts` |
| 9 | 速率限制分桶：公開車道與訊息平面不共用同一個 120/min 桶 | `relay-core.ts:537-541` |
| 10 | 兩座宿主同步（`node-relay.ts` 必須拿到同一組車道設定，否則就是 ADR-0235 H1「組裝層沒人測」再演一次） | `host-config.ts`、`node-relay.ts` |

### P2

11. NIP-58 勳章（kind 8／30009／30008）要不要收、保存多久 —— 這是產品決策不是技術問題。
12. 本地微中繼的 Rust 宿主，或從四份文件移除梯隊④。

---

## 五、建議**不要**做的

- **不要放寬訊息片的 `scoped()`。** ADR-0123 擋的是「一鍵拿到整個使用者名冊連同即時線上狀態」，
  那個風險與遊戲無關、也不因為遊戲而降低。
- **不要讓 30078 同時服務兩種語意。** 見 P0-4。
- **不要在 relay 端做遊戲邏輯。** 四份調查一致：排行榜聚合、Proof-of-Burn 驗證、撮合、洗牌託管、
  反作弊，全部已被各自的 ADR 推回客戶端或否決（辭職信 ADR-0009 第 21/41 條最明確：
  「沒有 Proof-of-Burn 的第三方驗證：無中央帳本，只能信送方簽章」）。relay 不該撿回來。
- **不要承諾「可信時間戳仲裁」。** 沒當好爸爸的 `ref/08:54`／`ref/22:109` 與元素使的 `ref/11:68`
  都想拿 relay 的收件順序當裁判。那需要 relay 是**可信的單一權威**——與本專案「中繼營運者是頭號對手」
  的威脅模型（PRD §6）直接矛盾。

---

## 六、要先裁示的

1. **要不要承接？** 承接＝這座 relay 從「只轉發密文」變成「同時託管公開遊戲資料」，
   ADR-0090 的硬隔離精神、ADR-0257 的營運模型、以及 NIP-11 對外自報的定位全部要重新表述。
   替代方案是**四款遊戲各自部署一座**——ADR-0356 的一鍵部署器與 `node-relay`（97KB）已經讓這件事很便宜，
   而且零隱私代價、零額度爭用。這是我認為值得先認真比較的選項。
2. **免費層怎麼辦？** 見 §二E。承接就等於承諾一個 ADR-0006 明確說撐不住的量級。
   要嘛升級付費方案並改寫 ADR-0006、要嘛把遊戲的心跳頻率壓到與 ADR-0109 同級（60s/300s 自適應）。
3. **誰負責修下游？** 辭職信的 AUTH 缺口（§二C）與兩個 repo 的位址錯誤（§三3）都在遊戲那一側，
   relay 這邊改什麼都救不了。
