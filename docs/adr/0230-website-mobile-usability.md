# 0230. 官網手機可用性強化

- 狀態：已接受
- 日期：2026-07-22
- 相關文件：ADR-0186（GitHub Pages 部署）、ADR-0187（資訊架構）、ADR-0229（hero icon 按鈕列，協同）

## 背景與問題

官網 RWD 只有幾個斷點字級微調：觸控目標偏小（nav 連結 ~33px 高，Apple/Android 建議 ≥44px）、hero h1 靠斷點硬切字級（介於斷點間可能過大溢出）、長字串（網址／金鑰範例）可能撐出水平捲動。行動流量占比高，需系統性補強。

## 考量的選項

- **A. 漢堡選單重構 nav**：改動大、增加 JS 狀態；nav 項目少（5 項），flex-wrap 兩行已可容納。**否決**。
- **B. 最小修正（採用）**：觸控目標、流式字級、防水平溢出三件事，各以最小 CSS 落地。

## 決策

1. **觸控目標 ≥44px**（≤640px）：`.nav__link`／`.nav__toggle`／`.nav__cta`／`.btn` 補 `min-height: 44px`（nav 三者加 `inline-flex + align-items: center` 保持置中）；hero icon 鈕已由 ADR-0229 處理。
2. **hero h1 流式字級**：`clamp(36px, 9vw, 64px)` 取代固定 64px＋斷點 46px 硬切——任何寬度都平滑縮放、不再溢出。
3. **防水平溢出**：`html, body { overflow-x: clip }`（`clip` 不建立捲動容器，比 `hidden` 乾淨）＋ `body { overflow-wrap: break-word }`（長字串必要時換行，不影響一般排版）。
4. **nav 維持 flex-wrap**（既有 ≤640px 規則）、**不做漢堡**——項目少、兩行可容納，零 JS。

## 理由

- 全部是 CSS 最小修正、零 JS、零版面重構；與 ADR-0229 的手機 icon＋標籤協同成套。
- `clamp` 一條規則取代兩個斷點值，維護點更少。
- `overflow-x: clip` 不像 `hidden` 會把 body 變成捲動容器（避免 sticky nav 等副作用）。

## 後果

- **正面**：手機觸控命中率提升；任意視窗寬度字級平滑；水平捲動根絕。
- **負面／已知殘餘風險**：`overflow-x: clip` 於極舊瀏覽器（<2022）退化為無效——但僅失去保險、不破版；44px 使 nav 兩行時整體略高。
- **後續**：行動版 app 推出後，官網再檢視是否需行動專屬導覽。
