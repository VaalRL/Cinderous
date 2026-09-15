# 0344. ICE 路徑判定：分辨「直連」與「經 TURN 中繼」，並用它替大檔把關

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0213（對話標題列 P2P 直連品質晶片）、ADR-0026（通話執行期與 UI）、ADR-0243（WebRTC TURN 保底與成本評估）、ADR-0342（TURN 閘門三層）、ADR-0210（一般模式加預設 STUN）、ADR-0017/0029（P2P 檔案傳輸與二進位分塊）、`packages/engine/src/backend/ice-path.ts`

## 背景與問題

ADR-0213 的標題列晶片只有兩態：資料通道開了（`connected=true`）或沒開。但「開了」底下藏著兩種**成本與效能完全不同**的現實：

| | 位元組路徑 | 站方成本 |
| --- | --- | --- |
| **直連**（host／srflx／prflx 配對） | 兩端之間 | **零** |
| **經 TURN 中繼**（任一端為 relay 候選） | 整份穿過 TURN 伺服器 | **按流量計費** |

程式目前**分辨不出自己在哪一條上**。`onConnectionState` 只有布林值；`pc.getStats()` 從未被呼叫過。

這個缺口本身不痛，痛的是它擋住了下一件事：

**ADR-0243 核可公共 TURN 的成本論證是以「通話」為基礎的**——「語音頻寬很低（雙向 ~80 kbps → 10 分鐘語音 ≈ 6 MB）……實際 TURN 流量 = 少數通話 × 小頻寬 = 很小」。但 `FILE_TRANSPORT_ORDER = ["p2p", "turn"]`（`packages/core/src/connection.ts`）**讓檔案走同一條管子**，而檔案沒有「頻寬很低」這回事：一個 500 MB 的檔案就是 500 MB 的計費流量，一次。ADR-0342 §2 已經自承「真正把上限釘死的只有**帳單警示**與 Cloudflare 端的用量上限」——也就是說，這條路徑目前在客戶端**完全沒有閘門**。

而我們正打算把 `DEFAULT_MAX_FILE_SIZE`（100 MiB）的天花板拆掉、改走串流。**在拆之前必須先有能力分辨路徑**，否則等於把一個未計量的計費入口放大一個量級。

⇒ 本 ADR 先做**判定**（§決策一～四），再用它做**一條**政策：大檔走中繼時提示（§決策五）。判定與政策分開落地是刻意的——把「我在哪條路上」變成程式讀得到的事實，是替大檔把關的前置條件，而那個事實本身也值得讓使用者看見。

## 考量的選項

- **選項 A（採用）：`getStats()` 找出被選中的 candidate-pair，看兩端候選型別。** 標準 WebRTC 統計 API，無新依賴、無協定變更、純本機讀取。
- 選項 B：解析 SDP／`onicecandidate` 自己記帳。可在連線前就知道「有沒有 relay 候選」，但**候選存在 ≠ 被選中**——ICE 常常蒐集了 relay 候選卻用直連通，會大量誤報。
- 選項 C：`RTCIceTransport.getSelectedCandidatePair()`。語意最直接，但瀏覽器支援度遠不如 `getStats()`（Firefox 長年未實作 `RTCIceTransport`）。
- 選項 D：不判定，改成「一律假設走 TURN」來保守把關。最省事，但會對 90% 的直連使用者施加無謂限制，違反 ADR-0210 「P2P 是加值、失敗不打擾使用者」的取向。

## 決策

**一、判定（`packages/engine/src/backend/ice-path.ts`，純函式）**

- `IcePath = "direct" | "relay" | "unknown"`。
- `classifyIcePath(reports)`：從 stats 圖找出被選中的 candidate-pair，依序嘗試 ① `transport.selectedCandidatePairId`（Chrome/Edge/Safari）② 配對自帶 `selected`（Firefox）③ 唯一一組 `nominated`+`succeeded` ④ 整張圖唯一一組 `succeeded`。找到後看兩端候選的 `candidateType`：**任一端是 `relay` 即判 `relay`**（TURN 只要有一端在用，位元組就必經那台）；兩端都解得出且都不是 relay 才判 `direct`。
- `probeIcePath(pc)`：包一層 `getStats()`。⚠ `RTCStatsReport` 是 **maplike**，直接 `for...of` 拿到的是 `[id, report]` 配對而非報告本身，必須走 `values()`。
- **永不拋出**：沒有 `getStats`（舊 webview）、呼叫失敗、圖看不懂，一律 `"unknown"`。這是顯示與把關用的旁路資訊，絕不該拖垮連線。

