# 0033. 貼圖編輯器：筆劃模型序列化為 SVG path（桌面優先）

- 狀態：已接受
- 日期：2026-07-02
- 相關文件：docs/adr/0032（自製貼圖）、apps/desktop/src/ui/sticker-editor-model.ts

## 背景與問題

ADR-0032 交付自製貼圖的匯入/fork/收藏後，缺最後一塊：在應用內「畫」出貼圖。
需要決定編輯器的資料模型、輸出形式、與既有貼圖的關係，以及平台範疇。

## 考量的選項

- **資料模型**：(a) 點陣畫布（canvas 像素，輸出 PNG 再包 SVG）；(b) **筆劃向量模型**
  （pointer 軌跡 → SVG `<path>`）；(c) 完整向量編輯器（節點編修、圖形工具）。
- **以現有貼圖為底**：(i) 不支援；(ii) **底圖為嵌套 `<svg>`，筆劃疊加其上**；
  (iii) 解析底圖回筆劃（不可行——任意 SVG 無法還原成筆劃）。
- **平台**：依 ADR-0032 平台政策，桌面優先、不做建置層閹割。

## 決策

- **採 (b) 筆劃向量模型**，純函式模組 `sticker-editor-model.ts`：
  - `Stroke = { color, width, points }`；pointer 軌跡以最小距離取樣，座標取一位小數。
  - `strokeToPath`：首點 `M`，其後以**二次貝茲中點平滑**（`Q 控制點 中點`）連接，
    單點退化為圓點（零長度線段 + `stroke-linecap:round`）。
  - 狀態機 `addStroke / undo / redo / clearStrokes`：純資料、可完整單元測試；
    新筆劃清空 redo 疊。
  - `serializeEditor` 輸出 `<svg viewBox="0 0 256 256">`，**產物必過
    `validateStickerSvg`**（以測試釘住），再走 0032 既有的 `addSticker` 入庫。
- **底圖採 (ii)**：自訂貼圖的「編輯」＝以該貼圖為底開啟編輯器，底圖以嵌套
  `<svg width/height=256>` 原樣嵌入輸出（該底圖既已通過 0032 驗證），筆劃畫在其上。
  內建貼圖的 ⑂ fork 仍為複製；自製貼圖格上的 🖉 進編輯器。
- **預覽零 innerHTML**：畫布 = `<img src=dataURI>`（底圖）疊 React 建構的 inline
  `<svg>`（筆劃），維持 0032 的「永不 `dangerouslySetInnerHTML`」不變式。
- **向量而非像素的理由**：輸出天然是小而縮放不失真的 SVG（符合 0032 統一表示與
  32KB 上限）、undo/redo 是陣列操作、模型可在 node 測試（canvas 不行）。
  (c) 完整向量編輯超出貼圖需求，不做。

## 後果

- 正面：模型 100% 純函式測試；輸出與 0032 管線（驗證、雜湊、入庫、v2 送出）零縫接軌；
  undo/redo/清空免費。
- 負面：只有手繪筆劃（無文字/形狀工具）；長筆劃多時 path 資料成長，靠取樣距離與
  一位小數壓制，極端情況由 32KB 上限拒收兜底。
- 後續：文字與基本形狀工具、行動版（依 0032 平台政策不移植）。
