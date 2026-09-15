# 0350. Relay 健檢：把 uptime 狀態移出 main，並讓排程誠實

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0039（引導 relay 清單）、ADR-0092（分級收錄）、ADR-0239（信任根移出 CI）、ADR-0275（客戶端健檢）

## 背景與問題

**一、87% 的 main 歷史是一個 bot。**

實測 main 最近 52 筆提交：`chore(relay)` **45 筆**、`chore(threat-intel)` 7 筆、**人寫的 0 筆**。

`relay-health.yml` 有一道「有變更才提交」的守衛，但它對 `health-history.json` **結構性無效**：`health-check.ts` 每跑一次就 `probes + 1` 並無條件 `writeHistory()` ⇒ 檔案**必然**改變 ⇒ `git status --porcelain` **必然**看到變更 ⇒ **必然**提交。守衛只對 `relays.json` 有意義（relay 集合本就罕變）。

**二、那個「每小時」從來不是真的。**

cron 是 `0 * * * *`，但實測連續兩次自動提交的間隔：

```
09-12 01:42 → 06:34 → 11:18 → 14:26 → 17:28 → 19:42 → 21:43
09-14 01:50 → 07:14 → 14:27 → 19:38 → 22:47
```

間隔 2～5 小時、分鐘數完全隨機（從不是 :00）。實際約 **7 次/天，不是 24 次**——GitHub 對公開 repo 的排程工作會延遲甚至丟棄，而整點是最壅塞的時段。

這比推版本身更嚴重：`UPTIME_CAP = 720` 的註解寫「≈30 天/時」，但按實際頻率算是 **≈100 天**。分級收錄（ADR-0092）看的滾動窗比設計的長了三倍，**而沒有任何地方會發現**。

## 決策

**一、uptime 狀態移出 main，改存 `relay-health-state` 分支**

它是**執行期狀態，不是原始碼**。workflow 以 git plumbing 建一個**只含該檔案、沒有父提交**的提交再強制推送 ⇒ 分支永遠是單一提交、不會長大，也不需要另建 repo 或處理額外認證（沿用 `actions/checkout` 設好的 remote）。

main 只在 `relays.json` 真的變動時才收到提交——**那才是值得看的歷史**。

⚠ **為什麼不用 `actions/cache`**：本 repo 規定 action 必須釘 commit SHA（ADR-0235 C5），而本次作業無法查證 SHA。但這不只是權宜——**cache 本來就更差**：GitHub 的 cache 有 7 天未使用即淘汰的規則，而狀態遺失的後果見下。分支是持久的。

🔴 **狀態遺失＝relay 被誤降級。** `evaluateAdmission` 在 `uptimePct === undefined` 時回「試用（`accepting: false`）」——所以若取回狀態那一步靜默拿到空歷史，探測就會把**正式收錄的 relay 寫成試用**並提交出去。故 workflow 的規則是：**狀態分支存在就必須讀成功，否則整個 job 失敗**。只有首次遷移（分支尚不存在）才允許改用 main 內的種子。

**二、排程改為 `17 */6 * * *`**

頻率誠實（宣稱 4 次/天、實際也接近 4 次），且錯開最擁擠的整點。

代價：偵測到一座 relay 死掉最久要 6 小時。可接受——客戶端本來就有自己的健檢（ADR-0275），這份清單是**引導**用的，不是即時可用性的唯一來源。

**三、滾動窗長度由頻率推導（`relay/bootstrap/uptime.ts`）**

```ts
export const PROBES_PER_DAY = 4;                                  // cron: "17 */6 * * *"
export const UPTIME_CAP = PROBES_PER_DAY * UPTIME_WINDOW_DAYS;    // 120
export const UPTIME_MIN_SAMPLES = PROBES_PER_DAY * 2;             // 兩天
```

🔴 並加一條測試：**讀 workflow 檔案、把 cron 換算成次/天、與 `PROBES_PER_DAY` 比對**。改一邊沒改另一邊即紅。原本那個 `720 // ≈30 天/時` 之所以會過期，正是因為頻率只寫在註解裡。

折半改為**迴圈**：頻率調降後既有計數遠高於新上限（448 對 120），單次折半要好幾輪才收斂，期間的窗口長度是錯的。

## 理由

- **狀態不該進原始碼歷史。** 這條原則本來就在——`health-history.json` 是唯一的例外，而它造成了 87% 的雜訊。
- **讓假設可檢查。** 「每小時」與「30 天窗」都是**寫在註解裡**的假設，所以兩個都悄悄變成假的。現在一個由測試綁住、一個由算式推導。

## 後果

- 正面：main 的自動提交從約 7 次/天降到**只在清單真的變動時**（實務上數週一次）。窗口長度不再會因為改頻率而悄悄失真。
- 負面／已知殘餘風險：
  - 🔴 **workflow 本身沒有在 GitHub 上跑過。** git plumbing 那一串（`hash-object` → `mktree` → `commit-tree` → `push --force`）我在本機 dry-run 過、確認產出單一檔案且無父提交；但**整個 job 在真實 runner 上的行為（權限、`fetch --depth=1` 對不存在分支的退出碼、first-run 遷移路徑）只能靠實際執行驗證**。這是本次最薄的一塊。
  - **首次執行會落到 `::warning::` 那條路**（狀態分支還不存在）並使用 main 內的種子——這是預期的遷移行為，但也意味著**那一次的失敗會很安靜**。第一次排程觸發後應該人工確認 `relay-health-state` 分支確實被建立。
  - **main 裡的 `health-history.json` 變成一份不再更新的種子**。留著它是為了遷移，但它會逐漸與真實狀態脫節而令人困惑；本機執行 `bootstrap:run` 也會弄髒它（`git checkout` 可還原）。遷移確認無誤後應刪除。
  - **偵測 relay 死亡的延遲從「宣稱 1 小時／實際 3.4 小時」變成「最多 6 小時」**。名目上變慢，實際上差別不大，但仍是一個退步。
  - 頻率改變不會回溯修正既有計數的**語意**：現存的 448 筆樣本是按舊節奏取的，折半進窗後它們仍被當成新節奏的樣本。影響是暫時的（幾十次探測後就被新樣本稀釋）。
- 後續行動／待辦：
  1. 首次排程執行後確認 `relay-health-state` 分支建立、main 沒有收到 `health-history.json` 的提交。
  2. 確認無誤後從 main 刪除 `health-history.json` 種子。
  3. `threat-intel.yml` 每日一筆提交是合理的（內容真的變），不在本 ADR 範圍。
  4. （獨立）CI 的 `audit` job 每次都 `cargo install cargo-audit --locked`（從原始碼重編，數分鐘）——目前 CI 最貴的單一步驟，值得換成釘版預編 binary 或加快取。
