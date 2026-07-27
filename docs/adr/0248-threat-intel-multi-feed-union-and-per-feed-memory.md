# 0248. 威脅情報多-feed 聯集＋逐-feed 記憶（止住變動量護欄反覆誤觸）

- 狀態：已接受
- 日期：2026-07-27
- 相關文件：ADR-0231（威脅情報 snapshot P2）、ADR-0235 H5（絕不封鎖清單＋變動量護欄）、`scripts/threat-snapshot.mjs`、`.github/workflows/threat-intel.yml`、`apps/website/vite.config.ts`（出貨白名單）

## 背景與問題

`docs/threat-intel.json` 由排程 workflow 每日重建（抓 URLhaus＋StevenBlack，抽 registrable domain）。ADR-0235 H5 加了一道**變動量護欄**（`MAX_CHANGE_RATIO = 0.5`）：單次網域數增減超過 50% 就中止並保留上一版，防上游被投毒／格式改版時把半個網際網路遮起來。

實跑後排程**反覆變紅**。根因不是投毒，而是 **URLhaus 兩個 feed 數量分歧**：

- `urlhaus.abuse.ch/downloads/hostfile/`（直連，即時活躍威脅）在 CI 抓到 **~592**；
- `StevenBlack/.../URLHaus/hosts`（GitHub 鏡像，較滯後但穩定）抓到 **~368**；
- abuse.ch 直連在部分環境（本機開發）**網路不可達**。

舊實作 `fetchFeed(feeds)` 是「依序嘗試、誰先通用誰」。於是每次排程接到的來源不固定，網域數在 368↔592 間跳動 → 護欄把「換源」誤判為「暴增／暴跌」→ `exit 1`。單純 commit 某一次的數字止不了血（下次換源又跳）。前一版曾以「鏡像優先、abuse.ch 降後備」band-aid 止血，但那**丟棄 abuse.ch 獨有的即時威脅**，是覆蓋換穩定的犧牲。

## 考量的選項

- **選項 A：鏡像優先（band-aid，前一版）**——URLhaus 只認穩定鏡像。止血有效但覆蓋變窄（丟 abuse.ch ~200+ 獨有活躍威脅），且違反「盡量多蓋」的防護初衷。
- **選項 B：放寬護欄門檻**——把 `MAX_CHANGE_RATIO` 調大到容忍分歧。等於削弱投毒防護，否決。
- **選項 C：多-feed 聯集＋逐-feed 記憶（本案）**——把一個來源的所有 feed 都抓下來去重聯集；每個 feed 記住上次成功內容（last-known-good），某 feed 暫時不可達就沿用記憶，聯集不縮水。
- **快取放哪**：committed 檔（跨環境／跨 CI run 共用、durable） vs `actions/cache`（會過期／被驅逐、且本機拿不到→分歧重現）→ 選 committed 檔。

## 決策

採**選項 C**：

1. **聯集**：`SOURCES[].feeds` 全部抓取，去重合併為該來源網域集（`unionWithMemory` 純函式）。feed 順序不再影響結果。
2. **逐-feed 記憶**：多-feed 來源每個 feed 的最後成功內容寫入 **`docs/threat-intel.feeds.json`**（`{ feeds: { <url>: string[] } }`）。抓失敗的 feed 沿用其記憶；來源全 feed 皆失敗且**完全無記憶**時才回退「保留上一版整個來源」。單-feed 來源（StevenBlack）不進快取（省重複存 2 萬筆），沿用既有整來源回退。
3. **快取為 committed、不出貨**：放 `docs/` 供版控與跨環境共用；因 `apps/website/vite.config.ts` 的複製是**白名單**（僅 `releases.json`＋`threat-intel.json`），此檔**不會進 dist、不送 app**。內含 `_note` 自我標註。workflow 提交步驟一併 `git add` 此檔（CI 每次全新環境，無 committed 記憶就救不回暫時掛掉的 feed）。
4. **護欄不變、比對聯集**：`guardTripped` 仍以 0.5 門檻比對聯集 vs 上一版；`--check` 擴充為**同時驗快取內容**（含絕不封鎖比對）。
5. **`--reseed` 逃生口**：新增旗標跳過護欄，供「來源組成刻意變動」（首次建聯集、加減 feed）時重設基準；經 `workflow_dispatch` 的 `reseed` 輸入手動觸發。
6. **可測純核心**：`parseHosts`／`isNeverBlocked`／`unionWithMemory`／`guardTripped` 匯出，`scripts/threat-snapshot.test.mjs` 以 Node 內建 runner 覆蓋；因 root `scripts/` 不在 pnpm workspace，CI（`ci.yml`）新增 `node --test scripts/*.test.mjs` 一步。腳本改為「作為入口才跑 `main`」以免 import 觸發 I/O。

## 理由

聯集覆蓋**嚴格 ≥** 任一單 feed，防護更完整（不像 band-aid 丟資料）；逐-feed 記憶讓聯集**跨環境穩定**——某 feed 不可達不再讓數字縮水，護欄回到只在「真的大量增減」時才響的本意，**門檻無需放寬、投毒防護不打折**。committed 快取是唯一能同時滿足「CI 全新環境可沿用」與「本機／CI 一致」的儲存（`actions/cache` 會被驅逐且本機取不到）。`--reseed` 手動化＝護欄穩態下**永遠在線**，不因 feed 抖動自動放行（不開投毒窗）。

## 後果

- **正面**：覆蓋最廣（兩 feed 聯集）；跨環境數字一致→排程不再誤觸護欄→回綠；護欄語意恢復；純邏輯有測試鎖住。
- **負面 / 已知殘餘風險**：
  - 多一個 committed 檔（`docs/threat-intel.feeds.json`，~數百筆多-feed 記憶），repo 略增噪音——換 durable／跨環境一致，值得。
  - **合併後首次建聯集會跳一次**（368→~700，abuse.ch 併入）→ 需**手動 dispatch 一次 `reseed=true`** 於 CI 建立真實基準（本機因 abuse.ch 不可達只得 368，無法在本地產出 CI 的 ~700 基準）。之後每日排程比對 ~700 vs ~700 穩定。
  - 記憶會沿用「最後成功」內容——若某 feed 長期掛掉，其貢獻會逐漸陳舊（但不消失）；此為刻意取捨（舊資料優於縮水）。
- **後續行動 / 待辦**：
  1. 合併本分支到 `main`。
  2. 於 GitHub Actions 手動觸發 `威脅情報 snapshot 更新` 並勾 `reseed` 一次，讓 CI 抓齊 abuse.ch＋鏡像、建立聯集基準並回填 abuse.ch 記憶。
  3. 確認後續排程回綠。
