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
  - ~~🔴 **workflow 本身沒有在 GitHub 上跑過。**~~ **已解除（2026-09-15，run 34969809280）。** 實跑結果：`fetch --depth=1` 對不存在分支的非零退出碼被 `if` 正確接住（沒有被 `set -e` 打死）、`::warning::` 如實印出、狀態分支以**無父提交**建立（`77bcc3a`，tree 只有 `health-history.json` 一個 blob）、main 沒有收到 `health-history.json` 的提交。迴圈折半也在實跑中驗證：`cinderous1` 從種子的 **448 → 113**（448→224→112，+1），一次收斂——單次折半會停在 225（仍高於 120 的上限），那正是改成迴圈的理由。
  - ~~**首次執行會落到 `::warning::` 那條路**~~ **遷移已完成**，該退路已從 workflow 移除：取回狀態那一步改成無條件 `git fetch`，讀不到就整個 job 紅。留著一條「讀不到就用種子」的退路，等於在種子刪除後允許安靜降級。
  - ~~**main 裡的 `health-history.json` 變成一份不再更新的種子**~~ **種子已刪除**，並加進 `.gitignore`（本機 `bootstrap:run` 會產生它，不擋著就會被請回 main）。
  - 🔴 **狀態分支的每一次推送都燒掉一次 Cloudflare 建置——而且必定失敗。**（2026-09-16 發現）
    ADR-0212 為了省 CF 免費層的建置額度（它自己算的是「≈720/月 > 免費層 500」），在 CF 儀表板設了 Build watch paths「Exclude: `relay/bootstrap/*`」。本 ADR 把 `health-history.json` 搬到狀態分支時放在**分支根目錄** ⇒ **那道排除規則就對不上了** ⇒ 每次 force-push 都觸發一個 Workers Build，而該分支只有一個檔案、沒有 `apps/desktop`（CF 設定的 Root directory）⇒ CF 回 `root directory not found`。實測 4 次推送 4 次失敗（`77bcc3a` / `00a6e61` / `b9d3cc0` / `04650d3`，例如 build `e661d2e4-c3e8-4a5f-96b9-2490adde1491`）。以每天 4 次算約 120 次/月，按 ADR-0212 引的 500/月 計約佔 24% 的額度，全部花在不可能成功的建置上。
    **兩個 ADR 互踩而雙方都沒察覺**：ADR-0212 的保護還在，只是保護的位置上已經沒有東西了。
    ⇒ 修法：把狀態分支上的檔案放回 **`relay/bootstrap/health-history.json`**（與 main 同一路徑），讓既有的排除規則重新生效。plumbing 改建巢狀 tree（`relay/` → `bootstrap/` → 檔案），讀取端改用 `git show "FETCH_HEAD:$HISTORY"`，兩端都由 `uptime.test.ts` 的測試綁住（實測舊寫法下兩條皆紅）。
    ⚠ **這層保護在儀表板上，repo 裡看不到也測不到**；而且 CF 對「無父提交的 force-push」如何計算變更檔案清單，我無法從 repo 這側驗證。真正確定的修法是讓 CF 只建 production 分支（見後續行動 ⑥）——本次的路徑修正是不依賴儀表板的第二層。
  - 🔴 **刪掉種子會把「空歷史」這個陷阱從 CI 搬到維護者的筆電上。** `readHistory()` 原本 `catch { return {} }` ——檔案不在就當成沒有紀錄。這在種子還在時無害；種子刪掉之後，本機 `bootstrap:run` 會拿到 `{}` ⇒ `uptimePct` 回 `undefined` ⇒ `evaluateAdmission` 把**正式收錄**的 relay 判成試用（`accepting: false`，見 `node-attestation.test.ts`「一致性過但 uptime 未知/不足 → 試用」）⇒ 降級後的清單被寫回 `relays.json`，而維護者本機**帶著 `MAINTAINER_NSEC`**，所以還會多一步 CI 沒有的**簽章並發佈**。本 ADR 對 CI 立的規則（「必須讀成功，否則失敗」）因此一併套到本機：`uptime.ts` 的 `historyOrThrow` 在檔案不存在或內容壞掉時直接拋，訊息裡寫明怎麼取回狀態；真正的冷啟動用 `RELAY_HEALTH_COLD_START=1` 明示放行。
  - **偵測 relay 死亡的延遲從「宣稱 1 小時／實際 3.4 小時」變成「最多 6 小時」**。名目上變慢，實際上差別不大，但仍是一個退步。
  - 頻率改變不會回溯修正既有計數的**語意**：現存的 448 筆樣本是按舊節奏取的，折半進窗後它們仍被當成新節奏的樣本。影響是暫時的（幾十次探測後就被新樣本稀釋）。
- 後續行動／待辦：
  1. ~~首次排程執行後確認 `relay-health-state` 分支建立、main 沒有收到 `health-history.json` 的提交。~~ **已確認**（見上）。
  2. ~~確認無誤後從 main 刪除 `health-history.json` 種子。~~ **已刪除**，並補上 `historyOrThrow` 守衛與 `.gitignore`。
  3. `threat-intel.yml` 每日一筆提交是合理的（內容真的變），不在本 ADR 範圍。
  4. ~~（獨立）CI 的 `audit` job 每次都 `cargo install cargo-audit --locked`⋯⋯~~ **已處理（ADR-0351）**：改用釘版＋釘 sha256 的預編 binary，實測 **217s → 8s**（同一個 job 在 main 上的前後對照）。
  5. 🔴 **cron 的準時性仍未驗證。** 合併後第一個排程時段（2026-09-15 12:17Z）**沒有觸發**——上面那次實跑是手動 `workflow_dispatch` 的。整個窗口長度的正確性建立在「4 次/天」上，而 `uptime.test.ts` 只能驗證常數與 cron **字面一致**，驗不到 GitHub 實際跑幾次。若實際觸發率明顯低於 4 次/天，那條測試就只是自洽而非正確，`PROBES_PER_DAY` 得按實測值再調一次。要判斷這件事，看 `relay-health-state` 分支的 `probes` 增長速度最準。
  6. 🔴 **CF 儀表板：把 Workers Builds 限制為只建 production 分支（`main`）。** 這個 repo 沒有 preview 部署的需求，而非 production 分支的建置對 `relay-health-state` 是**必定失敗**的（見上）。儀表板設定進不了 repo，故記在此（同 ADR-0212 的處理方式）。路徑修正生效後，驗證方式是看下一次狀態分支推送**有沒有產生 check run**——沒有就是排除規則生效了。
