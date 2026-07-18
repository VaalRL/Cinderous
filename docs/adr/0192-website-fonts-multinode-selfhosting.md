# 0192. 官網字型統一＋多節點協作圖＋自架文件單一入口

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：ADR-0090（官網文案）、ADR-0187（官網 IA）、`apps/website`、`docs/SELF-HOSTING.md`

## 背景與問題

官網三項改善：
1. **字型不統一**：`body` 用 `"Segoe UI", "Microsoft JhengHei", system-ui…` 混合堆疊，跨平台（Win/Mac/Linux）英文與中文渲染不一致。
2. 技術原理頁只有**單一中繼**的訊息傳遞圖，缺「**多節點時如何協作**」的去中心化拓樸說明。
3. 自架文件**分散**（README 的 Cloudflare Worker＋`self-hosting-{zeabur,raspberry-pi,web-app}.md`），官網「看自架文件」連到整個 `docs/` 目錄，使用者難找到入口。

## 決策

1. **字型統一**：英文一律 **Manrope**（自架 woff2 於 `apps/website/src/fonts/`，Vite 指紋化＋base-aware，**不走 CDN**）；中文一律走 `Noto Sans TC → PingFang TC → Microsoft JhengHei` 堆疊。以單一 CSS 變數 `--font` 套用全站，並強制 `button/input/textarea/select` 繼承字型家族。
2. **多節點協作圖**：新增 `MultiNodeDiagram.tsx`（原創 SVG、隨主題色，與 `FlowDiagram` 同風格），置於技術原理頁——呈現「你/好友各連任一可用中繼、密文可經任一節點轉發、一座離線自動改走其他座、可用節點由簽章清單決定、即時互動走 P2P 直連」。文案鍵 `tech_multi_*`／`md_*`（中英）。
3. **自架文件單一入口**：新增 `docs/SELF-HOSTING.md`——一頁比較四種 relay 部署方式（Cloudflare Worker／Zeabur／Docker-VPS／樹莓派）＋自架網頁客戶端，**連向**既有詳細文件（不重複內容）；官網 `node_docs` 連結改指 `docs/SELF-HOSTING.md`。

## 理由

- **自架字型而非 CDN**：CDN 字型是第三方 runtime 請求，會牴觸官網 footer「零追蹤、無第三方」宣稱。自架 Manrope（latin subset，4 字重共 ~56KB）保證各平台英文一致又不引入第三方；中文自架完整 CJK 過大（本環境無 fonttools 可 subset），故採高品質繁中系統堆疊——英文完全統一、中文採一致優先序。
- 多節點圖補齊「去中心化如何運作」的視覺說明，與價值主張呼應。
- 單一自架入口用「總覽＋連結」而非複製內容，降低維護重複。

## 後果

- 正面：全站字型一致（英文各平台相同）；技術頁多一張去中心化拓樸圖；自架有清楚單一入口。零第三方 runtime 請求維持隱私宣稱。
- 負面 / 已知殘餘風險：
  - 中文未自架＝不同 OS 可能落在不同繁中字型（Noto/PingFang/JhengHei）；若日後要完全一致，需以 subset 工具自架 Noto Sans TC。
  - 多加 4 個 woff2（~56KB）＋一張 SVG，體積微增。
- 後續：日後有 subset 工具可補自架繁中；`SELF-HOSTING.md` 隨部署方式增修。
