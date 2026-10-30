# 0405. CLI 的發布方式與官網說明頁

- 狀態：已接受
- 日期：2026-10-30
- 相關文件：ADR-0098（CLI 與 AI／MCP 的邊界）、ADR-0404（CLI 的 agent 私人頻道）、ADR-0090（官網與通訊平面分離）、ADR-0396（公開文案用語）

## 背景與問題

ADR-0404 讓 CLI 能當「你和自己的 agent 之間的私人頻道」，但 CLI 只存在於 monorepo 的 `apps/cli`：
要用就得 clone、`pnpm install`、自己 build。使用者（2026-10-30）要求：

1. 官網新增 CLI 使用說明；
2. GitHub Release 提供可下載的 CLI；
3. 官網提供下載連結。

限制：

- 官網只教學、不收資料（ADR-0090）——不能有表單、不收金鑰或 npub。
- 換版時不想改網站。
- 說明不能誇大（ADR-0396 以及既有的「不宣稱量子安全、零知識、對等的前向保密」規則）。
- CLI 已經用 esbuild 打成單一個 `dist/cinder.js`，只依賴 `node:` 內建模組。

## 考量的選項

- **A. 單一 `.mjs` 檔＋sha256，附在每個 GitHub Release，固定檔名**：使用者要自己裝 Node.js 22。
- B. 發到 npm（`npx @cinderous/cli`）：最方便，但 SDK 已決定不上 npm（SDK ADR 0110），CLI 會依賴發布帳號與 npm 的供應鏈，也多一個要管的發布管道。
- C. 用 Node SEA／pkg 打成各平台執行檔：不用裝 Node，但每平台約 50–100 MB、要分平台建置，Windows 未簽章的 exe 還會被 SmartScreen 擋。
- D. 只在 README 寫「clone 後自己 build」：不滿足需求 2、3。

## 決策

採用 **A**。

- **成品**：`pnpm release:cli` 先 build CLI，再跑 `scripts/cli-artifact.mjs`。腳本會檢查成品帶 shebang、只 import `node:` 模組，然後輸出 `dist-release/cinder.mjs` 與 `cinder.mjs.sha256`（`sha256sum -c` 格式）。
- **檔名不帶版號**：官網用 `releases/latest/download/cinder.mjs`，換版不用改網站。版本號由 `cinder --version` 回報（build 時注入的 `__APP_VERSION__`）。
- **build 加 shebang**（`#!/usr/bin/env node`），macOS／Linux 加執行權限後能直接跑；Windows 用 `node cinder.mjs`。
- **官網 `/cli/` 頁**（中英）：下載與校驗檔按鈕、需求、安裝驗證、設定步驟、結束碼、旗標、Claude Code 的設定範例（`.claude/settings.json` 擋讀 `~/.cinder/**`、CLAUDE.md 片段）、限制、中繼額度。首頁 hero 加一顆 CLI 入口，頁尾加連結。
  - hero 入口連到說明頁，不直接下載：只拿到一個 `.mjs` 檔，使用者不知道要用 Node 跑，也不知道要先設 `--from`。
- **說明頁的內容由測試把關**：
  - 頁面上每個 `--旗標` 與 `cinder.mjs <指令>` 都必須出現在 CLI 的 `HELP`；
  - 速率數字取自中繼的 `MAX_EVENTS_PER_MINUTE`；
  - 下載檔名取自腳本的 `ARTIFACT_NAME`；
  - 兩種語言都必須寫出三點：模型看得到明文、私鑰與狀態目錄在同一台機器、`--fs` 只保護存在中繼上的密文；
  - 不能有 `<form>`／`<input>`。

## 理由

- 單檔只有約 0.7 MB、跨平台共用一份，不新增發布管道，也不用簽章。目標使用者本來就在跑 Claude Code 這類 agent，裝 Node.js 22 的門檻很低。
- 固定檔名加 `latest` 讓網站與版本解耦。sha256 讓下載者能驗檔案。這只證明檔案跟 Release 頁上的一致，不能取代簽章，說明頁也是這麼寫的。
- 測試把說明綁在真實的 HELP 與常數上，旗標改名或額度調整時，說明頁會在 CI 變紅，不會悄悄過時。

## 後果

- 正面：使用者不用 clone repo，下載一個檔就能讓 agent 聯絡自己。官網說明與 CLI 的實際行為由測試保持一致。
- 負面 / 已知殘餘風險：
  - 🔴 在第一個帶有 `cinder.mjs` 的 Release 發出之前，官網的下載連結是 404。這個變更合併後，網站會自動部署，所以合併與發版要一起做。
  - 需要使用者自己安裝 Node.js 22。
  - 檔案沒有簽章。sha256 與檔案放在同一個 Release，擋不住 Release 本身被竄改。
  - 跟桌面版與 APK 一樣是手動發版，會漏傳。
- 後續行動 / 待辦：
  - 發版流程加兩步：跑 `pnpm release:cli`，再把 `dist-release/cinder.mjs` 與 `cinder.mjs.sha256` 上傳到 Release。
  - 如果之後需要不裝 Node 也能用，再評估選項 C。
