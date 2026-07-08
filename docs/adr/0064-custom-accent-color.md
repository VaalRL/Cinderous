# 0064. 自訂主題色（本地儲存、單一 --accent 覆寫、吉祥物連動）

- 狀態：已接受
- 日期：2026-07-09
- 相關文件：`apps/desktop/src/theme.tsx`（亮/暗主題模式）、ADR-0063（品牌吉祥物）
- 觸發：使用者要能自訂介面主題色，改動存在本地，並連帶改動吉祥物色系。

## 背景與問題

介面已 token 化：`--accent` 被約 40 處 `var(--accent)` 使用，且 `msn.css` 已用 `color-mix()`（代表 WebView2 支援）。要在此之上加「使用者自訂主題色」，且吉祥物身體跟著變。

## 決策

**以單一 `--accent` 覆寫驅動全域色系；自訂色本地儲存；吉祥物身體跟隨、火頭恆常。**

1. **儲存（本地）：** `accent.tsx`（`AccentProvider`，仿 `theme.tsx`）把自訂 hex 存 `localStorage["nb.accent"]`；套用方式＝在 `documentElement` 上 `style.setProperty("--accent", …)`（inline 覆寫樣式表）；清除則 `removeProperty` 回到內建預設。**純本地、不上雲**（符合隱私/本地優先）。
2. **一鍵串連：** 把 `--titlebar`（及少數色）改為從 `--accent` 以 `color-mix` 推導 → 覆寫 accent 即連動標題列、按鈕、chip、上線色等全部。
3. **深色自動提亮：** 深色主題下套用 `lightenHex(accent, 0.22)`（比照內建暗色 accent 較亮的作法），維持對比。
4. **設定 UI：** Settings「主題色」——MSN 懷舊**預設色票** + **自訂 `<input type=color>`** + 重設。
5. **吉祥物連動：** `CinderMascot` 身體漸層/手臂/陰影以 `color-mix(var(--accent), …)` 推導 → 身體跟主題色；**頭的餘燼維持恆常**（火是品牌本義）。`CinderMark`（logo）亦維持餘燼恆常。

## 理由

- **改動最小**：UI 已集中在 `--accent`，覆寫一個變數即全域生效。
- **本地即時**：inline setProperty 立即套用、跨啟動持久（localStorage），無需伺服器。
- **色連動不破品牌**：藍身可換色＝可換的房間；火頭不變＝Cinder 的靈魂。

## 後果

- 正面：可完整自訂主題色，吉祥物同步換色，仍保留品牌識別。
- 負面 / 已知限制：
  - **對比風險**：accent 常當底色配白字；太淺的自訂色會讓白字不清 → 以**精選預設**規避；自訂色為使用者自負（未來可加自動對比文字色）。
  - 依賴 `color-mix()`（WebView2/現代 Chromium 支援；`msn.css` 既有使用）。
  - `--in-name`（訊息寄件者色）與 per-contact avatar 色為獨立系統，不受 accent 影響（刻意）。
- 測試：`lightenHex`/`accentForTheme`/預設色票（純函式）；typecheck + desktop 全綠。