**二、`"unknown"` 是誠實，不是失敗**

判不出來就回 `"unknown"`，**不猜**。把「判定」與「政策」切開是刻意的：這個模組只回報看到什麼；至於「判不出來時該不該當成中繼辦」，那是呼叫端的決定——**把關情境應當成 `relay` 辦（保守），顯示情境則應顯示中性文案（不假設最好的情況）**。同一個 `unknown` 在兩處有不同的正確處置，正是它不該在判定層被消去的理由。

**三、探測時機（`IcePathTracker`，檔案傳輸與通話共用）**

行為住在 `IcePathTracker`，持有者只負責在連線建立時 `start()`、結束時 `reset()`——`WebRtcTransfer`（每聯絡人一條）與 `WebRtcCall`（單一通話槽）需要的是同一套行為，差別只在誰持有連線。

- 連線建立時排定**有界**的幾次探測：0 / 1s / 4s / 15s。
  - 檔案傳輸的觸發點是資料通道 `onopen`；通話是 `pc.connectionState === "connected"`。
  - 為什麼不只測一次：ICE 會**先用能通的配對、之後才換到更好的**（典型是先 relay，打洞成功後升級為直連）。只在 `onopen` 測一次會把那條連線永久標成「經中繼」。
  - 為什麼不常駐輪詢：`getStats()` 不是免費的，而每位在線聯絡人都有一條連線。有界的補測涵蓋提名塵埃落定的視窗即足夠。
- `icePath()`：同步讀快取，零成本。
- `refreshIcePath()`：立即重測。**送大檔前該叫的是這個**——快取只在連線建立後前 15 秒內補測過，之後的切換（ICE restart、Wi-Fi 換 4G）不會反映。真正在意成本的時刻重測一次，很便宜。
- 連線結束（通道關閉／`connectionState==="failed"`／通話 teardown）：清掉排程中的計時器並把路徑歸零，不留下過期判定。計時器一律 `unref()`（Node 下不吊住行程；瀏覽器無此方法，故為可選呼叫）。
- **世代（generation）**：探測是非同步的，回來時連線可能已斷、甚至已換成下一通通話。`reset()` 推進世代，讓在途探測回來時自我作廢——否則上一條連線的判定會蓋到下一條身上。⚠ 通話的 `failed` 分支特別需要**當場** `reset()`：它的收尾走的是**非同步**的 hangup 路徑，等 teardown 才歸零的話，中間 `icePath()` 會繼續回報上一刻的判定（這是寫測試時才發現的）。

**四、回報與呈現**

- **檔案傳輸**：`TransferHandlers.onConnectionState(peer, connected, path?)` ／ `ChatBackendEvents.onPeerConnection(contact, connected, path?)` 加上第三個參數。通道一開先發 `unknown`，測出來且**與前次不同**才再發一次 ⇒ **同一條連線會收到多次 `connected=true`**，UI 必須能吃重複（`App.tsx` 兩個 state 各自去重）。
- **通話**：`CallHandlers.onIcePath(peer, path)` ／ `ChatBackendEvents.onCallIcePath(peer, path)`。只在判定改變時發，**通話結束不發 `unknown` 收尾**——UI 於 `onCallState` 結束時自行歸位（與媒體型態同一套作法，避免「上一通走 TURN」殘留到下一通）。
- `ChatBackend.refreshIcePath?(to)` 供未來的把關呼叫；通話端為 `WebRtcCall.refreshIcePath()`。
- 晶片由兩態擴為四態。判定→呈現的規格住在 **`@cinderous/theme` 的 `p2pPathChip`**（純函式，可單測），與 `icons.ts` 同一個理由：桌面與行動端都要顯示，不放在共用處就會各做一個然後漂移。theme 只給**語義角色與色票**，不含渲染——桌面把 `tone` 翻成 CSS class、行動端翻成 StyleSheet 的 `borderColor`/`color`。⚠ theme 是設計 token 層、**不依賴 engine**，故它重述一次 `IcePath` 的字串聯集（`P2pPathValue`）；兩者若不一致，呼叫端傳值時會型別紅。

