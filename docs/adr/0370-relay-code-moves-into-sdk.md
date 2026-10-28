# 0370. 中繼程式碼與共用協定搬進 Cinderous SDK，`relay/` 成為部署實例

- 狀態：已接受（**分支 `claude/relay-on-sdk` 已完成，合併與部署暫緩**，見〈落地時程〉）；2026-10-19 相依由 `#v0.18.0` 升到 `#v0.68.3`（含 SDK ADR 0097 額度用完時說明原因、0098 拿掉 `idx_offline_kind`，對應 ADR-0387／0388；新增的 Worker 設定全部可選，錨點沒設、沿用預設）；2026-10-20 再升到 `#v0.71.0`（SDK ADR 0099–0101 只動 Node 版中繼與部署設定器，錨點的 Cloudflare 版行為不變）；2026-10-27 SDK 公開（SDK ADR 0110），相依改成公開 repo `github:VaalRL/cinderous-sdk#v0.77.0`、與 main 合併，見〈與 main 合併〉
- 日期：2026-09-27
- 相關文件：Cinderous SDK ADR 0006（PRD 矛盾拍板）、ADR 0007（中繼與共用協定搬進 SDK）；
  本庫 ADR-0005（自建 Worker relay）、ADR-0056（DO SQLite）、ADR-0075（容器化自架）、ADR-0241（分片）、
  ADR-0260（NIP-11）、ADR-0354（合一 Worker）、ADR-0356（一鍵部署與版號）、ADR-0366～0369（車道）

## 背景與問題

Cinderous SDK（`VaalRL/cinderous-sdk-dev`，AGPL-3.0）原本只有客戶端層，四款遊戲已經改用。產品決定（2026-09-27）：
**SDK 要完整收納現在的中繼，成為中繼的唯一來源**；本庫的 `relay/` 只留部署設定與運維。

這推翻了先前「relay 與客戶端不分 repo」的建議。代價是協定改動從「一次提交改兩邊」，變成「SDK 先發版、本庫再升版」。

搬移時發現：中繼用到的 `@cinderous/core` 是**客戶端與中繼共用的協定**。中繼搬走，這些也要一起搬，
否則 SDK 會反過來依賴本庫。

## 決策

1. **共用協定的唯一來源改為 SDK**（`@cinderous/client/protocol`）：
   - `packages/core/src` 的 `event`、`sign`、`keys`、`nip42`、`http-auth`、`vanish`、`pow`、`shard`，
     改成**照原名從 SDK 轉出**；`nip59.ts` 的 `TIMESTAMP_JITTER_SECONDS` 同樣改從 SDK 取。
   - App 其他程式的 import 一行不改。
   - SDK 裡是原樣搬過去的同一份 `@noble` 實作：轉換前逐檔比對內容，確認兩邊一致。
   - 這五組協定的測試搬到 SDK。
2. **中繼程式碼搬到 SDK**（`@cinderous/client/relay`、`/relay/worker`、`/relay/node`）。本庫 `relay/` 留下：

   | 檔案 | 用途 |
   |---|---|
   | `src/worker.ts` | 部署實例入口：注入 App 版號（`setRelayVersion`），轉出 SDK 的 Worker `fetch` 與 `RelayRoom` |
   | `src/node-relay.ts`、`src/dev-server.ts` | 同上，給 Node／Docker 自架與本機開發；環境變數與原本完全相同 |
   | `src/index.ts` | 照原名轉出 SDK 的中繼核心，engine 的 import 不必改 |
   | `src/in-memory-network.ts` | 串 App 的 `RelayClient` 與 SDK 的 `RelayCore`（engine 的離線模式與測試） |
   | `src/version.ts` | App 版號（仍由 `scripts/version-sync.mjs` 同步） |
   | `wrangler*.toml`、`bootstrap/`、`Dockerfile` | 兩座錨點的設定、運維工具（簽章中繼清單、健康檢查、准入）、容器建置 |

   中繼本體的測試（relay-core、worker、儲存、政策、NIP-11、分片、vanish）搬到 SDK。
   本庫保留：讀 `wrangler.toml` 的設定測試、App 與中繼的整合測試、版號測試、bootstrap 測試。
