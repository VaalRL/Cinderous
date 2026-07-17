# 0185. 官網以 GitHub Pages 部署（GitHub Actions＋根站）

- 狀態：已接受
- 日期：2026-07-17
- 相關文件：ADR-0090（官網雙語文案）、`apps/website`、`.github/workflows/pages.yml`

## 背景與問題

官網（`apps/website`）目前只在本機打包，未有公開部署管道。使用者詢問能否直接用本 repo 的 GitHub Pages 裝這個靜態站。評估現況：

- 純靜態：Vite 打包為 `index.html + assets/`，無後端、無 API、無外部 CDN；透明度資料是本機驗簽的靜態 `funds.json`（放 `public/`，打包時複製進 `dist/`）。
- 導覽為 client-side（`App.tsx` 以 `useState<View>` 切頁，**無 URL 子路由**）→ GitHub Pages 常見的「子頁重新整理 404 / 需要 SPA fallback」**都不會發生**。
- `vite.config.ts` 未設 `base`（預設 `/`）；`Transparency.tsx` 以絕對路徑 `fetch("/funds.json")` 取資料——**只有在網站位於網域根 `/` 時成立**。
- 無任何 Pages 部署 workflow；`GITHUB_URL` 還指向舊名 `VaalRL/Nostr-buddy`（實際 remote 為 `VaalRL/Cinder`）。

## 考量的選項

- **選項 A（根站・user/org page 或自訂網域）**：站位於 `/`。`base "/"` 與 `fetch("/funds.json")` 皆維持不變＝網站程式碼零改動。取得根 URL 的方式：把 repo 命名為 `<user>.github.io`（user page），或於專案頁掛自訂網域。
- **選項 B（專案頁 `<user>.github.io/<repo>/`）**：站位於子路徑。需 `vite.config` 設 `base: "/<repo>/"`，且 `funds.json` 的 fetch 改為 base-aware（`import.meta.env.BASE_URL + "funds.json"`），否則 asset 與資料檔 404。
- 部署機制：手動推 `gh-pages` 分支 vs. GitHub Actions（`upload-pages-artifact` + `deploy-pages`）。monorepo 且站在子目錄，Actions 可精準 build `apps/website` 並自動更新。

## 決策

採**選項 A（根站）＋ GitHub Actions 部署**：

1. 新增 `.github/workflows/pages.yml`：push main 且動到 `apps/website/**` 或其 workspace 相依（i18n/theme/core）或本 workflow 時觸發（另附 `workflow_dispatch`）；`pnpm --filter @cinder/website build` → `upload-pages-artifact`（`apps/website/dist`）→ `deploy-pages`。pnpm/Node 設定鏡像 `ci.yml`（`pnpm/action-setup@v4` **不加 version**、node 22、cache pnpm），`concurrency` 群組避免重疊部署。
2. `GITHUB_URL` 修為 `https://github.com/VaalRL/Cinder`（現況正確值；源碼/releases/docs 連結皆由此衍生）。
3. 網站程式碼保持 `base "/"` 與 `fetch("/funds.json")` 不動——選項 A 下即正確。

一次性人工前置（GitHub 端，非程式碼）：Settings → Pages → Source = "GitHub Actions"；取得根 URL 需 repo 命名為 `<user>.github.io` 或掛自訂網域。

## 理由

- 站是純靜態、無伺服器狀態、無 URL 路由——GitHub Pages 天然契合，且完全不觸及訊息平面或金鑰（與 `footer_privacy` 的隔離宣稱一致）。
- 根站讓網站零改動；`base "/"` 與絕對路徑 fetch 維持原樣，減少回歸面。若日後改走專案頁，選項 B 的兩處改動已於 workflow 註解與本 ADR 標明。
- Actions 部署比手動推分支可重複、可稽核，且能只在網站相關變動時重建（省 CI）。

## 後果

- 正面：官網有一鍵、可稽核的公開部署；push 即更新；隱私宣稱不受影響（靜態、無站內金流/追蹤）。
- 負面 / 已知殘餘風險：
  - 根站需 repo 命名為 `<user>.github.io`（會占用該帳號**唯一**的 user-page 名額，且更動主 repo 名會改變 clone/remote URL）或改掛自訂網域——屬人工決定，本次不代為執行。
  - `funds.json` 仍為開發佔位簽章，透明度頁驗簽失敗會 fail-closed（不顯示數字）；正式上線須以真正透明度金鑰重簽。
  - GitHub 邊緣仍會記錄請求日誌（一般存取層級），與 app 層「零追蹤」宣稱不衝突但屬平台既有行為。
- 後續行動 / 待辦：
  - 若採用「repo 命名為 `<user>.github.io`」，記得同步 `GITHUB_URL`（或倚賴 GitHub 舊名轉址）與 Releases 發佈位置。
  - 若改走專案頁，執行選項 B 的 `base` 與 fetch 兩處改動。
