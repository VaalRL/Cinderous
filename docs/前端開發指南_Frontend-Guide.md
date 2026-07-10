# Cinder 前端開發指南（接你自己的 UI）

> 給想用**自己的前端**（Web / React Native / Vue / Svelte / 純 Web Components…）接上 Cinder 通訊能力的社群開發者。你不需要重寫任何加密、Nostr 協定或 WebRTC——那些已經是**與 UI 無關的共用套件**，你只要蓋 UI。

---

## 1. 心智模型：三層

Cinder 刻意把「協定/加密」「通訊引擎」「畫面」分成三層。你寫前端＝只碰最上層。

```
┌─────────────────────────────────────────────┐
│  你的前端（React / RN / Vue / 任何框架）        │  ← 你寫這層
│  ─ 呼叫 ChatBackend 的方法送訊息               │
│  ─ 訂閱 ChatBackendEvents 收事件更新畫面        │
├─────────────────────────────────────────────┤
│  engine：可用的通訊後端（ChatBackend 實作）     │  ← 直接重用
│  ─ RelayChatBackend（真實 Nostr relay）        │
│  ─ BrowserChatBackend（記憶體 demo）           │
│  ─ AppStorage / LocalStorage（本機持久化）      │
├─────────────────────────────────────────────┤
│  @cinder/core ＋ @cinder/i18n                  │  ← 直接重用（零 UI 依賴）
│  ─ 金鑰/簽章/NIP-44/59/Gift Wrap/群組/WebRTC 信令 │
│  ─ 翻譯（純函式）                              │
└─────────────────────────────────────────────┘
```

**關鍵原則**：你的前端**只透過 `ChatBackend` 介面**跟通訊層溝通，幾乎不直接呼叫 core 做通訊。這讓你換一套 UI 只要「消費同一個介面」，不必碰底層。

> 已有實證：`apps/mobile`（react-native-web）就是第二套前端，重用 `@cinder/core` + `@cinder/i18n`——證明這套分層真的可換前端。

---

## 2. 你重用什麼、你自己寫什麼

| 層 | 套件 / 位置 | 你要做的事 |
| --- | --- | --- |
| 協定/加密 | `@cinder/core`（workspace 套件，零 React） | **直接裝來用**，不改 |
| 翻譯 | `@cinder/i18n`（零依賴，純函式） | **直接用**；要加語言見 §7 |
| 通訊後端 | `ChatBackend` 介面＋`RelayChatBackend`/`BrowserChatBackend` | **重用實作**；你只呼叫它、訂閱它 |
| 本機儲存 | `AppStorage` 介面＋`LocalStorage`（瀏覽器）／自訂 | 用現成的，或依介面接你的儲存 |
| **畫面** | — | **這才是你要寫的**：登入、聯絡人、對話視窗、設定… |

> 📦 **目前的封裝現況（重要）**：`@cinder/core` 與 `@cinder/i18n` 已是獨立套件、可直接依賴。**通訊後端（`ChatBackend`＋實作＋`AppStorage`）目前仍在 `apps/desktop/src/{backend,storage}/` 內**，尚未抽成獨立套件。ROADMAP **Phase K2** 會把它抽成 **`@cinder/engine`**——屆時你 `import { RelayChatBackend } from "@cinder/engine"` 即可。在那之前，最省事的做法是**以 `apps/desktop` 為範本 fork**，或把 `backend/` + `storage/` 目錄複製進你的專案（它們本身不依賴 React）。

---

## 3. 最小可運作前端：三步

### ① 產生或載入身分（用 core）

```ts
import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "@cinder/core";

const sk = generateSecretKey();          // 本機產生私鑰＝新身分
const npub = npubEncode(getPublicKey(sk)); // 給別人加你用的公開 ID
// 要持久化就存進你的 storage（見 AppStorage）；匯入既有身分用 nsecDecode。
```

### ② 建立通訊後端（重用 engine）

```ts
import { RelayChatBackend, webSocketConnector } from "<engine>"; // K2 後為 @cinder/engine
import { LocalStorage } from "<engine>";

const storage = new LocalStorage("");                 // 命名空間隔離多身分（空=預設）
const backend = new RelayChatBackend(
  storage,
  webSocketConnector("wss://你的中繼站"),              // home relay 連線工廠
  "顯示名稱",
  { relayUrl: "wss://你的中繼站", connectorFor: webSocketConnector }, // RelayPoolOptions
);
```

> 沒有 relay 網址？傳 `new BrowserChatBackend("名稱")` 進示範模式（記憶體 relay，離線可玩）。

### ③ 接上你的畫面：呼叫方法、訂閱事件

```ts
backend.start({
  onContacts: (contacts) => renderContactList(contacts),   // 聯絡人變動
  onMessage:  (pubkey, msg) => appendMessage(pubkey, msg),  // 收到新訊息
  onTyping:   (pubkey) => showTyping(pubkey),
  onNudge:    (pubkey) => buzz(pubkey),
  onConnection: (state) => setConnBadge(state),             // online/connecting/offline
  // …其餘事件都是可選的，你要哪個就接哪個
});

// 使用者操作 → 呼叫方法
backend.addContact?.("npub1…@wss://對方的站"); // 加好友（可帶對方 relay 提示）
backend.sendMessage("對方 pubkey", "嗨");
backend.setStatus("online", "在忙");
```

