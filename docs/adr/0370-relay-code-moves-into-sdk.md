# 0370. 中繼程式碼與共用協定搬進 Cinderous SDK，`relay/` 成為部署實例

- 狀態：已接受（**分支 `claude/relay-on-sdk` 已完成，合併與部署暫緩**，見〈落地時程〉）
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

- **本庫是公開 repo，SDK 目前是私有 repo**。產品決定：SDK 等實作完成再公開。
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
- 相依目前釘在 `#v0.15.1`（v0.10.1 起 `openWrap` 多一道「seal 必須是 kind 13」檢查，SDK ADR 0012；v0.11 起中繼多了可選的存取控制，錨點沒設、行為不變，SDK ADR 0013）。

## 後果

- ＋ 中繼與共用協定各只有一份，App、四款遊戲、中繼看到同一套規則。
- ＋ 任何人（SDK 公開後）都能用 SDK 起一座與錨點同一套行為的中繼。
- － 改協定要先改 SDK、打標籤，本庫再升版；兩邊不能在同一個提交裡一起改。
- － 本庫的 core、relay 依賴 SDK：SDK 公開之前，CI、Docker 與 Tauri 打包都需要讀取私有 repo 的權限。
