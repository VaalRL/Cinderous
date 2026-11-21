# 0427. 錨點額度警示：每 3 小時查 Cloudflare 免費額度，到 70% 開 issue

- 狀態：已接受
- 日期：2026-11-21
- 相關文件：ADR-0006（免費層容量估算）、ADR-0189（第二座錨點）、ADR-0350（排程誠實、錯開整點）、ADR-0388–0391（2026-10 的用量量測與修正）、SDK ADR 0126（喚醒讀取列數）

## 背景與問題

兩座錨點都跑在 Cloudflare Workers 免費方案。2026-10-22 錨點 1 的 Durable Objects 讀取列數在 00–05 UTC 就用掉 535 萬列（上限 500 萬），
之後整天停擺，**直到有人發現才知道**。原因（喚醒時掃全表）已由 SDK ADR 0126 修掉，但下一次是什麼讓額度用完沒人知道，而目前沒有任何主動通知。

使用者 2026-11-21 選擇「加每日額度警示」。

## 考量的選項

- A：Cloudflare 的帳單通知——免費方案超額不會計費，沒有帳單事件可以觸發；Workers 也沒有「用量到某個百分比」的通知類型。
- B：在 Worker 裡自己計數——要寫儲存（正是額度本身），而且 Worker 停擺時也發不出通知。
- C：GitHub Actions 排程查 Cloudflare GraphQL Analytics，超過門檻開 issue（採納）——不動錨點、不花錨點額度，GitHub 會把 issue 與失敗通知寄給維運者。

## 決策

1. **查什麼**：帳號層級、當日（UTC）到目前為止的五項，對照免費上限：
   Worker 請求 10 萬、DO 請求 10 萬、DO 讀取列數 500 萬、DO 寫入列數 10 萬、DO 儲存總量 5 GB。
   資料集：`workersInvocationsAdaptive`、`durableObjectsInvocationsAdaptiveGroups`、`durableObjectsPeriodicGroups`、`durableObjectsSqlStorageGroups`（儲存依 namespace 取最大值再相加）。
2. **多久查一次**：每 3 小時（`41 */3 * * *`，錯開整點，同 ADR-0350）。額度每天 00:00 UTC 重算，查「當日累計」才能在用完之前發現；2026-10-22 那次 5 小時就用完，每天查一次來不及。
3. **門檻 70%**：任一項到 70% 就開 issue，標題「中繼額度警示 YYYY-MM-DD」；同一天已經有開著的就補留言，不重複開。報告列出五項用量與比例，超過的標 🔴。
4. **查不到就變紅**：GraphQL 回錯誤、找不到帳號、HTTP 失敗都讓 job 失敗（GitHub 寄信）。token 過期時安靜地當成 0，這個警示就會在最需要時說「一切正常」。
5. **憑證**：兩座錨點在不同 Cloudflare 帳號，各一組 secrets：`CF_QUOTA_<n>_ACCOUNT`、`CF_QUOTA_<n>_TOKEN`（n＝1、2）。token 只給 **Account Analytics: Read**，不能部署、不能讀事件。
6. 純邏輯在 `relay/ops/quota.ts`（查詢字串、解析、判定、報告），執行端在 `relay/ops/quota-watch.ts`，workflow 在 `.github/workflows/quota-watch.yml`。

## 後果

- 正面：
  - 額度用到 70% 時就有通知，維運者有時間在停擺前處理（找出異常來源、暫時改用另一座錨點）。
  - 每次執行的摘要頁都有兩座錨點的當日用量，不用登入兩個 Cloudflare 帳號看儀表板。
- 負面 / 已知殘餘風險：
  - 需要使用者到 Cloudflare 建兩把唯讀 token 並設成 repo secrets；**設好之前這個 workflow 每次都會失敗**（刻意的：沒設＝沒有在監控，應該看得到）。
  - GitHub 對排程工作會延遲甚至略過（ADR-0350 實測），所以「每 3 小時」是上限不是保證；一個異常來源若在 3 小時內從 0 衝到 100%，仍會先停擺。
  - GraphQL Analytics 有幾分鐘的延遲，且是取樣資料，數字是近似值。
  - 只有通知，不會自動採取行動。
- 後續行動 / 待辦：
  1. 使用者建立 token、設定 secrets（OPERATOR-TODO §B）。
  2. 設好後手動觸發一次 workflow，確認摘要頁兩座都有數字。

## 測試

- `relay/ops/quota.test.ts`：查詢包含四個資料集與欄位；UTC 日期；加總與儲存相加；當日沒資料＝0；API 錯誤與找不到帳號要丟出來；
  70% 門檻、多項排序、門檻可調、儲存看 5 GB；報告的百分比與 🔴 標記。
- 2026-11-21 以測試用 Cloudflare 帳號跑過一次真的 GraphQL 查詢：第一版的 `orderBy: [date_DESC]` 被拒（儲存資料集不能依 date 排序），拿掉並改以 `namespaceId` 分組後，五個欄位都被接受、回傳正常。
