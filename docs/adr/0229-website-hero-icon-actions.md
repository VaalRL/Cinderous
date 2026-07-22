# 0229. 官網 hero 改品牌 icon 按鈕列（分平台下載）

- 狀態：已接受
- 日期：2026-07-22
- 相關文件：ADR-0187（官網資訊架構：願景優先、下載直連 GitHub Releases）、ADR-0192（字型自架、零第三方請求）、ADR-0090（雙語文案）、ADR-0230（官網手機可用性，協同）

## 背景與問題

hero 的四顆文字按鈕（下載桌面版／在瀏覽器開啟／看技術原理／GitHub）不分平台——macOS 使用者點「下載桌面版」進 releases 只找得到 Windows 檔；行動版尚未推出但無從得知。需要「一眼看出支援哪些平台、哪些即將推出」。

## 考量的選項

- **A. 維持文字按鈕、只加說明文字**：資訊塞不下、hero 變擁擠。
- **B. SVG 品牌 icon 按鈕列（採用）**：平台一目瞭然（Windows／Apple／手機／地球／GitHub）、可標示 disabled（即將推出）、hero 更緊湊。
- **C. 外部 icon 字型／CDN**：違反零第三方請求宣稱（ADR-0192）。**否決**。

## 決策

1. **hero 文字按鈕 → SVG 品牌 icon 按鈕列**（`icons.tsx`：Windows／Apple／手機／地球／GitHub），一律 `currentColor` 隨主題、`aria-hidden`（語意由按鈕 `aria-label` 承擔）、零外部資源。
2. **下載分平台**：Windows **可用**（primary 樣式、連 GitHub releases）；macOS 與行動版 **disabled**——灰階＋`aria-disabled`＋tooltip「即將推出」（不可點、不誤導）。
3. **自訂 CSS tooltip**（hover／鍵盤聚焦顯示；`pointer-events: none` 不擋滑鼠）；網頁版（地球）與 GitHub 沿用既有文案當 tooltip 與 `aria-label`。
4. **「看技術原理」保留文字連結**（獨立一列），不併入 icon 列。
5. **手機 ≤640px**：觸控無 hover → icon＋**可見標籤**並列、tooltip 停用、觸控目標 ≥44px（與 ADR-0230 協同）。
6. **i18n zh/en**（`hero_ic_*`／`hero_tip_windows`／`hero_soon`；移除不再使用的 `hero_download`）、鍵盤可聚焦（`:focus-visible` 同 hover 樣式）；**nav 右上下載鈕不動**。

## 理由

- 平台支援狀態視覺化：可用／即將推出一眼可辨，不再誤導 macOS／手機使用者。
- 全 SVG inline＋currentColor＝雙主題自動適配、零新請求，維持零追蹤宣稱。
- disabled 用 `aria-disabled`（非 `disabled` 屬性）＝仍可聚焦、screen reader 讀得到「即將推出」。

## 後果

- **正面**：hero 更緊湊、平台資訊明確；a11y（aria-label／鍵盤聚焦）與雙語齊備。
- **負面／已知殘餘風險**：icon 認知依賴品牌熟悉度（手機以可見標籤緩解、桌面靠 tooltip）；macOS／行動版推出時需回來把 disabled 轉可用。
- **後續**：macOS 版推出→Apple 鈕接 releases；行動版推出→手機鈕接商店／APK。
