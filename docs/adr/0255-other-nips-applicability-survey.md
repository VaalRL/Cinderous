# 0255. 其他 NIP 的適用性盤點（研究記錄）

- 狀態：**研究記錄（未決策，本文不改變任何產品行為）**
- 日期：2026-07-27
- 相關文件：ADR-0002（隱私元資料與協定基線＝現行 NIP 選型的根）、0007（NIP-44）、0057（NIP-42）、
  0027／0091／0236／0245（群組加密與前向保密——**本文對其「未來走 MLS」的指向提出更新**）、
  0035（否決 NIP-65）、0039／0092（維護者簽章清單與節點收錄）、0061／0065（自足生態、刻意不與
  通用 Nostr 客戶端互通）、0089（NIP-11 擴充——已決議**未實作**）、0109／0244（成本結構）、
  0162（企業檔案塊配額）、0163（離職接管）、0235 C2（`MAX_QUERY_ROWS`）、PRD §12（明確排除）
- 資料來源：`github.com/nostr-protocol/nips` 索引與各 NIP 全文（擷取於 2026-07-27）

> 本文件是一份**研究記錄**。它盤點 Nostr 生態現有的全部 NIP，對照本專案的既有決策篩出
> 「值得做／值得評估／明確否決」三層，並記錄**否決的理由**——後者的價值不低於前者，
> 可避免日後重複評估。日後若決定採納其中任一項，另立 ADR 並把該項標記為已承接。

## 背景與問題

現行協定基線由 ADR-0002 定下（NIP-01/13/17/42/44/59），其後陸續補入 NIP-09/10/25/40/49/19/33。
問題：**生態裡還有哪些 NIP 適合本專案？**

盤點時的關鍵前提是——**大多數 NIP 對本專案不適用，而且是「刻意」不適用**。故本文先把篩選準則
從既有決策導出，再逐一過濾；否則很容易把「Nostr 生態很流行」誤當成「本專案該做」。

## 篩選準則（皆導出自既有決策，非本文新創）

1. **自足生態，刻意不與通用 Nostr 客戶端互通**（ADR-0061 決策 #5、0065、0028）
   ⇒ 價值**僅來自互通**的 NIP 一律低分。
2. **無公開貼文、無公開社交圖譜**：所有內容進 Gift Wrap（ADR-0002）
   ⇒ 針對公開內容（貼文、feed、社群、標籤、檢舉）的 NIP 全部不適用。
3. **中繼只轉發密文、零狀態、吃免費額度**（ADR-0005/0006/0109/0244）
   ⇒ 能省 **requests**（不是頻寬）或省儲存的 NIP 加分；relay 需讀內容的 NIP 出局。
4. **非金融 App**（PRD §12 排除金流／廣告／抽成）
   ⇒ 全部支付類 NIP 出局，無例外。
5. **企業＝自架封閉節點、relay 視為對手**（ADR-0044/0047/0163）
   ⇒ 成員管制類 NIP 要與「管理者簽章名冊」的信任模型比較，**信任根較弱者不採**。

## 現況：已採用的 NIP

| NIP | 用途 | 位置 |
|---|---|---|
| 01 | 事件/簽章/REQ 基線 | `core/event.ts` |
| 09 | 收回訊息（rumor kind 5） | ADR-0012 |
| 10 | 對話串（reply `e` tag） | ADR-0051 |
| 13 | PoW 抗濫用（`minPow`） | ADR-0002、PRD §8 |
| 17 | 私訊（kind 14） | ADR-0002 |
| 19 | bech32（npub/nsec） | `core/keys.ts` |
| 25 | 訊息回應（rumor kind 7） | ADR-0011 |
| 33 | 可尋址取代（快照、名冊、清單） | ADR-0071/0099 |
| 40 | 過期時戳（7 天 TTL、限時訊息） | ADR-0065/0013 |
| 42 | AUTH（**預設開**、`#p` 收件匣只准本人） | ADR-0057 |
| 44 | 加密酬載 | ADR-0007 |
| 49 | `ncryptsec` 備份碼 | ADR-0070 |
| 59 | Gift Wrap（藏收發雙方） | ADR-0002 |
| **11** | **已決議但未實作**（`cinder_donations`／`cinder_node`） | ADR-0089/0092 |

