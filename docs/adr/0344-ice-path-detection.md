# 0344. ICE 路徑判定：分辨「直連」與「經 TURN 中繼」

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0213（對話標題列 P2P 直連品質晶片）、ADR-0243（WebRTC TURN 保底與成本評估）、ADR-0342（TURN 閘門三層）、ADR-0210（一般模式加預設 STUN）、ADR-0017/0029（P2P 檔案傳輸與二進位分塊）、`packages/engine/src/backend/ice-path.ts`

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

⇒ 本 ADR 只做**判定**，不做政策。把「我在哪條路上」變成程式讀得到的事實，是替大檔把關的前置條件。

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

**三、探測時機（`WebRtcTransfer`）**

- 資料通道 `onopen` 時排定**有界**的幾次探測：0 / 1s / 4s / 15s。
  - 為什麼不只測一次：ICE 會**先用能通的配對、之後才換到更好的**（典型是先 relay，打洞成功後升級為直連）。只在 `onopen` 測一次會把那條連線永久標成「經中繼」。
  - 為什麼不常駐輪詢：`getStats()` 不是免費的，而每位在線聯絡人都有一條連線。有界的補測涵蓋提名塵埃落定的視窗即足夠。
- `icePath(peer)`：同步讀快取，零成本。
- `refreshIcePath(peer)`：立即重測。**送大檔前該叫的是這個**——快取只在通道開啟後前 15 秒內補測過，之後的切換（ICE restart、Wi-Fi 換 4G）不會反映。真正在意成本的時刻重測一次，很便宜。
- 通道關閉／`connectionState==="failed"`：清掉排程中的計時器並把路徑歸零，不留下過期判定。計時器一律 `unref()`（Node 下不吊住行程；瀏覽器無此方法，故為可選呼叫）。

**四、回報與呈現**

- `TransferHandlers.onConnectionState(peer, connected, path?)` ／ `ChatBackendEvents.onPeerConnection(contact, connected, path?)` 加上第三個參數。通道一開先發 `unknown`，測出來且**與前次不同**才再發一次 ⇒ **同一條連線會收到多次 `connected=true`**，UI 必須能吃重複（`App.tsx` 兩個 state 各自去重）。
- `ChatBackend.refreshIcePath?(to)` 供未來的把關呼叫。
- 晶片由兩態擴為四態（`p2pChipSpec` 抽為純函式，可單測）：

| 狀態 | 呈現 | 語意 |
| --- | --- | --- |
| 未連線 | `⚪ 直連未建立`（低調灰） | 降級走 relay，文字不受影響（ADR-0213 原樣） |
| `direct` | `⚡ 直連`（綠 `.on`） | 位元組兩端直走 |
| `relay` | `🔁 經中繼`（琥珀 `.relay`） | 走 TURN：仍端到端加密，但較慢、且是計費路徑 |
| `unknown` | `🔗 已連線`（中性 `.up`） | 連上了，路徑尚未測出 |

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
  - **只接上了檔案傳輸的連線**（`WebRtcTransfer`）。`WebRtcCall` 的連線同樣有路徑之分（且通話正是 ADR-0243 成本論證的主體），尚未接上——判定模組是共用的，接上只是接線工作。
  - **行動端未對齊**：晶片仍僅桌面/瀏覽器 `ConversationWindow`（沿用 ADR-0213 的殘餘）。
- 後續行動／待辦：
  1. **大檔 TURN 閘門**（本 ADR 的目的）：送檔前 `refreshIcePath()`，`relay`（與保守處理的 `unknown`）超過門檻時提示改用公司儲存槽或等直連。門檻值與 UX 為獨立產品決策。
  2. 把判定接上 `WebRtcCall`。
  3. 待 1 落地後，才動 `DEFAULT_MAX_FILE_SIZE` 與串流化（發送端惰性分塊、接收端串流落盤）。
  4. `selectTransport()`／`Reachability`／`FILE_TRANSPORT_ORDER`（`packages/core/src/connection.ts`）目前是**死碼**——只有測試引用，實際路徑由 ICE 透明決定。本 ADR 讓「實際走哪條」首次可觀測；那組抽象該接上真實判定或刪除，另案處理。