| 狀態 | 呈現 | 語意 |
| --- | --- | --- |
| 未連線 | `⚪ 直連未建立`（低調灰） | 降級走 relay，文字不受影響（ADR-0213 原樣） |
| `direct` | `⚡ 直連`（綠 `.on`） | 位元組兩端直走 |
| `relay` | `🔁 經中繼`（琥珀 `.relay`） | 走 TURN：仍端到端加密，但較慢、且是計費路徑 |
| `unknown` | `🔗 已連線`（中性 `.up`） | 連上了，路徑尚未測出 |

通話視窗用同一組短標籤與配色，**但 tooltip 換句話**（`p2pPathChip` 的 `context` 參數）：對話講「傳大檔請斟酌」，通話講「延遲較高、也較耗中繼流量」。晶片只在 `state === "active"` 顯示——接通前談路徑沒有意義，而通話中不存在「未建立」一態（斷了就沒有視窗了）。

**四個顯示點**：桌面 `ConversationWindow`／`CallWindow`、行動端 `ConversationScreen`／`CallScreen`。行動端的對話晶片一併補上了 ADR-0213 當初列為「另案對齊」的部分——它從來沒有顯示過直連狀態。行動端以描邊而非實心呈現：實心是企業頭銜（身分），這是狀態，兩者在標頭相鄰，靠填滿與否一眼分得開。

**行動端的 state 歸屬**：新增 `use-peer-link-session.ts`（ADR-0331 的功能簇，登記於 `IDENTITY_CLUSTERS`）。**刻意不塞進名冊簇**——名冊是「後端推送的『誰』」，而直連狀態是**傳輸層**的事實，隨網路來去、與這個人是不是我的聯絡人無關；塞進去會讓「誰」這一簇同時背負連線生命週期，正是 ADR-0331 §1 想避免的「什麼都懂的物件」。它與通話簇同型：小、只由後端事件驅動、只餵一個畫面元素。依 ADR-0332 2c **不提供 `reset()`**——`AppSession` 已掛 `key={身分+世代}`，重掛即歸零，多一個沒人呼叫的 `reset()` 只是死程式碼。

**五、大檔走中繼時提示（`file-gate.ts`）**

- 門檻 **50 MB**（`RELAY_FILE_WARN_BYTES`）。取捨：低於既有的 `DEFAULT_MAX_FILE_SIZE`（100 MiB）故兩者不打架；日常的照片、語音、文件都遠在門檻之下 ⇒ 一般使用者不會看到這個提示，**看到就代表真的是大檔**。
- **提示，不封鎖。** 門檻到了只問一句並讓使用者決定。理由與 ADR-0210／0213 同一條：這不是錯誤，檔案真的送得出去，只是慢且耗中繼流量——做成阻擋就是替使用者決定他的檔案不重要。
- **`unknown` 保守當成會走中繼，但話說得不一樣。** 判不出來時仍然提示（把關情境保守，見 §決策二），但文案必須誠實區分「確定在中繼上」與「無法確認」。把後者說成前者就是假警報，而 ADR-0210 拿掉全域 P2P 錯誤提示正是因為假警報會讓使用者不再相信提示。故 `RelayFileWarning` 帶 `path` 欄位，i18n 有 `fileGate_relayWarn`／`fileGate_unknownWarn` 兩句，並由 `i18n.test.ts` 的文案紅線鎖住（比照 ADR-0302 §4 的 FS 文案）。
- **群組扇出（ADR-0124）任一成員在中繼上就提示**：位元組是逐一扇出的，一個成員在 TURN 上就是一份完整的計費流量。`relay` 優先於 `unknown`——確定的事實比「不知道」更值得拿來說。
- `ChatBackend.checkFileSend(to, sizeBytes)` 負責把「一個 `to`」解析成「哪些人的路徑要查」（1:1＝一個人；群組＝每位成員**扣掉自己**），內部走 `refreshIcePath()` 取新鮮值而非快取。
- ⚠ **與 ADR-0162 的 relay 檔案暫存無交集**：那條路徑根本不碰 TURN，且上限 `relayFilesMaxMb` ≤ 16 MB，遠低於本門檻，故不可能同時成立。
- 順帶收掉一份重複：`formatBytes` 桌面與行動端各有一份一模一樣的實作，提示文案又要用同一個格式 ⇒ 三份會漂移，統一收進 `file-gate.ts`。

