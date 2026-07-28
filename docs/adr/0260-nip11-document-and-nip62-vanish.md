# 0260. 補齊 NIP-11 文件與 NIP-62 清除請求，並更新 MLS 規格指標

- 狀態：**已接受（已實作）**
- 日期：2026-07-27
- 相關文件：ADR-0259（NIP 適用性盤點——本 ADR 承接其 Tier 1 三項）、
  **0089**（贊助入口——其「後續行動 1」至此完成）、**0092**（節點自報——同上）、
  0057（NIP-42 AUTH）、0065（TTL 上限）、0162（檔案塊配額）、0163（離職接管）、
  0235 H1/H2（濫用防護、`relay` tag 檢查）、0241（分片）、0243（TURN 端點）、
  0027／0028／0091／0236（MLS 指標）、PRD §12；
  `relay/src/nip11.ts`、`packages/core/src/vanish.ts`、`relay/src/relay-core.ts`

## 背景與問題

ADR-0259 盤點生態全部 NIP 後列出三項 Tier 1，本 ADR 一次做完：

1. **NIP-11 是還債**：ADR-0089（贊助入口）與 0092（節點自報）**都建立在「relay 會回一份
   NIP-11 文件」之上**，但兩座宿主對 HTTP GET 一律只回純文字 `"Cinderous relay"`。於是社群
   營運者**沒有任何收入面**（ADR-0257 §2）、節點申請流程缺了指定載體、客戶端要知道站方政策
   只能「送出去被拒才知道」。
2. **NIP-62 補一個真實缺口**：使用者對「中繼站上還留著我什麼」**沒有主動權**——個人只能等
   7 天 TTL；企業離職的 allowlist 擋的是**未來發布**（ADR-0163 決策 #2），已躺在離線信箱裡的
   殘留照樣躺到過期。一個主打極致隱私的產品沒有「刪除我的資料」，是品牌與企業稽核的雙重洞。
3. **MLS 的規格指標過期**：ADR-0027/0028/0236 與 ROADMAP F1/F2 都指向 **NIP-EE**，而它現在是
   `final` `unrecommended`，明載「superseded by the Marmot Protocol」。

## 決策

### 1. NIP-11 Relay Information Document

- **新增 `relay/src/nip11.ts` 為 SSOT**，兩座宿主（`worker.ts`／`node-relay.ts`）共用
  ——比照 `host-config.ts` 的教訓（H1 的病因正是「兩個宿主各抄一份」）。
- **內容協商**：只有 `Accept: application/nostr+json` 拿到 JSON；**不帶此 header 維持純文字
  200**——PaaS／容器健康檢查靠那個 200（ADR-0089 定下的契約），改掉會讓部署中的站看起來像掛了。
- **`supported_nips` 只列 relay 這一層真的強制的**：`[1, 11, 13, 40, 42, 62]`。
  NIP-17／25／09／59 是**客戶端**語意（中繼只看到密文外殼），列上去等於對外謊報能力——
  測試把這條釘死。
- **未設定的欄位一律不出現**，而非填空字串佔位：一份宣稱 `contact: ""` 的文件比沒有 contact
  更糟，它讓「有沒有人可問責」變得模糊（ADR-0092 的問責前提）。
- **`limitation`／`retention` 取自實際生效的常數**（`MAX_SUBSCRIPTIONS`／`MAX_QUERY_ROWS`／
  `ttlSecondsFromDays`…），不另抄一份——抄一份就會漂移。
- 承載 `cinder_donations`（ADR-0089，全空則整個欄位不出現＝無贊助入口）與 `cinder_node`
  （ADR-0092，壞 JSON 當沒設、不讓整份文件掛掉）。

### 2. NIP-62 Request to Vanish

- **core `vanish.ts`**：`VANISH_KIND=62`、`buildVanishRequest`、`vanishTargetsOf`、
  `vanishTargetsRelay`。
- **目標比對 fail-closed**：`relay` tag 缺失→拒；宿主不知道自己主機時**只認 `ALL_RELAYS`**。
  這與 NIP-42 `relay` tag 檢查「不給就不強制」的寬鬆處理**刻意相反**——認證放寬只是少一道防線，
  刪除放寬會讓「發給 A 站的請求」把 B 站的資料清掉。**不可逆的動作不對模糊輸入寬容。**
- **relay 端三道閘**（`handleVanish`）：
  1. `requireAuth` 時要求**已認證身分＝事件作者**。簽章本身已證明作者，這條擋的是**重放**
     ——vanish 事件是公開的，側錄者日後重送過不了以該身分進行的 AUTH（`seenIds` 只覆蓋一小時）。
  2. `relay` tag 指向本站或 `ALL_RELAYS`。
  3. store 刪除：**他發的**（`pubkey`）＋**寄給他的**（`p` tag——Gift Wrap 外層是一次性金鑰，
     這是唯一能定位收件匣的鍵，NIP-62 亦明訂應刪 “Gift Wraps mentioning the pubkey”）＋
     **他的可尋址事件**（雲端快照）。
