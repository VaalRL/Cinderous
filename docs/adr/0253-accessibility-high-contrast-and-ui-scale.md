# 0253. 無障礙設定：高對比模式（視障友善配色）＋ UI 尺寸五檔

- 狀態：已接受
- 日期：2026-07-28
- 相關文件：ADR-0064（主題色）、ADR-0078（副色）、ADR-0080（@cinderous/theme SSOT）、ADR-0142（設定分頁）、ADR-0167（外觀依身分、主題/語言屬裝置）、ADR-0216（浮動視窗）、ADR-0250（首開淺色）

## 背景與問題

使用者要求設定中可調整「視障友善配色」與「UI 尺寸」。現況盤點：

1. **配色**：UI 已完全 token 化（`--ink/--muted/--border/…`，亮/暗兩組），但零高對比/色盲支援；亮色 `--muted` 對白底僅 **4.18:1，低於 WCAG AA（4.5）**。
2. **尺寸**：CSS 全 px、無 rem；ADR-0077 的「縮放」只是對話視窗寬高。rem 重構（~65KB CSS）不划算。

## 考量的選項

- **高對比形態**：(a) 獨立 `data-contrast` 軸與亮/暗正交（採納）；(b) 新增獨立主題（🌙 切換變四態、與主色互動複雜，否決）；(c) 直接拉高現有主題對比（改變所有人視覺，否決）。
- **尺寸機制**：(a) **Tauri 原生 `webview.setZoom()` 優先、瀏覽器退 CSS `zoom`**（採納——原生縮放座標系不變、拖曳零校正）；(b) 全 CSS zoom（單一路徑但 Tauri 也要校正拖曳）；(c) 只做 Tauri（webapp 沒入口）。
- **儲存層級**：裝置層（採納，比照 ADR-0167 對主題/語言的定位——無障礙是「用這台裝置的人」的需求）vs 依身分。

## 決策

1. **高對比**（`data-contrast="high"`，與 `data-theme` 正交）：
   - Token 覆寫進 `@cinderous/theme`（`HIGH_CONTRAST`，SSOT）＋ `resolveTheme({ contrast })`；`msn.css` 的 `[data-contrast="high"]` 區塊與之對齊（桌面測試讀 CSS 比對，比照 tokens 對齊模式）。
   - 驗收＝**WCAG AA 以測試鎖住**：文字 ≥4.5、邊框 ≥3（實際值 5.6–19.2）。
   - 高對比下焦點環加粗（2→3px）、內文連結一律底線（不只靠顏色）。
   - `ContrastProvider`（比照 theme.tsx）：裝置層 `nb.contrast`；**未手動設定時跟隨系統 `prefers-contrast: more`**——與 ADR-0250 移除 prefers-color-scheme 不矛盾：對比是 OS 層宣告的**無障礙需求**，非審美偏好。
2. **色覺友善色票**：`ACCENT_PRESETS_CB`（Okabe-Ito 取向 5 色：藍/朱紅/藍綠/紫/洋紅）——常見色覺類型下彼此可辨、**白字全 ≥4.5**（主色會當按鈕底色，測試鎖住）；設定頁主色區加「色覺友善」一列。
3. **UI 尺寸**（`nb.uiScale`，五檔 90/100/115/130/150%）：
   - Tauri：`getCurrentWebview().setZoom()`（capability 加 `core:webview:allow-set-webview-zoom`）；瀏覽器：根元素 CSS `zoom`（1＝清屬性無痕）。開機於 `main.tsx` 套用。
   - 瀏覽器 CSS zoom 下滑鼠座標（viewport px）與版面 px 差一個係數：`useFloatingWindow` 拖曳/縮放與對話視窗縮放把手的位移**除以 `cssZoomFactor()`**（Tauri 恆 1）。
4. **設定 UI**：外觀分頁新增「無障礙」區（`AccessibilitySettings`）＝高對比切換（`aria-pressed`）＋尺寸五檔；選中以主色描邊＋粗體標示（非只靠顏色）。
5. **範圍**：桌面（Tauri＋瀏覽器版）先行；行動端（`resolveTheme` 已支援 `contrast`，UI 待接）與官網列後續。

## 理由

獨立對比軸完全順著既有 token 架構（Fix-First：一個屬性選擇器、零平行主題系統），且亮/暗×對比四種組合自然成立。原生 setZoom 讓 Tauri 端（主要出貨形態）零拖曳風險；瀏覽器退路僅需三處位移除法。對比值全部以 WCAG 公式實算並由測試鎖住（`contrastRatio` 進 theme SSOT），不是憑感覺調色。裝置層儲存與「跟隨系統對比偏好」都是把無障礙當需求而非裝飾的取捨。

## 後果

- **正面**：亮/暗皆有 AA+ 高對比組合；色盲使用者有可辨色票；全介面 5 檔縮放即點即套；`resolveTheme(contrast)` 讓行動端後續接入零重工。
- **負面 / 已知殘餘風險**：高對比只覆寫核心 token（背景漸層維持 color-mix 推導，未逐一驗證所有次要表面）；瀏覽器 CSS zoom 的拖曳校正只覆蓋已知三處（其餘座標敏感元件如貼圖編輯器為比例映射、天然免疫）；非高對比的亮色 `--muted` 維持 4.18（刻意不動所有人的預設視覺——高對比模式即是解法）。
- **後續行動 / 待辦**：行動端無障礙 UI；官網高對比；實機驗收（Tauri setZoom、四種主題組合、150% 下拖曳浮動視窗）。
