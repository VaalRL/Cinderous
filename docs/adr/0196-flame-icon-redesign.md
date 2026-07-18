# 0196. 圖示改為火焰造型並同步桌面圖示與官網 favicon

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：ADR-0195（app 圖示＝餘燼）；`apps/desktop/src-tauri/icons/`、`apps/website/index.html`

## 背景與問題

ADR-0195 的圖示是三層同心圓「餘燼點」，較平、偏「發光點」而非「火」。品牌意象是「營火（campfire）」，宜用更明確的**火焰造型**。且官網 favicon 與桌面 app 圖示應**一致**。

## 決策

- **改為火焰造型**：尖端向上的水滴狀火焰（外焰暖色垂直漸層 `#e8531a→#ffab3d`＋較亮內焰 `#ffd66b`），置於深藍圓角底 `#0f1f3a`。
- **桌面圖示**：以火焰 1024 來源（GDI+ 繪製；來源 `icons/cinderous-ember.svg` 同步為火焰 path）經 `tauri icon` 生成整套。
- **官網 favicon**：`apps/website/index.html` 的 data-URI SVG 由三層圓改為同一火焰 path（favicon 用純色版，tab 尺寸下穩健）。
- 行動端 `index.html` 無 favicon，暫不涉及；官網 hero 的 `CinderMark`（餘燼插圖）**不在本次範圍**（另議）。

## 理由

- 火焰造型更直覺表達「營火/cinder」；焰尖向上是通用的「火」符號。
- 桌面圖示與 favicon 用同一 path＝跨面一致；favicon 純色避免 data-URI 內漸層/參照的相容風險。

## 後果

- 正面：桌面版/portable 與官網分頁圖示皆為 Cinderous 火焰、彼此一致。
- 負面 / 已知殘餘風險：需**重建＋重發 v0.0.1**（圖示烘進 exe/安裝檔）；hero `CinderMark` 仍為餘燼圓（與 favicon 略異，屬可接受的「詳圖 vs 分頁圖」差異，日後可一併改）。圖示為程式繪製，可再美化。
- 官網 Pages 於 push 後自動重新部署（favicon 生效）。
