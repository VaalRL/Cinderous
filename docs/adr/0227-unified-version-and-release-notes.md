# 0227. 統一版號、runtime 版號顯示與雙語 release note

- 狀態：提議中
- 日期：2026-07-21
- 相關文件：ADR-0071（雲端快照）、i18n（`packages/i18n`，`Locale: "zh-Hant" | "en"`）、既有雙語檔名慣例（`X.md` / `X.en.md`）

## 背景與問題

版號現況分四層、治理鬆散：

- **對外 tag/release 統一**（`v0.0.1…v0.0.12`，最新 release「Cinderous v0.0.12」）。
- **各 app `package.json` 不同步**：desktop `0.0.12`（散在 package.json / `tauri.conf.json` / `Cargo.toml` 三處、手動同步易漏），**cli / mobile 落後停在 `0.0.11`（發 v0.0.12 時漏 bump）**，website / 內部 lib `0.0.0`。
- **runtime 完全無版號**：app 內查無 `APP_VERSION`／`getVersion`，跑起來看不到自己是哪一版——跨裝置同步與問題回報時無法辨識版本。
- 專案**沒有 CHANGELOG / release notes**，發版是**手動 `gh release`**（無自動 workflow），release 內容也非雙語結構化。

（協定/資料契約版號 `nb-assets:v1`、`CloudSnapshotContent.v` 等是另一回事——跨版本相容用，與產品版號解耦，維持不變。）

## 決策

### 1. 版號 SSOT ＝ root `package.json` 的 `version`
- monorepo root `package.json` 的 `version` 為**單一真實來源**。
- 新增 `scripts/version-sync.mjs`（`pnpm run version:sync`）：讀 root version，寫入
  **desktop**（package.json＋`src-tauri/tauri.conf.json`＋`src-tauri/Cargo.toml`）、**mobile**、**cli**、**website** 的 `version`。
- **四端 app 全部對齊同一版號**；內部 lib（core/engine/i18n/theme）維持 `private`／`0.0.0`，不參與對外版號。
- bump 流程：改 root `version` → `pnpm run version:sync` → 全體一致（根治 cli/mobile 漏 bump）。
- CI 加一步 `version:sync --check`（乾跑比對），不一致即 fail，防止再度漂移。

### 2. Runtime 版號注入（build-time，源自 SSOT）
- 各 app `vite.config.ts` 以 `define` 注入 `__APP_VERSION__`（自 root `package.json` 讀取），前端經共用常數取用。
- desktop 一律走此 build-time 常數（**不**混用 Tauri `getVersion()`，避免 vite 與 tauri 兩來源分歧；`tauri.conf` 版號由 P1 腳本保證同步）。

### 3. Release note ＝ `docs/releases.json`（雙語結構化，單一來源）
- 格式（新到舊）：`[{ "version", "date", "zh": string[], "en": string[] }]`。
- **app**：build 時 `import` `releases.json`，依 `Locale` 顯示對應語言條目。
- **GitHub release**：`scripts/release-notes.mjs <version>` 讀同一份，輸出「繁體中文段＋英文段」的 release body（供 `gh release create --notes-file`）。
- 單一來源＝app 顯示、GitHub release、未來自動化都吃同一份，不重複維護、不漂移。

### 4. App 內呈現 ＝ 設定「關於／版本」區
- 面向使用者 app（先做 **desktop**）設定頁新增「關於」區塊：顯示目前 `__APP_VERSION__`＋可展開的**本版更新記錄**（依 locale 顯示 `releases.json` 對應版本的 zh/en）。
- i18n 補對應 UI 鍵（「關於」「版本」「更新記錄」等），繁中＋英文。

### 5. 發版流程整合（手動流程更新，暫不自動化）
發版 checklist：改 root `version` → `pnpm run version:sync` → 於 `releases.json` 補該版雙語 note → build（含 `tauri:build`）→ `gh release create vX.Y.Z --notes-file <腳本輸出>`。未經使用者指示不自行發版。

## 理由

- 單一 SSOT＋sync 腳本＋CI 檢查＝根治「各 app 版號漂移、desktop 三處手動漏改」。
- release note 單一結構化來源同時餵 app 與 GitHub，雙語一次寫、兩處用。
- runtime 版號源自同一 SSOT（build-time 注入），跨裝置/回報可辨識版本，且與 tag/release 天然一致。
- 沿用既有 i18n 與雙語慣例，不新增翻譯機制。

## 後果

- **正面**：版號全平台一致且防漂移；跨裝置可見版本；release note 雙語且 app／GitHub 共用一份；發版步驟明確。
- **中性／取捨**：
  - releases.json 需**發版時人工補該版雙語條目**（翻譯品質靠人；可接受，量少）。
  - 初次統一需選定起始版號（main 已累積未發版的 v0.0.13 內容、desktop 處 hold）——建議 root 設 `0.0.13`（宣告進入下一版開發，**非發版**）。
  - runtime 版號為 build-time 快照：改版號後需重新 build 才更新（符合預期）。
  - mobile/cli/website 的 runtime 顯示 UI 可後續補（P4 先做 desktop）。
- **實作階段**：
  1. **P1**：root SSOT ＋ `version:sync` 腳本（對齊四端＋desktop 三處）＋ CI `--check`。
  2. **P2**：vite `define __APP_VERSION__`（各 app）＋共用取用點。
  3. **P3**：`docs/releases.json` ＋ `release-notes.mjs`（生成 gh 雙語 body）＋回填 v0.0.12/0.0.13 條目。
  4. **P4**：desktop 設定「關於／版本」區 UI ＋ i18n 鍵（zh/en）。
  - 落地後同步 `ARCHITECTURE.md`／發版文件，轉「已接受」。