## 理由

- **先量測，再立法。** 大檔串流（拆 100 MiB 天花板）會放大 TURN 這條計費入口；在有能力分辨路徑之前就拆，等於盲目放大。本 ADR 是那件事的前置條件，刻意不含任何限制邏輯。
- **Fix First。** 沿用既有的 `onConnectionState` → `onPeerConnection` → 晶片這條線，只加一個參數與一個純函式模組，不新增機制、不動協定、不動 relay。
- **誠實優先於樂觀。** 已連線但未測出路徑時**不**沿用「⚡直連」——那是在沒測之前替使用者假設最好的情況。寧可先顯示中性的「🔗已連線」，等探測回來再轉正。這與 ADR-0213 對「連線握手期顯示未建立」的取捨同一條原則。
- **隱私不變。** `getStats()` 是純本機讀取，不與中繼互動、不新增外洩面。

## 後果

- 正面：使用者第一次能看出「我連上了，但走的是中繼」——解釋了為何同樣是「已連線」，檔案速度天差地遠。程式端拿到 `refreshIcePath()`，大檔把關、TURN 用量觀測、通話品質提示都能建立在同一個判定上。
- 負面／已知殘餘風險：
  - **四態晶片的短暫轉場**：通道開啟到首次探測回來之間會顯示「🔗已連線」再轉為「⚡直連」。這是刻意的（見上），但比 ADR-0213 的兩態多一次視覺變化。
  - **15 秒後的路徑切換不會自動反映**在晶片上（ICE restart、網路切換）。呼叫端要正確值時以 `refreshIcePath()` 重測；常駐輪詢的成本被判定不值得。
  - **判定有 `unknown` 的實際發生率未量測**：多組 succeeded 配對且無 `transport`/`selected` 線索時會落到 `unknown`。實務上 ①② 兩條路徑涵蓋主流瀏覽器，但沒有真實環境數據佐證。
  - **兩個 UI 呼叫點沒有自動化測試**：純判定（`file-gate.test.ts`）、後端對象解析（`file-gate-backend.test.ts`）、文案紅線（`i18n.test.ts`）都有測；但「桌面 `sendFileBytes` 與行動端 `passesFileGate` 真的有攔在送出之前」只靠 typecheck 與人看。兩端的 App 層都沒有可驅動送檔流程的測試基座（桌面 `App.test.tsx` 只測匯出的純函式，行動端 app 殼測試是 SSR）。
  - **提示只在送出當下判斷一次**：使用者按下「仍要傳送」之後若路徑變了（或本來就在排隊等通道開），不會再問第二次。這與「提示而非封鎖」一致——問過了就尊重決定——但它不是一個持續的閘門。
  - **TURN 用量本身仍未觀測**：這個提示減少的是「使用者不知情地送大檔」，不等於站方看得到用量。ADR-0342 §2 的結論（真正把上限釘死的只有帳單警示）未被本 ADR 改變。
  - **色票對齊靠測試而非機制**：`msn.css` 的三個色值與 `P2P_PATH_COLORS` 是各自寫死、由 `p2p-path.test.ts` 斷言比對（沿用 `tokens.test.ts` 的作法）。改一邊沒改另一邊會紅，但仍不是「不可能寫錯」。
- 後續行動／待辦：
  1. **串流化**：閘門已就位，可以開始動 `DEFAULT_MAX_FILE_SIZE`（100 MiB）與串流化——發送端惰性分塊（`encodeFile` 目前一次 materialize 全部框架）、接收端串流落盤（OPFS／Tauri fs）。⚠ 天花板一拆，本 ADR 的門檻就會變成**唯一**攔在使用者與「不知情地經中繼送出數 GB」之間的東西，屆時應重新檢視 50 MB 是否仍合適。
  2. 替兩個 UI 呼叫點補測試基座（見上方殘餘）。
  3. `selectTransport()`／`Reachability`／`FILE_TRANSPORT_ORDER`（`packages/core/src/connection.ts`）目前是**死碼**——只有測試引用，實際路徑由 ICE 透明決定。本 ADR 讓「實際走哪條」首次可觀測；那組抽象該接上真實判定或刪除，另案處理。
