# 研究：把 Cinderous 外掛進其他服務當「通訊功能」的可行性

> 目的：評估 Cinderous 是否／如何能被**嵌入第三方服務**，作為其站內通訊（DM／群聊／通話）能力。
> 判準：是否相容本專案硬規則——**Serverless、E2E 加密、零伺服器狀態、Gift Wrap 元資料隱藏、
> 本地優先、金鑰不離裝置**——以及授權（AGPL-3.0）現實。結論先行，細節在後。
> 相關：ADR-0074（core→engine→frontend 三層）、ADR-0209/0090/0147（webapp 獨立 origin、金鑰邊界）、
> ADR-0166（營利面與 AGPL 盤點）、ADR-0052/0163（企業身分輪替／名冊）、`packages/engine`、`extensions.ts`。

## 結論摘要

技術骨架**已到位一大半**——ADR-0074 早就把架構拆成「core → engine → frontend」，**就是為了讓別人接自己的前端**。
真正決定「能怎麼外掛」的不是技術，而是**兩道硬約束**：授權層（AGPL）與產品層（零知識／金鑰邊界）。
**可行，但形態被這兩道閘嚴格框住。** 最可行是 ①協定層互通 與 ④嵌入式 SDK/widget；直接 iframe 現有 webapp 最卡。

| 形態 | 耦合 | 現成度 | 適配度 | 主要阻礙 |
| --- | --- | --- | --- | --- |
| **① 協定層互通（federation）** | 最鬆 | 協定開放、現成 | 🟢 高 | 對方須自行實作群組/presence/信令慣例；**無 AGPL 牽連** |
| **② iframe 現有 webapp** | 中 | webapp 已存在 | 🔴 低 | 與既有安全模型衝突；第三方 iframe 儲存被分區→**金鑰無法持久**；可能擋 framing |
| **③ SDK：import `@cinderous/engine` 自建 UI** | 緊 | 引擎已 headless | 🟡 中 | **AGPL**：連結進宿主＝衍生作品→宿主須開源 |
| **④ 嵌入式 UI widget（`@cinderous/widget`）** | 緊 | ⚠️ 尚未做 | 🟡 中 | AGPL＋須新建 widget 套件 |
| **⑤ 伺服端橋接／bot（Node）** | 中 | engine relay 後端可重用 | 🟡 中 | WebSocket 要 polyfill；**Node 無 WebRTC→只有 relay 訊息、無 P2P**；AGPL 仍適用 |

---

## 1. 手上已有的「可嵌入資產」

| 資產 | 現況 | 對嵌入的意義 |
| --- | --- | --- |
| **三層架構（ADR-0074）** | core（加密/協定）→ `@cinderous/engine`（headless）→ frontend | 引擎與 UI 徹底解耦，別人不必 fork 整包桌面 |
| **`ChatBackend`／`ChatBackendEvents` 契約** | 命令＋事件雙向，DTO 與 core 隔離；兩實作 `RelayChatBackend`／`BrowserChatBackend` | 這就是現成的「嵌入 API 表面」 |
| **可注入儲存 `AppStorage`** | local/memory/OPFS 三實作，平台金鑰庫由前端注入 | 宿主可注入自己的儲存／金鑰保管 |
| **建在開放 Nostr 協定上** | NIP-17/44/59 Gift Wrap | **任何人都能寫相容客戶端互通，完全不碰我們的碼** |
| **獨立 origin 的瀏覽器 webapp** | ADR-0208/0209，已部署 | 潛在的 iframe／連結目標 |
| **擴充縫 `extensions.ts`** | K4 實驗性，**僅第一方、行程內註冊**；載入第三方碼待專屬 ADR | 目前不能安全載入第三方程式 |

## 2. 五種「外掛」形態

### ① 協定層互通（federation）🟢 高
第三方自行實作 Nostr 客戶端／bridge，即可與 Cinderous 使用者互通。**完全不觸發 AGPL**（對方寫自己的碼），
最符合去中心化本義。代價：對方須比對我方的**群組模型、presence、WebRTC 信令慣例**（純協定不涵蓋這些應用層約定）。

### ② iframe 現有 webapp 🔴 低（最卡）
ADR-0209/0090/0147 是**刻意**讓 webapp 跑在獨立 origin、**不 iframe**——目的就是「宿主被入侵也換不掉 app 的 JS、
碰不到金鑰」。跨 origin iframe 雖能保住金鑰隔離，但現代瀏覽器（Safari ITP、Chrome 儲存分區）會把
**第三方 iframe 的 localStorage/IndexedDB/OPFS 分區或封鎖**→ 使用者一重整**身分就掉**；app 也可能設 frame-ancestors
擋 framing。要能用得先解決第三方儲存持久化，技術債不小，且與既有安全立場拉扯。