3. **相依釘住標籤**：`@cinderous/client` 用 `github:VaalRL/cinderous-sdk-dev#v0.5.0`，鎖檔釘在 commit `0e4b8ce`。
   pnpm 預設寫的網址不帶標籤，會一路跟著 SDK 最新版，已手動改掉。

## 落地時程（暫緩合併與部署）

- **本庫是公開 repo，SDK 當時是私有 repo**。產品決定：SDK 等實作完成再公開。（2026-10-27 已公開為 `VaalRL/cinderous-sdk`，SDK ADR 0110；合併與部署仍要使用者另外同意。）
- 在那之前：
  - 合併進 main 會讓 clone 本庫的人 `pnpm install` 失敗，自架文件的 Docker 建置也會壞；
  - 只從分支部署，線上錨點跑的程式碼又會和 main 對不上。
- 所以本決策**在分支上完成並驗證**，兩座錨點維持現狀。
  **SDK 公開的那一天，再合併這條分支、兩座錨點一起部署**（產品決定：測試全過就兩座一起部署）。

## 驗證（分支上，2026-09-27）

- SDK v0.5.0：431 個測試全過，包括搬過去的 protocol 43 個、relay 317 個，以及 Node 主機的冒煙測試。
- 本庫：
  - `pnpm -r typecheck` 全過；core 824、relay 68、website 99 全過；全套測試另見 PR。
  - `wrangler deploy --dry-run` 打包成功，打包結果含 `RelayRoom` 與 App 版號。
  - 桌面版內嵌中繼的 esbuild 打包成功。
  - 打包後的 Node 主機實際啟動成功，`/healthz` 回 `ok`、NIP-11 照常回應。

## 後續：更多共用模組搬進 SDK（同一條分支）

SDK 依序做第四步（SDK ADR 0009～0011）時，把 Cinderous 已有、SDK 也需要的模組搬進 SDK，這裡比照本決策改成照原名轉出：

| SDK 版本 | 搬過去的模組 | SDK 入口 |
|---|---|---|
| v0.7.0 | `nip44`、`hybrid-kem`、`nip59`、`signaling` | `@cinderous/client/protocol` |
| v0.8.0 | `subkey`、`ek-envelope`、`device-directory` | `@cinderous/client/protocol` |
| v0.10.0 | `snapshot`、`file-relay`、`sync`、`or-set` | `@cinderous/client/sync` |
| v0.14.0 | `call`、`video-quality` | `@cinderous/client/protocol` |
| v0.15.1 | engine 的 `turn-fetch`（經 core 轉出） | `@cinderous/client/protocol` |

- 每次轉出前都逐字比對過，只容許三處已記錄的差異：
  - `ekAnnounceContent` 抽出；
  - 一個未用參數改名 `_k`；
  - `file-relay` 的 kind 常數就地定義。
- `file-relay` 的 kind 常數在 SDK 另有一份，由 `file-relay-kinds.test.ts` 釘住與 App 的 `KIND` 總表一致。
- `subkey.test.ts` 只留下與 App 私訊層（giftwrap）的整合測試。
- 相依當時釘在 `#v0.18.0`（現在是 `#v0.77.0`，見檔頭與〈與 main 合併〉；v0.18.0 的協定檔改用 @noble 2.x 並與 nostr-tools 釘同一版，SDK ADR 0020；v0.17.0 起 SDK 的中繼預設值改為中立，錨點在 `wrangler.toml` 自己設 `RELAY_NAME` 與 `DEVELOPER_DOCS_URL`，文件網址常數搬回 `relay/src/developer-docs.ts`，SDK ADR 0019；v0.16.0 修正 Node 主機的 NIP-11 缺 `version`：自架 Docker 節點的一鍵更新比對從此有版號可比，SDK ADR 0018）（v0.10.1 起 `openWrap` 多一道「seal 必須是 kind 13」檢查，SDK ADR 0012；v0.11 起中繼多了可選的存取控制，錨點沒設、行為不變，SDK ADR 0013）。

