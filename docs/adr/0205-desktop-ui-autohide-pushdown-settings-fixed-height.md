# 0205. 桌面 UI 修正：自動隱藏標題列改「推開內容」＋設定彈窗固定高度

- 狀態：已接受
- 日期：2026-07-19
- 相關文件：`apps/desktop/src/ui/msn.css`、ADR-0153（自動隱藏標題列）、ADR-0142（設定分頁）

## 背景與問題

回報兩個桌面 UI 問題：

1. **自動隱藏標題列疊蓋內容**：`autoHide` 開啟時，標題列平時滑出畫面、滑鼠碰頂端才滑入。但滑入的標題列是 `position:fixed` 覆蓋層（z-index:100）→ **蓋住**下方介面頂端（idbar/對話標頭）。期望：標題列出現時內容**往下讓位**，而非被蓋。
2. **設定彈窗切分頁高度會跳**：`.modal__box.settings-modal` 只設 `max-height`、無固定 `height` → 每個分頁內容多寡不同，彈窗高度隨之縮放，切頁時整窗跳動。期望：**固定高度**，由內文區卷軸調節。

## 決策（皆 CSS，`msn.css`）

1. **推開內容**：`autoHide` 且標題列被揭示（hotzone/titlebar hover 或 focus-within）時——
   - `--viewport-h` 由 `100vh` 縮回 `calc(100vh - var(--titlebar-h))`；
   - `.window-chrome__body` 加 `margin-top: var(--titlebar-h)`。
   `.window-chrome` 為 flex column，body `flex:1`＝**flexbox 自動吸收該條高度**：內容整體下移一條標題列且不溢出；標題列滑入其讓出的頂端空間。以 `:has()`（WebView2 Chromium 支援）偵測揭示狀態，`margin-top` 過渡與標題列滑入同步（0.15s），`prefers-reduced-motion` 關過渡。
2. **固定高度**：`.modal__box.settings-modal` 加 `height: 560px`；小視窗由既有 `max-height: calc(var(--viewport-h) - 24px)` 自動封頂。內文區 `.settings__body`（`flex:1 1 auto`）＋既有 `.win__title ~ * { overflow-y:auto }` 提供卷軸。切分頁時整窗高度不變。

## 理由

- 推開而非覆蓋＝符合直覺（自動隱藏是為省空間，但揭示時不該遮住正在操作的內容）；用 flex 吸收＝零 JS、無溢出。
- 固定高度＝消除切頁跳動；卷軸處理長分頁；`max-height` 保證不頂出小視窗。

## 後果

- 正面：autoHide 揭示時內容清楚可見（下移）；設定彈窗切頁穩定。
- 中性：autoHide 揭示時內容有一次下移動畫（使用者要的行為）；設定短分頁下方會留白（固定高度的預期）。
- 負面 / 已知殘餘：`:has()` 依賴 Chromium（僅 Tauri WebView2 需支援，已滿足；瀏覽器版無 autoHide 外框，不受影響）。純 CSS，無測試涵蓋——vite build 綠即語法有效，實際觀感需目視。
- 後續：三欄模式把身分元件整合進標題列（可拖曳）另立 ADR。需重建桌面方於安裝版生效。
