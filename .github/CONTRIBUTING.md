> 🌐 **English** · [English version](./CONTRIBUTING.en.md)

# 參與 Cinderous 開發

歡迎社群開發者。Cinderous 是**去中心化、端到端加密**的即時通訊（Nostr + WebRTC），AGPL-3.0。這份文件是開發者的入口——不論你是想**接自己的前端**、**加一種語言**、**做擴充**，還是**貢獻核心**，都從這裡開始。

> 一般使用者請看 [`docs/使用手冊_User-Guide.md`](../docs/使用手冊_User-Guide.md)。

---

## 三層架構（先懂這個）

Cinderous 刻意把「協定/加密」「通訊引擎」「畫面」分成三個 workspace 套件，讓你只碰需要的那層：

```
你的前端（React / RN / Vue / 任何框架）        ← 蓋 UI，消費 ChatBackend
  ▲
@cinderous/engine   通訊後端（ChatBackend 實作）＋ 儲存抽象   ← 直接重用
  ▲
@cinderous/core     金鑰/簽章/NIP-44/59/群組/WebRTC 信令     ← 零 UI 依賴
@cinderous/i18n     翻譯（純函式）
```

| 套件 | 職責 | 你會碰它嗎 |
| --- | --- | --- |
| `@cinderous/core` | Nostr 事件/簽章/加密/協定原語（SSOT） | 重用，不改 |
| `@cinderous/i18n` | 翻譯；支援執行期語系包（K3） | 加語言時 |
| `@cinderous/engine` | `ChatBackend` 契約＋`RelayChatBackend`/`BrowserChatBackend`＋`AppStorage`/`LocalStorage`；換機/搬家/快照/擴充縫 | 建後端時 |
| `apps/desktop` | Tauri + React 桌面前端 | 參考範本 |
| `apps/mobile` | react-native-web 前端（已消費 engine，跨前端重用實證） | 參考範本 |
| `relay` | Cloudflare Worker / Node 自架中繼站 | 自架時 |

---

## 開發環境

需求：**Node 22+**、**pnpm 10+**（Rust 測試另需 stable toolchain）。

```bash
git clone https://github.com/VaalRL/Nostr-buddy.git cinder && cd cinder
pnpm install          # 安裝 workspace 相依
pnpm -r test          # 全部 TS 測試（core / engine / relay / desktop / mobile / i18n）
pnpm -r typecheck     # 全部型別檢查
```

跑桌面前端（瀏覽器開發、不需 Tauri）：

```bash
pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev   # 本機真實 relay（ws://localhost:8787）
pnpm --filter @cinderous/desktop dev                                          # 前端；開 /?relay=ws://localhost:8787
```

---

## 你想做什麼？

### A. 接你自己的前端

最常見的社群場景。完整教學見 **[`docs/前端開發指南_Frontend-Guide.md`](../docs/前端開發指南_Frontend-Guide.md)**。三句話版：

```ts
import { RelayChatBackend, webSocketConnector, LocalStorage, type ChatBackend } from "@cinderous/engine";
const backend: ChatBackend = new RelayChatBackend(new LocalStorage(""), webSocketConnector("wss://…"), "名稱", { relayUrl: "wss://…", connectorFor: webSocketConnector });
backend.start({ onContacts: render, onMessage: append, onTyping: t, onNudge: n }); // 你只管畫面
```

`apps/mobile/src/chat.ts` 是「非桌面前端消費同一套引擎」的最小活範本。

### B. 加一種語言（K3）

不必改核心——執行期註冊即可：

```ts
import { registerLocale, availableLocales } from "@cinderous/i18n";
registerLocale("ja", { /* 完整 Messages 物件 */ });
// 之後 translate("ja", key) 生效；未覆蓋的鍵回退預設語系
```

或把語言直接加進 `packages/i18n/src/messages.ts` 成為內建語系（送 PR）。

### C. 換主題 / 配色

桌面 UI 已 token 化：覆寫單一 `--accent` CSS 變數即連動整體（其餘由 `color-mix` 推導），亮/暗由 `data-theme` 屬性切換。自寫前端則完全自由——`ChatBackend` 不綁任何 CSS。

### D. 做擴充（K4，實驗性）

`@cinderous/engine` 預留了行程內、第一方的擴充註冊縫：

```ts
import { registerExtension, listExtensions } from "@cinderous/engine";
registerExtension({ id: "my.renderer", name: "自訂訊染" /* …你的能力 */ });
```

> ⚠️ **載入第三方/遠端程式碼的機制尚未實作**——涉及沙箱與信任邊界，將由 K4 專屬 ADR 定案。目前僅供自家程式組合，勿載入不受信任者。

### E. 貢獻核心 / 修 bug / 加功能

見下方「貢獻規範」。

---

## 貢獻規範（PR 門檻）

本專案有很強的**決策紀錄文化**，請先讀再動手：

1. **先讀** [`PRD.md`](../PRD.md)（產品規格）、[`ARCHITECTURE.md`](../ARCHITECTURE.md)（模組邊界）、[`docs/adr/`](../docs/adr)（為何如此決策）。
2. **架構/設計層級的決策必須加一份 ADR**（模組邊界、加密/協定選型、資料流、隱私取捨、外部依賴等）——格式見 [`docs/adr/0000-template.md`](../docs/adr/0000-template.md)，並更新索引。ADR 一旦「已接受」即不可竄改；決策改變請新增一份並標記舊的被取代。
3. **功能程式碼走 TDD**（Red → Green → Refactor），測試即文件。
4. **PR 前** `pnpm -r typecheck` 與 `pnpm -r test` 必須全綠；動到 Rust 則 `cargo test`。
5. **隱私第一**：明文與私鑰不得離開裝置；中繼站只轉發密文與 Ephemeral 狀態，不持久化線上狀態。
6. **Fix First**：優先修正/延伸既有設計，不要建立 `v2`／`new_*`／`*_enhanced` 平行路徑。
7. 改動模組邊界、Nostr 事件契約或 WebRTC 流程，**同步更新** `ARCHITECTURE.md`。

---

## 授權（重要）

Cinderous 是 **AGPL-3.0**。你 fork、修改、散布的自由受保障——**但**只要你**散布**修改版、或把它**架成網路服務給別人用**，就**必須以 AGPL 公開你的原始碼**（含你的前端）。這代表**做不出閉源/商用的自訂客戶端**：對開放生態是保護，對想閉源者是硬門檻。提交 PR 即表示你同意以 AGPL-3.0 釋出你的貢獻。

---

## 自架中繼站

想跑自己的 relay？見 [`docs/self-hosting-zeabur.md`](../docs/self-hosting-zeabur.md)（PaaS 一鍵、自動 wss）或 [`docs/self-hosting-raspberry-pi.md`](../docs/self-hosting-raspberry-pi.md)（家用/樹莓派）。

有問題就開 issue。歡迎你的第一個 PR。
