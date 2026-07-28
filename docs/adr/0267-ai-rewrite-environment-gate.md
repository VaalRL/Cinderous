# 0267. AI 改寫依環境設閘：公網瀏覽器版整面隱藏（僅 Tauri 與 localhost origin 提供）

- 狀態：已接受
- 日期：2026-07-28
- 相關文件：ADR-0060（本機 Ollama、localhost 硬守則）、ADR-0062（線上 provider）、`native/ollama.ts`
- 編號註：0257–0266 已被平行分支（relay-profitability session）預訂，本側自 0267 起跳。

## 背景與問題

使用者於**部署版 webapp**（`https://cinderous.…workers.dev`）測試時，設定中偵測不到 Ollama。診斷：瀏覽器路徑是直接 `fetch("http://localhost:11434")`——(1) **CORS**：Ollama 預設 `OLLAMA_ORIGINS` 只放行 localhost 系 origin，公網 origin 的請求被瀏覽器攔下；(2) **Chrome 本地網路管制**（Private/Local Network Access）：公網 https 站對 localhost 的請求需伺服器配合特殊 preflight 或使用者授權，Ollama 不支援。一般使用者實質不可用，要改第三方 daemon 環境變數才勉強通——UI 卻只顯示成「偵測不到」的死路。

## 考量的選項

- **A：加提示文案**（教使用者設 `OLLAMA_ORIGINS`）——可行但體驗差：要求使用者改第三方 daemon 設定，且 Chrome LNA 之下仍可能失敗。
- **B：瀏覽器版全禁**——簡單，但誤傷**本機開發/自架 localhost** 情境：Ollama 預設 origins 本就放行 localhost，那裡是開箱即用的。
- **C：依 origin 精準設閘（採納，使用者提案 B 的修正版）**——`isTauri() || origin 為 localhost` 才提供 AI 面。

## 決策

新增 `aiRewriteSupported(origin = location.origin)`（`native/ollama.ts`，純函式可注入 origin 測試）：Tauri 恆 true；瀏覽器僅 localhost/127.0.0.1/::1 origin 為 true。App 以此設閘四處：設定的 AI 區塊（不出現，advanced 分頁隨「只顯有內容」自動收斂）、🧠 未讀摘要入口（兩佈局）、composer 改寫回呼。**`enabled` 偏好仍照存**——同一使用者換回桌面版即恢復，不因環境不支援而丟設定。

## 理由

死路功能比沒有功能更糟（使用者親身踩到）；但一刀切全禁會拿走 localhost 情境「開箱即用」的正當能力。以 origin 判斷把閘設在「實質可用性」的真實邊界上，並與 ADR-0060 的架構敘事一致——Tauri 走 Rust IPC 正是為了避開瀏覽器的 CORS 面。

## 後果

- **正面**：部署版 webapp 不再展示不可能成功的功能；開發/自架 localhost 與桌面版不受影響；判斷純函式有測試。
- **負面 / 已知殘餘風險**：進階使用者若自行設好 `OLLAMA_ORIGINS`＋允許瀏覽器 LNA，在公網版也會看不到入口（刻意取捨：為極少數專家保留死路 UI 對多數人是負資產；專家可用桌面版或自架 localhost 版）。
- **後續行動 / 待辦**：無。
