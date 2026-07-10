# 0074. 社群自訂前端：三層封裝與 `@cinder/engine` 抽取

- 狀態：已接受
- 日期：2026-07-10
- 相關文件：ARCHITECTURE.md、docs/adr/0018（Tauri 殼與 IPC）、0034/0041（relay pool／outbox）、
  0045（多身分）、0053/0054（金鑰庫／加密儲存）、0063（行動端骨架，重用 core/i18n）、
  0064（自訂主題色）、apps/desktop/src/backend/、apps/desktop/src/storage/、apps/mobile/

## 背景與問題

目標：讓社群開發者能接自己的前端（Web/RN/其他框架），而非只能 fork 整包桌面 app。

現況盤點（已驗證）：

- **邏輯層已與 UI 徹底解耦**：`@cinder/core`（36 個純協定/加密模組、零 React 依賴）、
  `@cinder/i18n`（零 dependencies、純函式）——任何前端都能重用。
- **有乾淨的前端↔通訊契約**：`ChatBackend`／`ChatBackendEvents` 介面（命令＋事件雙向，
  附一組與 core 隔離的 UI DTO：`Contact`／`ChatMessage`／`Self`…），且已有兩個實作
  `BrowserChatBackend`／`RelayChatBackend`；Tauri 靠**注入** `TauriStorage`／keyvault 到
  同一個 `RelayChatBackend`（不另開後端）——介面乾淨度的最強證據。
- **但引擎困在 desktop 套件裡**：`ChatBackend` 介面、兩個實作、`AppStorage`／`LocalStorage`、
  DTO 全埋在 `apps/desktop/src/{backend,storage}/`，**不是獨立 workspace package**。
- **跨前端重用尚未實證**：`apps/mobile` 目前只接 core/i18n，**還沒消費 `ChatBackend`**
  （ADR-0063 把引擎接線列為後續）。所以「後端 adapter 可跨前端重用」尚未被跑通。
- 無執行期外掛／主題／語系機制；授權為 AGPL-3.0（散布/架站的衍生前端須同樣開源）。

亦即：架構骨架到位，卡點是**工程封裝缺口**——引擎沒抽成 package，新前端要嘛依賴整包
`@cinder/desktop`（連 React/Tauri 拖進來），要嘛自行抽取。

## 考量的選項

- 選項 A：維持現況（社群 fork 整包 desktop）——拖入 React/Tauri、耦合重，門檻高。
- 選項 B：**抽 `@cinder/engine` ＋ 前端開發指南**（採用）——結構性解鎖，見決策。
- 選項 C：現在就做完整 in-app 外掛/插槽生態——過早、面積大；拆為後續選配階段（K4）。

## 決策

分四個可獨立交付的階段（ROADMAP Phase K），社群能力逐階遞增；每階都獨立有價值。

1. **K1 前端開發指南（零程式）**：`docs/` 寫一份「如何接自己的前端」——三層心智模型、
   要裝哪些 package、實作/消費 `ChatBackend`、以 `apps/mobile` 為範本。風險零、立即可用。
2. **K2 抽 `@cinder/engine`（結構解鎖）**：新 workspace 套件，把**與 UI 無關但屬 app 執行期**
   的東西上移——`ChatBackend`/`ChatBackendEvents` 介面、DTO（`Contact`/`ChatMessage`/`Self`
   /`ConnectionState`/`Status`…）、`RelayChatBackend`/`BrowserChatBackend`、`AppStorage`
   介面＋`LocalStorage`、`RelayConnector`/`webSocketConnector`/`RelayPoolOptions`。
   平台特有基質（`TauriStorage`、keyvault IPC）**留在 desktop**，經同一介面注入。
   同步把 `apps/desktop` 與 `apps/mobile` 改接 `@cinder/engine`——**mobile 接上後端即
   實證「後端 adapter 可跨前端重用」**，一石二鳥。
   邊界註記：引擎用到瀏覽器級 API（`RTCPeerConnection`、`WebSocket`），故目標是
   web 類前端（Web/RN＋polyfill/Tauri webview）；純 Node 前端不在此列。
3. **K3 執行期語系/主題包（選配）**：`Locale` 由固定 union 放寬為可註冊；主題以資料
   驅動的方式讓社群 drop-in 語系/配色，免改原始碼重編。需小幅調整 i18n（ADR-0064 主題已
   token 化，擴充成本低）。
4. **K4 前端外掛/插槽（選配，另立 ADR）**：讓第三方在**同一個 app**注入自訂 UI（不 fork）。
   面積最大、涉及安全邊界（第三方程式碼載入），單獨立 ADR 設計。

## 理由

- 三層清楚化——**core（加密/協定原語）→ engine（可用的 ChatBackend 實作）→ frontend**
  ——讓「接前端」從「要懂 monorepo 內部」變成「裝三個套件、實作介面」。
- K2 的重構同時把 mobile 的後端接線做掉，順帶還清 ADR-0063 的技術債。
- 分階段讓投入與野心對齊：多數社群需求 K1+K2 已滿足；K3/K4 有生態需求再做。

## 後果

- 正面：社群可重用引擎自建前端，不必拖入 React/Tauri；跨前端重用獲得實證；分層文件化。
- 負面／已知殘餘風險：
  - K2 是跨套件重構，會動到 desktop/mobile 大量 import 路徑（多為機械式搬移）；DTO 位置
    改變。以 TDD／typecheck 全綠護欄，分批搬移降風險。
  - AGPL 強 copyleft：社群自訂前端可 fork/改/散布，但衍生版（含架站）須同樣 AGPL 開源
    ——對開放生態有利，對閉源/商用自訂前端是硬門檻（指南須點明）。
  - 引擎的瀏覽器級 API 依賴使「純 Node 前端」不在支援範圍（可接受的取捨）。
- 後續行動 / 待辦：依 ROADMAP Phase K 施工（K1 指南 → K2 抽 engine ＋ desktop/mobile 改接
  → K3/K4 選配）；K2 完成後更新 ARCHITECTURE.md 的模組邊界；K4 另立 ADR。
