# 0212. CF 自動建置排除 relay/bootstrap（build watch paths）

- 狀態：已接受
- 日期：2026-07-20
- 相關文件：ADR-0039（引導 relay 清單健康檢查與簽章發佈）、ADR-0208（瀏覽器版走 Cloudflare 靜態資產）、`.github/workflows/relay-health.yml`、`apps/desktop/wrangler.jsonc`

## 背景與問題

`relay-health.yml`（cron `0 * * * *`）每小時探測引導 relay，並把 `relay/bootstrap/relays.json`、`health-history.json` commit+push 回 repo。因 `health-history.json` 的 uptime 計數（`probes`/`live`）每次探測都在變，**實質上幾乎每小時都會產生一筆 commit**（實測：某段期間連續 9–10 筆 commit 全部只動 `health-history.json`）。

若把瀏覽器版 Worker（`cinderous`，ADR-0208 的 Workers Static Assets）的 Git 連線接回並開啟「push 即自動建置」（Workers Builds / Pages），這些 bot commit 會**白白觸發整站重建**：

- **額度**：≈720 次建置/月，超過免費層上限（Pages 免費層 500 次/月）——真正要佈署客戶端改動時反而可能被卡住或被迫付費。
- **零效益**：清單更新走 Nostr（客戶端訂閱維護者公鑰的 `RELAY_LIST_KIND` 簽章事件、驗簽後採用），**不進任何 worker 產物**；重建出來的 worker 與上一小時位元級相同。
- **雜訊/風險**：無人審核的自動上線把「當下的 main」直接推上 production；700+ 筆 bot 建置紀錄會淹沒「真正失敗的那一次」，久之無人再看佈署通知。

## 考量的選項

- **選項 A（採用）：CF Build watch paths 排除 `relay/bootstrap/*`。** 只改到該目錄的 commit 不建置；改到客戶端（`apps/desktop/**`、`packages/*`）才建。設定於 CF 儀表板（非 wrangler 欄位），路徑以 repo 根為基準。
- 選項 B：在 `relay-health.yml` 的 bot commit 訊息加 CF build-skip 標記。缺點：Git 建置對 skip token 的支援不如 watch paths 可靠；且散落在另一個 workflow、易被忽略。可作 A 的備援。
- 選項 C：維持 Git 斷開、手動 `wrangler deploy`。最保守（現況即如此），但失去自動化。
- 選項 D：不處理，接受每小時重建。額度、雜訊、無審核上線三重成本，否決。

## 決策

採用選項 A。接回 Git 時，於 CF → 此 Worker → Settings → Build → Build watch paths 設：

- **Include paths**：`*`（預設，全部）
- **Exclude paths**：`relay/bootstrap/*`

因此設定屬 CF 儀表板、無法進 repo，於 `apps/desktop/wrangler.jsonc` 以註解承載「該填什麼」，接回時照抄、並以本 ADR 為決策紀錄。Git 目前未連線＝無自動建置，此設定於接回後生效。

## 理由

- **純風險、零收益**：被排除的重建不產生任何有效變更（清單走 Nostr、不進產物），排除它不損失任何正確性。
- **最可靠的過濾點**：watch paths 是 CF 對「哪些變更觸發建置」的一等設定，比 commit 訊息 skip token 穩定；不必改動 relay-health workflow。
- **SSOT / 可追溯**：設定值以 wrangler.jsonc 註解＋本 ADR 雙載，接回 Git 的人不需重新推導。

## 後果

- 正面：接回 Git 後，客戶端佈署只在客戶端程式碼真的變動時發生;免費建置額度不被 bot 吃光;佈署通知恢復訊號價值。
- 負面 / 已知殘餘風險：watch paths 是儀表板設定，**無法由 repo 強制**——若有人重建 CF 專案或改壞 include/exclude，仍可能退回每小時重建;必要時可再疊選項 B 作備援。另需注意路徑基準（repo 根 vs Root directory）依 CF UI 呈現微調。
- 後續行動 / 待辦：接回 Git 時套用上述設定並以變更檔 `relay/bootstrap/health-history.json` 驗證確實被排除;若日後改走其他平台自動建置，比照設定等效的路徑過濾。
