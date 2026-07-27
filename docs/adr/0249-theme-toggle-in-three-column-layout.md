# 0249. 三欄佈局補明/暗切換鈕（抽 ThemeToggleButton 共用元件）

- 狀態：已接受
- 日期：2026-07-27
- 相關文件：ADR-0079（三欄/經典佈局切換）、ADR-0206（三欄＋Tauri 身分控制上移標題列）、ADR-0151（自繪標題列 ⚙）、ADR-0064（主題色，與本案的明暗切換不同）、`theme.tsx`

## 背景與問題

全 app 唯一的明/暗（light/dark）切換 UI 是 `TitleControls` 的 🌙/☀️ 鈕（`useTheme().toggle`）。它只在三處被渲染：**經典佈局**的 `ContactListWindow` 標題列、`SignIn`、`UnlockScreen`。

三欄（modern）佈局左欄是 `DeckSidebar`（非 `ContactListWindow`），因此登入後**三欄佈局完全沒有明暗切換鈕**——在兩種環境都缺：

- **瀏覽器版三欄**：頂部 `idbar` 只有身分切換／＋／`⚙️ 設定`；`SettingsPanel` 只有主題色（accent）沒有明暗；瀏覽器不畫自繪標題列 → **使用者無任何途徑切換明暗**（使用者回報的問題）。
- **Tauri 版三欄**：`idbar` 依 ADR-0206 不畫（身分已上移原生標題列），而原生 `TitleBar` 只有視窗控制＋⚙＋身分，也沒有明暗鈕。

`initialTheme()` 僅在首次載入讀一次 `prefers-color-scheme`，之後不跟隨、也無 UI 可改。

## 考量的選項

- **選項 A：把明暗鈕放進 `DeckSidebar`**——一處覆蓋所有三欄（含瀏覽器與 Tauri）。但 DeckSidebar 是聯絡人清單，明暗鈕放這裡不符「頂部 chrome」的慣例、較不易發現。
- **選項 B：各環境放在其「頂部 chrome」**（本案）——瀏覽器三欄放 `idbar`（已是其頂部 chrome，且已放 ⚙）；Tauri 三欄放原生 `TitleBar`（身分已在此）。
- **元件重用**：把 🌙/☀️ 鈕就地各處複製，或抽成共用元件？→ 抽 `ThemeToggleButton`（SSOT）。

## 決策

採**選項 B**，並抽共用元件：

1. **抽 `ThemeToggleButton`**（`apps/desktop/src/ui/ThemeToggleButton.tsx`）為全 app 唯一的明暗切換 UI；`className`/`testId`/`tabIndex` 讓各處貼合樣式。`TitleControls` 改用它（行為不變、Fix-First 不另造）。
2. **瀏覽器三欄**：`idbar` 加一顆，gate on `layout === "modern"`——因 idbar 在三欄只於瀏覽器渲染（`!(isTauri() && modern)`），此 gate 自然只在瀏覽器三欄顯示，且不與經典 idbar／`ContactListWindow` 重複。
3. **Tauri 三欄**：原生 `TitleBar` 加一顆，gate on `identityControls != null`——該資料僅三欄＋Tauri 才註冊（ADR-0206），故不會在 Tauri 經典重複。
4. **經典佈局不動**：仍由 `ContactListWindow` 標題列提供，避免重複。

## 理由

各環境放在既有的頂部 chrome 最符合使用者尋找主題開關的直覺，也複用既有容器樣式（`idbar__add`／`titlebar__btn`）而非新造版面。抽共用元件消除三份重複的按鈕標記（SSOT），日後改圖示/行為只需一處。以「渲染條件」而非「新旗標」設閘，天然避免與經典佈局重複。

## 後果

- **正面**：瀏覽器三欄（回報的問題）與 Tauri 三欄都有了快速明暗切換；明暗鈕邏輯收斂為單一元件；經典佈局零影響、無重複。
- **負面 / 已知殘餘風險**：Tauri 原生標題列的 `titlebar--style-mac`（交通燈風格）未替 `--theme` 上專屬色，該風格下明暗鈕為中性鈕（仍可用，僅視覺非交通燈）；可後續補樣式。
- **後續行動 / 待辦**：行動端（RN）明暗切換不在本案範圍；官網已有自有切換，亦不在此。