就這樣——**加密、Gift Wrap 包封、relay 路由、去重、離線補收全在 `RelayChatBackend` 裡自動處理**，你只管畫面。

---

## 4. `ChatBackend` 介面速查

介面定義在 `apps/desktop/src/backend/types.ts`（K2 後移入 `@cinder/engine`）。設計成「少數必要、多數可選」，讓你能只實作/消費需要的部分。

**必要成員**（每個後端一定有）：
`self`（自己的身分）、`start(handlers)`、`stop()`、`setStatus`、`setNowPlaying`、`sendMessage`、`sendTyping`、`sendNudge`。

**可選能力**（`?`，有才用；例如 demo 後端可以不實作通話）：
`sendReaction?`、`unsendMessage?`、`markRead?`、`sendFile?`、`createGroup?`/`sendGroupMessage?`、`startCall?`/`acceptCall?`/`hangupCall?`、`addContact?`/`removeContact?`/`blockContact?`、`changeRelay?`、`publishSnapshotNow?`/`purgeCloudSnapshot?`、`publishRoster?`（企業）、`selfNpub?`/`selfShareUri?`/`selfNsec?`。

**事件**（`ChatBackendEvents`，你在 `start()` 傳入的 handlers）：
必接 `onContacts`/`onMessage`/`onTyping`/`onNudge`；可選 `onHistory?`（開機回放歷史）、`onReaction?`、`onMessageStatus?`（送達/已讀）、`onConnection?`、`onRelayPool?`（各 relay 連線狀態 🟢🟡🔴）、`onFileProgress?`、`onCallState?`/`onCallLocalStream?`/`onCallRemoteStream?`、`onPolicy?`（企業政策）、`onIdentityRotated?`、`onCloudSyncMode?`。

**UI DTO**（介面回給你的資料型別，已與 core 的原始 Nostr 型別隔開）：
`Contact`、`Self`、`ChatMessage`、`ChatFile`、`BlockedContact`、`Status`、`ConnectionState`、`Group`。你的畫面直接吃這些，不必懂底層事件格式。

---

## 5. 以 `apps/mobile` 為活範本

想看「非桌面前端怎麼接」，直接讀 `apps/mobile`：

- `apps/mobile/package.json`：依賴 `@cinder/core` + `@cinder/i18n` + `react-native-web`，**不依賴 `@cinder/desktop`**。
- `apps/mobile/src/screens/ContactListScreen.tsx`：用 RN 元件（`View`/`Text`）撰寫，重用 core 的 `npubEncode` 與 i18n 的 `translate`——純呈現層。

> 註：mobile 目前只接了 core/i18n、還沒接 `ChatBackend`（Phase K2 會把後端抽成套件並讓 mobile 接上，屆時它就是「接了後端的完整範本」）。

---

## 6. 主題與外觀（ADR-0064）

桌面 UI 的外觀已 **token 化**：單一 `--accent` CSS 變數覆寫即連動整個介面（其餘顏色由 `color-mix` 從 `--accent` 推導），亮/暗由 `data-theme` 屬性切換。所以：

- 你若沿用桌面樣式，改一個 `--accent` 就能整體換色。
- 你若自寫樣式，完全自由——`ChatBackend` 與畫面無關，不綁任何 CSS。

（目前是 build/source 層的可改性；「執行期主題包/語系包 drop-in」是 Phase K3 的選配。）

---

## 7. 加語言（i18n）

`@cinder/i18n` 的 `Locale` 目前是固定 union（`"en" | "zh-Hant"`），`Messages` 是固定 key 集合。新增語言＝在 `packages/i18n/src/messages.ts` 加一份完整訊息物件並擴充 union，然後重編譯。

> 「丟一個 JSON 就能加語言」的執行期語系包是 Phase K3 的選配，尚未實作。

---

## 8. 授權：你必須知道的 AGPL

Cinder 是 **AGPL-3.0**。這對你的自訂前端意味著：

- ✅ **可以** fork、修改、散布你的前端——這是被保障的自由。
- ⚠️ **但**只要你**散布**修改版、或把它**架成網路服務給別人用**，就**必須以 AGPL 公開你的原始碼**（含你的前端）。
- 亦即：**做不出閉源/商用的自訂客戶端**。對開放生態這是保護（forks 保持開放），對想閉源的人是硬門檻。

---

## 9. 快速檢查清單

開始接你的前端前，確認你懂這幾點：

- [ ] 身分＝一把 `nsec` 私鑰，本機產生、你負責備份（見使用手冊）。
- [ ] 你只呼叫 `ChatBackend` 方法、訂閱 `ChatBackendEvents`——不直接碰加密。
- [ ] 沒 relay＝`BrowserChatBackend` 示範模式；有 relay＝`RelayChatBackend`。
- [ ] 多身分靠 `AppStorage` 的命名空間隔離。
- [ ] 你的衍生前端必須維持 AGPL 開源。

有問題、或希望 Phase K2 的 `@cinder/engine` 優先抽出來讓你更好接，回報給維護者。
