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

> 📦 **封裝現況**：三層都已是獨立 workspace 套件、可直接依賴——`@cinder/core`（協定/加密）、`@cinder/i18n`（翻譯）、**`@cinder/engine`（通訊後端＋儲存抽象，ADR-0074 K2 已完成）**。你 `import { RelayChatBackend, LocalStorage, type ChatBackend } from "@cinder/engine"` 即可，不必 fork desktop、不會拖入 React/Tauri。平台特有基質（Tauri 金鑰庫/加密儲存）留在各 app，經 `AppStorage` 介面注入。

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
import { RelayChatBackend, webSocketConnector, LocalStorage } from "@cinder/engine";

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

介面定義在 `@cinder/engine`（`packages/engine/src/backend/types.ts`）。設計成「少數必要、多數可選」，讓你能只實作/消費需要的部分。

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

- `apps/mobile/package.json`：依賴 `@cinder/core` + `@cinder/i18n` + `@cinder/engine` + `react-native-web`，**不依賴 `@cinder/desktop`**。
- `apps/mobile/src/screens/ContactListScreen.tsx`：用 RN 元件（`View`/`Text`）撰寫，重用 core 的 `npubEncode` 與 i18n 的 `translate`——純呈現層。
- `apps/mobile/src/chat.ts` ＋ `chat.test.ts`：**用 `@cinder/engine` 的 `BrowserChatBackend` 驅動通訊**——這就是「非桌面前端消費同一套引擎」的活實證（測試會斷言 start 後收到聯絡人）。

---

## 6. 主題與外觀（ADR-0064）

桌面 UI 的外觀已 **token 化**：單一 `--accent` CSS 變數覆寫即連動整個介面（其餘顏色由 `color-mix` 從 `--accent` 推導），亮/暗由 `data-theme` 屬性切換。所以：

- 你若沿用桌面樣式，改一個 `--accent` 就能整體換色。
- 你若自寫樣式，完全自由——`ChatBackend` 與畫面無關，不綁任何 CSS。

（目前是 build/source 層的可改性；「執行期主題包/語系包 drop-in」是 Phase K3 的選配。）

---

## 7. 加語言（i18n）

兩種方式：

- **執行期語系包（K3 縫已預留）**：不改核心、不重編譯——`registerLocale("ja", { …完整 Messages })` 即可，之後 `translate("ja", key)` 生效，未覆蓋的鍵自動回退預設語系。`availableLocales()` 列出目前可用語系。
- **內建語系**：把語言加進 `packages/i18n/src/messages.ts` 並擴充 `Locale` union，送 PR 成為官方語系。

```ts
import { registerLocale, availableLocales, createT } from "@cinder/i18n";
registerLocale("ja", { /* 完整 Messages 物件 */ });
const t = createT("ja");
```

---

## 7.5 做擴充（K4 縫，實驗性）

`@cinder/engine` 預留了行程內、第一方的擴充註冊縫：

```ts
import { registerExtension, listExtensions } from "@cinder/engine";
const off = registerExtension({ id: "my.renderer", name: "自訂訊染" /* …你的能力 */ });
```

> ⚠️ **載入第三方/遠端程式碼的機制尚未實作**——涉及沙箱與信任邊界，將由 K4 專屬 ADR 定案。目前僅供自家程式組合。

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

有問題或想要更多範本（例如 Vue/Svelte 起手），回報給維護者。