- **是命令不是留言：不寫庫、不扇出。** kind 62 落在一般持久化區間，不攔就會被當留言存起來；
  而把「某某人要求清除資料」廣播給訂閱者，等於用一則公開事件宣告這個人的動作與時間點
  ——與 Gift Wrap 藏元資料的整個立場相反。客戶端本就直接對每座 relay 送，不需中繼轉發。
- **主機資訊與 AUTH 狀態分離**（新增 `connHost`）：`authState` 只在 `requireAuth` 時建立，
  不分離的話**無 AUTH 的自架站會只認 `ALL_RELAYS`**。
- **engine `requestVanish()`**：對每座已知中繼**各簽一顆帶該座 URL** 的請求（relay 會驗
  tag 指向自己，「簽一顆到處發」行不通）。回傳**已送出**的 URL——不是「已刪除」。
- **desktop UI**（隱私分頁）：可逆性講清楚的二次確認＋結果顯示座數。措辭刻意不寫「已刪除」
  ——刪除發生在別人的機器上，**做不到的保證比沒有保證更糟**；並明講本機對話不受影響。

### 3. MLS 規格指標更新（文件層）

ROADMAP F1/F2 改指向 **Marmot Protocol**（狀態 adopted），並註明 NIP-EE 已 `unrecommended`。
**只改方向、不改行程**——ADR-0091 評估 MLS 後「暫緩」的理由（多設備、可靠性護欄、複雜度）
依然成立，ADR-0245 的手動 opt-in FS 也還卡在 Phase 3 外部審計。既有已接受的 ADR 內文不竄改
（ADR 規則），由本 ADR 承接更正。

## 理由

- **NIP-11 不是新決策**，是把 ADR-0089/0092 已接受的決策做完；成本最低、確定性最高。
- **NIP-62 復用既有機制**：刪除走 store（既有 prune 路徑旁）、身分走既有 NIP-42、目標比對
  復用 NIP-42 的 `relayHostOf`。零新加密原語、零新協定面。
- **兩處 fail-closed 的選擇**（目標比對、身分比對）都遵循同一原則：**不可逆的操作，寧可
  少刪也不錯刪**。

## 後果

- 正面：社群營運者終於有收入面的載體；節點申請流程完整；客戶端連線前就知道站方政策；
  使用者與企業第一次能主動要求清除資料（企業稽核問卷的常見題目從「等 TTL」變成「有按鈕」）。
- 負面 / 已知殘餘風險：
  - **不做永久墓碑**。NIP-62 要求「確保已刪事件不能被重新廣播」，嚴格實作需永久保存已清除
    pubkey 的黑名單。本專案**刻意不做**：npub 就是使用者身分，永久封鎖會讓清除過資料的人
    無法再使用該座；且黑名單本身是一份不斷成長、記錄「誰清除過」的元資料。第三方重新發布
    舊事件的風險由既有的重放窗（`replayWindowSec`）＋過去時鐘窗＋NIP-40 TTL 有界化。
  - **只能清得到「已連上的座」**：離線的座走既有重連佇列，但若使用者此後不再連該座，請求
    就不會到達。UI 措辭已據實反映。
  - **無法保證對方真的刪了**：relay 是被視為對手的（威脅模型），OK 回應只代表它說它做了。
    本專案的隱私仍靠結構性機制（E2E／TTL／P2P），不靠營運者善意——NIP-62 是**額外**的手段，
    不是新的信任假設。
  - `supported_nips` 宣告 62 之後，探測器會期待它可用；停用該功能需同步改文件（兩者同一檔）。
- 測試：core 7（建構／目標比對／兩處 fail-closed）＋relay 9（清收件匣／清己發／清快照／
  ALL_RELAYS／指向別座拒絕／身分不符拒絕／不寫庫不扇出／無 AUTH 站可用／多收件人只清自己那份）
  ＋SQL store 3（與記憶體版行為一致）＋NIP-11 9（內容協商／欄位省略／誠實的 supported_nips／
  limitation 取自常數／retention／贊助／節點自報／檔案開關）＋worker 5（端點契約、健康檢查
  不破、贊助欄位、TTL）＋engine 2（**端到端：送出後留言真的消失**、逐座各簽一顆）
  ＋desktop 4（區塊顯示／示範後端不顯示／措辭誠實／未送出不顯示結果）。
  全工作區綠：core 463、relay 197、engine 344、desktop 543、mobile 197、website 51、cli 30、
  theme 14、i18n 8、brand 4；`pnpm -r typecheck` 綠。
- 後續行動：
  1. 營運者需在部署時填 `RELAY_NAME`／`RELAY_CONTACT`／`DONATE_*`／`NODE_ATTESTATION`
     才會出現對應欄位（未填＝維持現狀，不影響既有部署）——自架文件待補說明。
  2. 客戶端讀 NIP-11 顯示「贊助此節點」角落卡（ADR-0089 後續行動 2）**仍未做**——本 ADR 只
     補上 relay 端的載體。
  3. 行動端尚未接 `requestVanish`（桌面優先，同既有企業功能的節奏）。