## 與 main 合併（2026-10-27）

使用者 2026-10-27 同意：SDK 公開後先把 ADR-0391、0392 移植到 SDK，再把 main 合併進這條分支。

- **SDK 先補齊**：分支落後 main 119 個 commit。main 這段期間的中繼改動 SDK 都已移植（ADR-0371～0373、0376、0377、0379～0382、0386～0390），
  只缺 ADR-0391（主平面的反覆重連限速）與 0392（沒認證就斷線的診斷）。這兩份移植成 SDK ADR 0111、發 v0.77.0：
  - 回絕的句子與錨點逐字相同；
  - DO 那一道預設開；
  - Worker 那一道照舊靠本庫 `wrangler.toml` 的 `STRICT_UPGRADE_LIMIT` binding。
  0393／0394 互相抵銷，不必移植。
- **相依**：`packages/core`、`relay` 改成公開 repo `github:VaalRL/cinderous-sdk#v0.77.0`，不再需要私有 repo 的權限。
- **衝突的處理**：
  - main 改了、這條分支刪掉的 relay 檔案（13 個），維持刪除；
  - main 新增的中繼模組（`capacity`、`conn-persistence`、`reconnect-guard`、`reject-messages`、`unauth-diag`）與它們的測試也刪掉——SDK 有同名、同數量的測試；
  - `worker.ts`、`index.ts`、`node-relay.ts` 用這條分支的轉出版本；main 在這些檔加的東西，SDK 都已經有了；
  - `core` 的 `event`／`keys`／`sign` 用轉出版本；main 的 noble 2.4.0（ADR-0374）保留在 `package.json`，SDK 也釘 2.4.0，整棵樹仍只有一份（`dependency-pins` 測試）；
  - main 新增的 `core/inbox-ack` 改成照原名轉出 SDK（實作相同，SDK 版另外接受 `NostrSigner`）；`public-reach`（ADR-0382）是 App 自己的功能，留在本庫；
  - `wrangler.toml` 以 main 為準，加回錨點的 `RELAY_NAME`、`DEVELOPER_DOCS_URL`；`wrangler-vars.test.ts` 兩邊的測試都留下，匯入改成 SDK。
- **留在本庫的中繼測試**（匯入改成 SDK）：
  - `reject-messages.test.ts`、`capacity-core.test.ts`：除了 SDK 也有的情境，還檢查**已上線的 App**（v0.0.18 的 `classifyOk`、配對信令）看得懂 SDK 中繼的句子，這是本庫特有的相容性；
  - 新的 `sdk-switch-compat.test.ts`：拿錨點**最後部署的**儲存程式（5137079c，`fixtures/main-5137079c-stores.mjs`）實際建一次 DO SQLite，確認：
    - 與 SDK `RelayRoom` 建構子從零建的 schema 逐字相同；
    - SDK 打開舊庫不丟例外、重跑不變，舊庫的列讀得回來；
    - 回滾時舊程式打開 SDK 建的庫照常讀寫。
- **驗證**：
  - `pnpm -r typecheck`、`pnpm -r test` 全過；
  - `wrangler deploy --dry-run`（頂層、`wrangler.relay2.toml`）打包成功，帶 `STRICT_UPGRADE_LIMIT`、`RELAY_NAME`，打包內含重連限速與診斷；
  - 統一模式的 dry-run 要先建置網頁版（`assets.directory`），與這次合併無關。

## 後果

- ＋ 中繼與共用協定各只有一份，App、四款遊戲、中繼看到同一套規則。
- ＋ 任何人（SDK 公開後）都能用 SDK 起一座與錨點同一套行為的中繼。
- － 改協定要先改 SDK、打標籤，本庫再升版；兩邊不能在同一個提交裡一起改。
- － 本庫的 core、relay 依賴 SDK：SDK 公開之前，CI、Docker 與 Tauri 打包都需要讀取私有 repo 的權限（2026-10-27 SDK 公開後不再需要；相依改用公開 repo 的 tag）。
