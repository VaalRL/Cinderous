# 0187. 官網資訊架構改版——首頁＝價值觀/願景、技術原理獨立成頁、下載直連 Releases

- 狀態：已接受
- 日期：2026-07-17
- 相關文件：ADR-0090（官網雙語文案）；`apps/website`

## 背景與問題

原官網首頁把「品牌 hero＋技術特色卡＋訊息傳遞圖＋節點＋捐款」全塞在一頁，價值主張（為何存在、為誰而做）被技術細節稀釋；下載是站內獨立頁（`Download.tsx`）再導去 Releases，多一跳。使用者希望：

1. 首頁改為闡述**產品核心價值觀**與**「取回通訊自主權」的願景**。
2. navbar 新增一頁專講**技術原理**。
3. **下載**直接連去 GitHub Releases 頁，不走站內頁。

## 考量的選項

- **選項 A（維持單頁堆疊）**：改動小，但價值主張與技術細節混雜、下載多一跳，不符需求。
- **選項 B（願景優先 IA）**：首頁聚焦價值觀/願景；技術細節搬到獨立「技術原理」頁；下載改外連 Releases。**採用**。

## 決策

採選項 B，資訊架構重整為：

- **首頁（Home）**：hero 以 `eyebrow`＝「取回通訊自主權」領銜；新增**願景**段（`vision_*`，闡述平台掌控 vs. 自主權的對比）與**核心價值觀**四卡（`val_autonomy/privacy/decentral/free`，以「對你的意義」而非機制描述）；保留節點/捐款次要區塊。hero 主按鈕與 navbar「下載」皆**外連** `GITHUB_URL/releases`。
- **技術原理頁（新 `pages/Tech.tsx`，nav `nav_tech`）**：吸收原首頁的「訊息怎麼傳＋FlowDiagram」、四大技術支柱（沿用 `feat_*`）、新增**協定基線**卡（`tech_proto_*`：NIP-17/44/59/42/13＋WebRTC P2P）。
- **下載**：移除站內 `Download.tsx` 與 `download_*` 文案；navbar CTA 與 hero 主鈕直連 Releases（`View` 由 `home|download|node` 改為 `home|tech|node`）。

文案：`copy.ts` 新增 `nav_tech`/`hero_eyebrow`/`hero_tech`/`vision_*`/`values_title`/`val_*`/`tech_*`，`features_title` 改為「四大技術支柱」；移除 `download_*`；保留 `tr_*`（透明度頁暫下架但檔案仍在，ADR 未變）。

## 理由

- 價值觀優先讓首頁在 3 秒內說清「為何是 Cinder、為誰而做」，技術讀者可一鍵進技術原理頁看機制——兩種受眾各得其所，不互相稀釋。
- 下載直連 Releases 少一跳、少維護一個站內頁；桌面安裝檔本就發佈在 Releases。
- 沿用既有設計系統（`.hero/.eyebrow/.sec/.card/.grid--4/.chips/.btn`）與「夜森林營火」主題，零新增 CSS。

## 後果

- 正面：首頁敘事聚焦、技術細節有專頁、下載路徑更短；bundle 略減（少打包 Download 頁）。
- 負面 / 已知殘餘風險：
  - `download_mobile`（行動版為網頁 app）的說明隨 Download 頁移除而不再顯示；未來若需可於技術原理頁或 Releases 說明補回。
  - `nav_transparency` 仍保留但未使用（透明度頁暫下架，便於還原）。
- 後續行動 / 待辦：無阻塞項；日後透明度頁恢復時一併檢視是否納回導覽。