## Tier 1：建議採納

### 1.1 NIP-11 Relay Information Document —— 這是**還債**，不是新功能

ADR-0089（贊助入口）與 ADR-0092（節點自報 `cinder_node`）都建立在 relay 能回 NIP-11 之上，
但 `relay/src/worker.ts` 對非 WebSocket 的 HTTP GET **至今仍只回純文字** `"Cinderous relay"`。
一份 NIP-11 文件同時解鎖四件已決議的事：

- 營運者贊助入口（ADR-0089）——目前**完全沒有**收入面（見 ADR-0253 §2）；
- 節點自我宣告 `cinder_node`（ADR-0092 的申請流程正是以此為載體）；
- `supported_nips` 宣告——讓客戶端/探測器不必試錯；
- `limitation` 欄位——把 `MAX_TTL_DAYS`／`MAX_FILE_MB`／速率上限**明示**給客戶端，
  取代目前「送出去被拒才知道」。

**成本**：relay 依 `Accept: application/nostr+json` 分支回一份 JSON（兩座宿主各一處），
不帶此 header 時維持原純文字 200（PaaS 健康檢查不受影響，ADR-0089 已定此契約）。**最低成本、
最高確定性**——它不是新決策，只是把已接受的決策做完。

### 1.2 NIP-62 Request to Vanish —— 補上「請把我的資料刪掉」這個缺口

**現況缺口**：目前**沒有任何機制**能讓使用者要求 relay 立即清除自己的資料。個人只能等 7 天
TTL；企業離職走名冊移除＋allowlist 封鎖（ADR-0163 決策 #2），那擋的是**未來發布**，
**已在 relay 上的離線信箱殘留照樣躺到過期**。

NIP-62（kind 62）定義：帶 `relay` tag（指定 URL 或 `ALL_RELAYS`），
「Relays MUST fully delete any events from the `.pubkey` if their service URL is tagged」，
且明確要求「Should delete NIP-59 Gift Wraps mentioning the pubkey」——**正好對應本專案的收件匣**
（Gift Wrap 外層由一次性金鑰簽，唯一能定位「我的信」的就是 `#p` tag）。

**為什麼契合**：

- 一個以「極致隱私」為賣點的產品，卻沒有「刪除我的痕跡」按鈕，是品牌上的洞；
- 對企業銷售有直接價值——這是資安稽核與個資問卷會問的題目，而目前答案是「等 TTL」；
- 與既有機制**同構**：`SqlMessageStore` 已有 prune 路徑（DO alarm 每小時），刪除只是多一條
  `WHERE pubkey = ? OR #p = ?`；驗簽用既有 `verifyEvent`。
- **安全性天然成立**：kind 62 需以本人私鑰簽署，他人無法代發；而「刪掉我的收件匣」刪的是
  *寄給我的* 訊息——那本來就是我的資料。

**須留意**：NIP-62 明訂 kind 5 不得覆蓋 vanish、且無「取消」語意；UI 必須把不可逆講清楚
（與 ADR-0163 的「刪除託管」二次確認同一等級）。另外它只能清**本座**——多 relay 下要對
pool 廣播，且對已被其他人快取/同步的副本無效（NIP 自身亦承認）。

### 1.3 NIP-EE（MLS）已被取代 —— 路線圖的未來指向需要更新

**這一項不是「要不要實作」，是「既有計畫指向一份已被取代的規格」。**

ADR-0027（群組加密 v1 成對扇出）與 ADR-0236（前向保密路徑）都把「完整 PCS／更大群組」
寄望於 **MLS via NIP-EE**，ROADMAP F1/F2 同。而 NIP-EE 現在的狀態是：