### ③ SDK：import `@cinderous/engine` 自建 UI 🟡 中
引擎已是乾淨 headless package，技術上直接可用（實作 `ChatBackend` 的消費端＋注入 `AppStorage`）。
但**連結進宿主＝衍生作品→宿主須 AGPL 開源**（見 §3.1）。適合開源／自架宿主。

### ④ 嵌入式 UI widget（`@cinderous/widget`）🟡 中
engine + brand + 精簡 React 聊天元件，給宿主 drop-in。**尚未做**（UI 現埋在 `apps/desktop`）。
需同時定義 host↔widget 的 postMessage 契約（身分交接、主題、事件）。AGPL 同③。

### ⑤ 伺服端橋接／bot（Node）🟡 中
Node bridge 對接自家系統。engine 的 relay 後端可重用，但 **Node 無 `RTCPeerConnection`→無 P2P**
（通話/檔案 P2P 不可用，relay 訊息可以）；`WebSocket` 要 polyfill。AGPL 仍適用。

## 3. 四道跨形態的硬約束（研究重點）

### 3.1 🔴 AGPL-3.0（最關鍵的商業閘）
把 engine/widget 連結進宿主＝衍生作品，**宿主（含 SaaS 網路使用）也必須 AGPL 開源**。
- 開源宿主：沒問題。
- 閉源／商用宿主：硬 blocker。解法僅 (a) 對方也開源、(b) 走**協定層互通**（不觸發 copyleft）、
  (c) **雙授權**——但雙授權需著作權集中（CLA），Cinderous 為社群 AGPL 專案，目前無此條件（見 ADR-0166）。

### 3.2 🔴 零知識／金鑰邊界
核心承諾是「明文與私鑰永不離開裝置、中繼零知識」。**宿主拿不到訊息內容，也拿不到金鑰**。
反過來限制一種常見期待：宿主想「記錄/審核/搜尋」對話——**做不到**（除非破壞 E2E）。
企業合規稽核只能走「自架封閉節點＋成員公鑰」模型（企業版），仍看不到明文。

### 3.3 身分橋接
Cinderous 身分＝一組 keypair（npub），**不是宿主帳號**。嵌入時身分來源要決定：
- **使用者自帶**（授權自己的 npub）——最去中心、UX 較重。
- **宿主用企業名冊發**（比照 ADR-0052/0163 工作身分輪替、邀請碼入職）——宿主 SSO ↔ Cinderous 身分需映射層。

### 3.4 WebRTC／瀏覽器 API
engine 依賴 `RTCPeerConnection`／`WebSocket`→ 目標 web/RN 前端；**純 Node 宿主無 P2P**（relay 訊息可、通話/檔案 P2P 不可）。

*(附帶：元資料——relay 為 presence 會見聯絡人清單；嵌入不改變此點，對隱私敏感宿主須說明。)*

## 4. 建議路線（由易到難）

1. **短期（低風險、無授權牽連）**：寫「協定互通規格」＋一個 Node **reference bridge**（WebSocket polyfill、relay-only 訊息），
   對方照規格自行實作 → 不觸發 AGPL，最符合去中心化本義。
2. **中期**：抽 `@cinderous/widget`（engine＋brand＋精簡 React 聊天元件）＋嵌入 SDK 文件＋host↔widget postMessage 橋，
   給 **AGPL 相容或自架** 宿主 drop-in。
3. **決策卡點：授權立場**。維持純 AGPL（只吃開源/自架宿主）？還是要吃閉源商用（需雙授權/CLA，大工程與治理決策）？
   —— 這是**商業決策**，直接決定 SDK 路線的市場。
4. 每個實作階段各立 ADR；K4（第三方碼載入）本就欠一份專屬 ADR。

## 5. 待裁示（決定往哪走）

1. **目標宿主是開源還是閉源商用？** → 決定 AGPL 是否 blocker、要不要碰雙授權。
2. **嵌入時身分怎麼來？** → 使用者自帶 vs 宿主企業名冊發（SSO 映射）。
3. **宿主需不需要看得到訊息內容？** → 若需要，與 E2E 零知識**根本衝突**，須先談 trade-off
   （通常答案是「不給看，改用企業自架節點＋公鑰治理」）。

> 本文件為**研究記錄、非決策**。一旦選定路線（如「做協定互通規格＋reference bridge」或「抽 `@cinderous/widget`」），
> 再依該路線另立 ADR。
