# 0247. 吉祥物 CinderMascot 抽為共用套件，並上三欄佈局與官網

- 狀態：已接受
- 日期：2026-07-24
- 相關文件：ADR-0064（主題色連動吉祥物）、ADR-0079（桌面三欄佈局）、ADR-0080（跨前端設計 token SSOT）、ADR-0187/0235/0246（官網）

## 背景與問題

吉祥物 `CinderMascot`（MSN buddy 藍身＋燭火頭，`alert` 態＝有新訊息）原本只存在於**桌面經典佈局**的 `ContactListWindow` 「me」自我狀態列（`me__mascot`）。

- **桌面三欄佈局（modern）**改用 `DeckSidebar`／`DeckRight`，不 render `ContactListWindow` → **吉祥物在三欄完全消失**（與其他三欄 parity 缺口同類）。
- **官網**是獨立套件 `apps/website`，只有 `CinderMark` logo、**沒有吉祥物元件**。

目標：把吉祥物帶到三欄與官網，並決定「怎麼共用同一顆吉祥物」。

## 考量的選項

- **共用策略**
  - A：**新增共用 React 元件套件 `@cinderous/brand`**，桌面與官網都 import。**（採用）**
  - B：比照 `@cinderous/theme` 的 `icons.ts`，只放**框架無關的幾何/資料**、各前端自繪。否決：吉祥物是含漸層/濾鏡/多路徑的**單體 SVG**，拆幾何再各自重繪等於複製渲染邏輯；theme 的幾何-only 是為了 **React＋React-Native 兩種 renderer** 共用，而吉祥物目前只上 React-DOM 兩個面（桌面 webview＋官網）。
  - C：複製一份進官網。否決：平行實作、違反 Fix-First/SSOT。
- **三欄放哪**：左欄自我列（鏡像經典）vs **中欄空狀態**。→ 依使用者裁示採**中欄空狀態**（「挑一個對話」的大隻待機吉祥物）。
- **官網放哪**：→ 依裁示採 **footer** 與 **404/空狀態**（Hero 副角暫不做）。
- **官網吉祥物身體色**：釘經典 MSN 藍 vs **跟站台 `--accent`**。→ 採**跟 `--accent`**（官網為橘紅火焰調）；因元件本就讀 `var(--accent)`，**同一顆元件各環境自動上色、免加 prop**。

## 決策

1. 新增 `packages/brand`（`@cinderous/brand`，React-DOM 元件，as-source 消費），輸出 `CinderMascot`（自 desktop `Brand.tsx` 原封搬移的向量）。
2. 桌面 `Brand.tsx` 改為 **re-export** 套件的 `CinderMascot`（`CinderMark` 維持本地——它是桌面專屬設計，與官網的 `CinderMark` 本就不同款，不強行合併）；既有 `./Brand.js` import 路徑不受影響。
3. **三欄**：中欄空狀態（`deckcenter__empty`）放 `size=104` 待機吉祥物＋柔和呼吸浮動（`prefers-reduced-motion` 時停）。
4. **官網**：頁尾 `footer__inner` 放 `size=34` 吉祥物；新增 **404 頁**（`renderNotFound`→`dist/404.html`，`size=132`＋「熄滅營火」文案＋回首頁）。身體吃站台 `--accent`（橘）。
5. 404 於預渲染時**剝掉 vite 注入的 app JS module script** → 純靜態、不 hydrate（否則 SPA 對未知路徑會 render 首頁、覆蓋掉 404 內容）；`robots: noindex`、不列入 sitemap。

## 理由

- 兩個消費面都是 React-DOM、用法一致（`<CinderMascot alert size />`），共用 React 元件是「抽共用套件」最忠實、最少樣板的解，且得到真正的 SSOT。
- `var(--accent)` 讓一顆元件在桌面吃使用者主題色、在官網吃橘 accent，無需分支。
- 404 剝 JS 是必要的：SPA 的 `parseRoute` 把未知路徑映射到首頁，若保留 hydration 會把靜態 404 內容換成首頁。

## 後果

- 正面：吉祥物在經典／三欄／官網一致現身；品牌資產單一來源；官網多了有溫度的 404。
- 負面 / 已知殘餘風險：**首個 ship JSX 的 workspace 套件**（新模式；tsc 與 vite 皆能處理——桌面與官網 build 皆已驗證）。**RN 版吉祥物**需另做 `react-native-svg` 埠（超出範圍）。桌面與官網的 `CinderMark` 仍各自一份（刻意不同款，未收斂）。
- 後續行動 / 待辦：如需，可再把吉祥物加到三欄左欄自我列與官網 Hero 副角（本次使用者暫未選）；RN 埠；未來若 `CinderMark` 要統一再評估併入 `@cinderous/brand`。