> `final` `unrecommended` `optional`
> `unrecommended`: superseded by the [Marmot Protocol](https://github.com/marmot-protocol/marmot)

Marmot 自述為「end-to-end encrypted group messaging」，以 Nostr 公鑰為身分、Nostr 事件形狀為
MLS 內的酬載、MLS 為群組金鑰協商層，狀態標示為 **adopted**（已脫離草案）。

**建議行動（文件層，成本近乎零）**：在下次修訂相關 ADR／ROADMAP 時，把「未來走 NIP-EE MLS」
改指向 Marmot，並註明 NIP-EE 已 `unrecommended`。**不建議現在實作**——ADR-0091 評估 MLS 後的
「暫緩」理由（多設備、可靠性護欄、複雜度）依然成立，ADR-0245 的手動 opt-in FS 也還卡在
Phase 3 外部審計。此處要修的只是**指標的方向**，不是行程。

## Tier 2：值得評估（未建議立即動手）

### 2.1 NIP-67 EOSE Completeness Hint —— 附帶查出一個真實的截斷風險

NIP-67 在 `EOSE` 加一個可選的第三元素（`"finish"` / `"more"`），明示「存量事件是否已送完」。
向後相容（既有解析器忽略多餘元素），實作量極小。

盤點時順手查到一個**具體的不確定性**：

- relay 對單次查詢有硬上限 `MAX_QUERY_ROWS = 1024`（`relay/src/message-store.ts:36`，ADR-0235 C2
  為防「一次 REQ 撈爆 DO 記憶體」而設，正確）；
- 但**企業檔案塊配額是每收件人 4000 顆**（`DEFAULT_FILE_PER_RECIPIENT = 4000`，ADR-0162）；
- 而客戶端的檔案塊訂閱是 `{ kinds: [KIND.FILE_WRAP], "#p": me }`
  （`packages/engine/src/backend/relay-backend.ts:954`）——**無 `limit`、無 `since`、無分頁**。

⇒ 待收檔案塊超過 1024 顆時（≈3 個 16MB 檔同時待收），relay 會靜默截斷在 1024，
**客戶端無從得知自己少拿了東西**。單一收件人的聊天信箱有 `MAX_PER_RECIPIENT = 500` 擋著、
不會觸發；**檔案塊這條路徑的 4000 > 1024 是實打實的不對稱**。

**本文不宣稱這一定是 bug**——尚未追完是否有其他重取/補齊路徑（如 ADR-0223 為自訂 emoji 做的
backfill 請求）。但這個不對稱值得單獨查證，而 NIP-67 的 `"more"` hint 正是把
「我不知道有沒有被截斷」變成「relay 明說還有」的標準答案。

### 2.2 NIP-B7 Blossom —— ADR-0244 階段 B 的另一條路

ADR-0244 已決議「擴充前硬閘＝把檔案 blob 從 DO SQLite 遷往 **R2**」。Blossom（BUDs）提供的是
同一問題的生態標準解：blob 以 **SHA-256 定址**、與 relay 解耦、伺服器可自架、使用者以
`kind:10063` 宣告偏好的 blob 伺服器清單。

**相對 R2 的差異**：R2 是「我方一個雲端供應商」；Blossom 是「一個可自架的開放介面」。
對**企業／自架客戶**（ADR-0253 的目標客群）差別很大——他們可以把 blob 放進自己機房的 Blossom
伺服器，不必為此開一個 Cloudflare 帳號。且本專案的檔案塊本就是**密文**，存進以雜湊定址的
blob store 語意上乾淨（雜湊定址＋密文＝伺服器什麼也看不出來）。

**待評估**：`kind:10063` 是**公開**的伺服器清單事件（會洩漏「這個 npub 用哪些 blob 伺服器」，
與 ADR-0035 否決 NIP-65 的理由同構）——若採用，應比照 ADR-0035 走**帶內加密 hint**，
不發公開清單。

### 2.3 NIP-86 Relay Management API —— 若要賣託管服務，這是管理面

以 HTTP（`Content-Type: application/nostr+json+rpc`）＋ NIP-98 授權提供 relay 管理方法：
`banpubkey`／`unbanpubkey`／`listbannedpubkeys`／`allowpubkey`／`unallowpubkey`／
`listallowedpubkeys`／`allowkind`／`disallowkind`／`blockip`／`changerelayname` 等。

**與本專案的關係**：目前 `allowedAuthors`（ADR-0044）與 `allowedKinds`（ADR-0048）都靠
**部署期佈建**（env／匯出名冊）。ADR-0253 §4.2 把「託管營運」列為主要收入項，而託管必然需要
一個**執行期**的管理面——NIP-86 是現成的介面定義，不必自創。

**但要先解一個張力**：本專案的成員權威是**管理者簽章的名冊**（ADR-0047，信任根＝管理者金鑰，
客戶端可驗），而 NIP-86 讓 relay 營運者直接改 allowlist（信任根＝relay 營運者）。兩者若同時存在
會出現**兩個真實來源**。可行的收斂：NIP-86 僅作為「名冊 → relay 佈建」的**執行管道**
（由名冊推導、不得手動偏離），而非獨立權威。

### 2.4 NIP-07 `window.nostr` —— 網頁版金鑰風險的減壓閥

ADR-0112 花了整份篇幅處理「網頁版 nsec 落盤」的問題（Argon2id 包裹＋靜態加密），但殘留風險
仍在（頁面內惡意 JS）。NIP-07 讓瀏覽器擴充套件持有金鑰，App 只呼叫 `signEvent`／
`nip44.encrypt`／`nip44.decrypt`——**私鑰根本不進 App**。

**代價要誠實算**：本專案每則訊息是三層（rumor → seal kind 13 → gift wrap 1059），其中 seal 需以
**本人金鑰** NIP-44 加密並簽章 ⇒ 每則訊息、每次收訊解密都要 round-trip 到擴充；擴充可能每次
跳確認；且各家擴充對 `nip44` 的支援程度不一。**收訊端更痛**——每收一則 Gift Wrap 都要一次
擴充解密呼叫。

⇒ 值得評估，但應限定為**網頁版的 opt-in 選項**（給「不願把金鑰交給網頁」的使用者），
不是預設路徑；且須先實測擴充在批次解密下的可用性。

## Tier 3：明確否決（記錄理由，避免重複評估）

| NIP | 否決理由 |
|---|---|
| 77 Negentropy | 它省的是**頻寬**，而本專案的天花板是 **requests**（ADR-0109）且 Cloudflare **egress 免費**（ADR-0244）——省到的正好是不用付錢的那項。relay 端要實作完整二進位集合對帳協定，代價與收益完全不成比例 |
| 70 Protected Events | 要求 relay 驗「已 AUTH 的 pubkey ＝ 事件作者」。但 Gift Wrap 外層**刻意由一次性金鑰簽署**（NIP-59 藏寄件者），客戶端是以自己的身分 AUTH ⇒ 兩者永不相等，**與本專案的核心機制結構性互斥** |
| 43 Relay Access Metadata | 與 ADR-0047/0156 的邀請碼＋簽章名冊功能重疊，但信任根是 **relay 發布的成員清單**（NIP 自述「should not be considered exhaustive or authoritative」）。本專案的**管理者簽章、客戶端可驗**信任模型更強，且 relay 本就被視為對手 ⇒ 換過去是降級 |
| 65 Relay List Metadata | ADR-0035 已否決（公開「我用哪座 relay」＝通訊 metadata），改採帶內加密 hint |
| 66 Relay Discovery/Liveness | ADR-0039 已否決依賴第三方信譽（「與否決信譽 API／NIP-65 同一潔癖」）。反向用法（把自家健康探測以 kind 30166 發布給生態）價值有限，且擴大節點拓撲的公開面 |
| 29 Relay-based Groups | 群組狀態與訊息交給 relay 管理＝**破 E2E**。與 ADR-0027 的成對扇出根本衝突。（代價要誠實記下：成對扇出使公告成本隨成員數線性成長——企業大群是真實限制，但答案不會是把明文交給 relay） |
| 51 Lists／78 App-specific data | 跨裝置狀態同步已有等價物（ADR-0071 加密雲端快照、ADR-0107 多設備），改用標準 kind 無淨收益 |
| 30 Custom Emoji／A0 Voice／38 User Statuses／92 imeta／94 File Metadata | 價值全在**與通用客戶端互通**，而本專案刻意自足（ADR-0061/0065）；且這些事件形狀假定內容公開，本專案一律進 Gift Wrap。**唯一值得借鑑的設計點**：NIP-38 的 music status 用 `expiration` 表示「歌曲結束時間」——這比 ADR-0252 目前純節流的作法更精確（歌停即清），可在不採用 NIP-38 的前提下借用這個想法 |
| 45 COUNT／50 Search | 對只存密文的 relay 無意義（搜尋不了、計數也不省事——收件匣本來就要全拉回來解密） |
| 46 Remote Signing／55 Android Signer | 把簽章權交給外部服務；若由公司持有即等同 ADR-0052 已否決的**金鑰託管後門**。（NIP-07 不同：金鑰在使用者自己的擴充裡，非第三方） |
| 47 Wallet Connect／57 Zaps／60 Cashu／61 Nutzaps／75 Zap Goals／87 Cashu 探索 | PRD §12 排除金流；ADR-0089 已完整評估並否決 NIP-57（公開 zap 收據會把「誰付錢給誰」上鏈，摧毀 Gift Wrap 藏起的社交圖譜） |
| 02 Follow List／18 Reposts／22 Comment／23 Long-form／28 Public Chat／32 Labeling／56 Reporting／68 Picture feeds／71 Video／72 Communities／84 Highlights／88 Polls／99 Classified／A4 Public Messages／7D Forum／C7 Chats | 全屬**公開社群/內容平台**功能。PRD §12 明確排除「Open Chat 公開大群／VOOM 動態牆」——會把產品從私密即時通拉成社群平台 |
| 03／06／08／15／26／31／90／96／BE | 生態已標記 Deprecated |
| 34 git／35 Torrents／52 Calendar／53 Live Streaming／54 Wiki／64 Chess／69 Orders／73 External IDs／85 Trusted Assertions／89 App Handlers／C0 Code／CC Geocaching／F4 Podcasts／5A nsites／B0 Bookmarks | 與 IM 定位無關 |

## 決策（研究記錄，未決策）

- **本文不改變任何產品行為**，不新增協定面。
- **建議優先序**：(1) NIP-11（還債、解鎖四件已決議的事）→ (2) NIP-62（補「刪除我的資料」缺口）
  → (3) 更新 MLS 指向（文件層）→ 其餘列 Tier 2 待觸發條件成立。
- **Tier 3 的否決理由已入庫**，日後若有人再提，先讀本表。

## 後果

- 正面：把「還有哪些 NIP 該做」從發散變成三層清單；否決理由留檔避免重複評估；順帶查出
  NIP-EE 已被 Marmot 取代（影響既有路線圖指向）與 `MAX_QUERY_ROWS` vs 檔案塊配額的不對稱。
- 已知限制：NIP 狀態擷取於 2026-07-27，生態會變（本次盤點就抓到 NIP-EE 的狀態變化）——
  日後採納前應重新確認該 NIP 當時的狀態；Tier 2 的四項皆未做實作評估（只做適用性判斷），
  真要動手前需各自立 ADR 並估工。
- 後續行動（**皆待決策，本 ADR 不執行**）：
  1. 實作 NIP-11（含 `cinder_donations`／`cinder_node`／`supported_nips`／`limitation`）——
     承接 ADR-0089/0092 的未竟待辦。
  2. 評估 NIP-62（relay 端刪除路徑＋客戶端不可逆確認 UI＋多 relay 廣播語意）。
  3. 修訂 ADR-0027/0236 與 ROADMAP F1/F2 的 MLS 指向（NIP-EE → Marmot，註明前者 `unrecommended`）。
  4. 查證 `MAX_QUERY_ROWS = 1024` 與 `DEFAULT_FILE_PER_RECIPIENT = 4000` 的不對稱是否會造成
     檔案塊靜默遺漏；若會，補分頁或 NIP-67 hint。
