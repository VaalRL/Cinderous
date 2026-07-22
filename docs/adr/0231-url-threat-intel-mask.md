# 0231. URL 威脅情報比對與訊息遮罩

- 狀態：已接受（P1–P4 皆已落地）
- 日期：2026-07-22
- 相關文件：ADR-0038（網址衛生：追蹤參數清除＋啟發式風險評估）、ADR-0228（更新偵測：官網靜態 JSON 查詢＋定期更新管道）、ADR-0210（CSP）、全域隱私原則（本機優先、明文與行為不上雲）

## 背景與問題

ADR-0038 的 `assessUrl` 只有**啟發式**信號（@ 混淆、punycode、IP 直連、短網址…），對「長得正常的已知惡意網域」（釣魚、惡意軟體散布）無能為力。通訊軟體是釣魚連結的主要散布面，需要「已知惡意網站」名單比對。但任何「送 URL 去雲端查」的方案（Google Safe Browsing API 等）都違背本專案隱私底線——瀏覽行為/收到的連結絕不離開裝置。

## 考量的選項

- **A. 雲端查詢 API**（Safe Browsing / VirusTotal）：涵蓋最廣、即時，但**送出 URL/host**（或可被關聯的 hash prefix）→ 違背隱私底線。**否決**。
- **B. 本地清單比對（採用）**：開源威脅情報清單（授權相容：CC0/MIT）打包成本地 snapshot，比對純本地進行、零網路。涵蓋較窄、有時效性，但隱私零妥協；時效以「定期更新 snapshot」緩解（複用 ADR-0228 官網靜態檔管道）。
- **C. 不做**：維持純啟發式。釣魚防護缺口持續存在。

## 決策（採 B，分 P1–P4）

1. **資料來源＝開源、授權相容**：URLhaus（abuse.ch，CC0）＋ StevenBlack hosts（MIT）；build 時抽出 registrable domain 集合成 snapshot（小寫、去 `www.`），**分來源保留**（供 UI 顯示「被哪個來源警示」）。使用者可另加**自訂封鎖清單**（本地、優先於內建）。
2. **比對＝core 純函式、零網路**：`threat-intel.ts` 定義 `ThreatSource`／`ThreatDb`／`urlHost`／`matchThreat`（子網域命中母網域、只比對尾端連續網域）；`assessUrl(href, linkText?, matchThreat?)` 注入 matcher 回呼——命中即 `known-malicious`（danger 級）＋ `sources` 出處。**絕不送 URL/host 給任何伺服器**。
3. **渲染端遮罩**：訊息中命中的連結**預設遮住**（不直接可點），顯示警示與**命中來源**；一般模式可展開（使用者明確確認後顯示原連結，沿用 ADR-0038 確認對話框）；**嚴格／企業模式不可展開**。
4. **送出端警示**：使用者貼上/送出命中連結時警示（可於設定關閉）；**嚴格／企業模式直接阻止送出**。
5. **設定四項**：啟用威脅情報（預設開、可關）／送出端警示（預設開）／嚴格模式（預設關；企業政策可強制）／自訂清單管理。i18n zh/en。
6. **snapshot 更新**：官網（GitHub Pages）部署 snapshot 靜態檔＋定期重建（CI 排程），app 沿用 ADR-0228 的「opt-in、節流、失敗靜默」模式拉取；不拉取時使用內建 snapshot。
7. **官網介紹**：主打「**純本地比對、URL 不離開裝置**」、可自訂、可關閉——與雲端查詢方案的差異化。

## 理由

- 隱私零妥協的前提下補上「已知惡意網域」防護：比對純本地，唯一連外是「拉 snapshot 靜態檔」（與更新檢查同級、opt-in 可關、不含任何使用者資料）。
- 分來源保留出處＝遮罩 UI 可解釋「為何被擋」，使用者可判斷誤報；自訂清單讓進階使用者自救。
- 嚴格模式對企業情境（ADR-0112 系列）提供「不可繞過」的政策層。

## 後果

- **正面**：釣魚/惡意連結在渲染與送出兩端皆有防線；解釋性（來源出處）與可控性（開關/自訂/嚴格）兼顧；隱私底線不破。
- **負面／已知殘餘風險**：
  - 本地清單涵蓋必然窄於雲端 API、且有時效落差（以定期 snapshot 更新緩解）。
  - snapshot 體積需控制（抽 domain、不含 URL path；必要時分級收錄）。
  - 誤報會遮住正常連結——一般模式可展開＋自訂清單（allowlist 性質）緩解；嚴格模式刻意不可繞過屬取捨。
- **實作階段（皆已落地）**：
  - **P1**：core `threat-intel.ts`＋ desktop `assessUrl` 延伸（`known-malicious`＋`sources`）＋ i18n `urlrisk_knownMalicious`。
  - **P2**：`scripts/threat-snapshot.mjs`（hosts 抽取、每來源 20k 上限、來源失敗保留上一版）→ `docs/threat-intel.json` → 官網 build 複製進 dist＋`threat-intel.yml` 每日排程重建（提交觸發 pages 重佈）；desktop `threat-db.ts` 拉取（opt-in、每日節流、失敗靜默、getKv 快取）。
  - **P3**：`ThreatProvider` context＋markdown 遮罩（`MaskedLink`：遮住網址與文字＋標示來源＋一般可展開/嚴格不可展開）＋送出端 `threatHits` 警示（可關）/嚴格阻止＋設定四項＋i18n zh/en。
  - **P4**：官網技術原理頁介紹卡（純本地、不送 URL、可自訂可關）。
  - `ARCHITECTURE.md` 已同步（core／website 職責）。
