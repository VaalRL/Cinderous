# 0191. 專案更名 Cinder → Cinderous（含 npm scope）＋錨點子網域 whoami885 → cinderous1

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：全專案；ADR-0186（Pages 專案頁）、ADR-0189（錨點）

## 背景與問題

維護者於外部完成兩項更名：
1. **GitHub repo** `VaalRL/Cinder` → `VaalRL/Cinderous`。
2. **Cloudflare workers.dev 子網域** `whoami885` → `cinderous1`（舊子網域已失效，`cinder-relay.whoami885.workers.dev` 無法解析；新址 `cinder-relay.cinderous1.workers.dev` HTTP 200）。

程式碼需同步收尾。經確認，更名範圍採**全改（含 npm 套件 scope）**。

## 決策

- **npm scope**：`@cinder/*` → `@cinderous/*`（9 套件的 package.json `name`／全部 import／tsconfig／workflow `--filter`／`pnpm-lock.yaml` 重新產生）。
- **產品顯示名**：大寫 `Cinder` → `Cinderous`（官網文案、README、app 標題、`productName`、註解、CLI 說明等，~146 處）。
- **錨點/預設 relay 子網域**：`whoami885` → `cinderous1`（`ANCHOR_RELAYS`、`DEFAULT_RELAY`、`relays.json`、docs）。
- **連結/部署**：`GITHUB_URL` → `VaalRL/Cinderous`；Vite `base` → `/Cinderous/`；git remote 改指 `Cinderous.git`。
- **刻意保留（小寫內部識別字）**，避免破壞資料/身分：
  - keyring 服務名 `app.cinder.desktop`（改了會**讓既有金鑰失聯**）
  - Tauri bundle `identifier` `app.cinder.desktop`（app 更新/註冊身分）
  - Rust crate `cinder-desktop` / `cinder_desktop`（模組路徑）
  - relay worker 名 `cinder-relay`（新 URL host 仍是 `cinder-relay.cinderous1…`，改名要重部署）
- **ADR 歷史（0001–0190）不動**：immutable，保留當時真實的 `Cinder`/`@cinder`/`whoami885`。
- **修回過度替換**：Buy Me a Coffee 帳號 id 恰巧也叫 `whoami885`（與 CF 子網域無關），捐款連結修回 `buymeacoffee.com/whoami885`。

## 理由

- 大小寫剛好切分「顯示名（大寫 `Cinder`）＝改」與「內部識別字（小寫 `cinder`）＝留」，讓機械替換安全、且不動到 keyring/bundle 身分。
- 保留 keyring 服務名與 bundle id ＝既有本機金鑰仍可存取、app 更新身分穩定；worker 名保留＝不必重部署 relay。

## 後果

- 正面：品牌一致（含 npm scope）；官網部署位址改為 `vaalrl.github.io/Cinderous/`。
- 負面 / 已知殘餘風險：
  - **客戶端須重建**：relay 子網域與品牌皆為編譯期常數；且**舊 whoami885 relay 已死**，未重建的既有客戶端會連到失效位址→重建有急迫性。
  - ADR 內文仍為舊名（歷史正確，非錯誤）。
  - 免安裝二進位仍名 `cinder-desktop.exe`（Rust crate 名保留），安裝檔則為 `Cinderous_*`（`productName`）——命名混用但功能無礙。
- 驗證：全工作區 typecheck 9/9 綠、**1341 測試全過**、`pnpm-lock.yaml` 重新產生（@cinderous 17／@cinder 0）、website build asset 前綴 `/Cinderous/`、relay 打包 OK。
- 後續：重建並重新部署桌面/行動/CLI；GitHub Release 用新名。
