# 0207. 瀏覽器版 web app 容器化部署（Docker＋Caddy，含 CSP）供 Zeabur/PaaS

- 狀態：已接受
- 日期：2026-07-19
- 相關文件：`apps/desktop/Dockerfile`、`apps/desktop/Caddyfile`、`docs/self-hosting-web-app.md`、ADR-0090（金鑰邊界）、ADR-0147（web app 獨立 origin＋CSP）、relay 的 `relay/Dockerfile`

## 背景與問題

`docs/self-hosting-web-app.md` 已教瀏覽器版部署（Cloudflare Pages/Netlify/Vercel），但**沒有容器化目標**——relay 有 `relay/Dockerfile`，web app 沒有。想把 web app 部署到 **Zeabur** 這類 Docker PaaS（與 relay 同平台、子網域、自動 TLS）時無現成檔。

關鍵安全需求（ADR-0090/0147）：web app 的 origin 必須有**嚴格 CSP**。GitHub Pages **無法設回應標頭**（只能弱化的 `<meta>`，且 `frame-ancestors` 對 meta 無效）；Zeabur/Caddy 能設**真標頭**，故更適合這個 E2E app。

## 決策

新增 web app 的容器化部署檔，比照 `relay/Dockerfile` 的多階段模式：

- **`apps/desktop/Dockerfile`**：`node:22-slim` 建置（`pnpm install` ＋ `pnpm --filter @cinderous/desktop build`）→ `caddy:2-alpine` 執行（`dist` 複製到 `/srv`）。build context = **repo 根**（pnpm workspace 需根 lockfile＋packages/*）。
- **`apps/desktop/Caddyfile`**：`auto_https off`（平台邊緣終結 TLS，容器只跑 HTTP）、`:{$PORT}`（平台注入）、SPA `try_files … /index.html`、`encode gzip zstd`，並設**嚴格 CSP 標頭**。
- **CSP `connect-src` 由環境變數注入**：`{$CSP_CONNECT:wss:}`——預設允許任意安全 WebSocket（配合 app 可自選 relay 的彈性），部署者可設 `CSP_CONNECT=wss://relay.你的網域` 鎖死自己的 relay。**如此 shared repo 保持與特定 relay 網域無關**（沿用 self-hosting doc「部署專屬設定不進共用 repo」的原則，ADR-0191 慣例）。

## 理由

- 容器化＝與 relay 同平台（Zeabur）、同模式，一致好維護；平台自動配 TLS/子網域。
- Caddy 真標頭 CSP 滿足 ADR-0090/0147（GitHub Pages 做不到 `frame-ancestors`）。
- 環境變數化 relay 位址＝repo 通用、operator 可鎖死；預設 `wss:` 對「使用者自選 relay」友善。

## 後果

- 正面：web app 可一鍵容器部署到 Zeabur/Railway/Fly；與 relay 併在同專案、各自子網域、自動 TLS。安全標頭齊全。
- 中性 / 已知殘餘：
  - 預設 `connect-src wss:` 較寬（任意 relay）；要最嚴格請設 `CSP_CONNECT`。
  - `style-src 'unsafe-inline'`（app 有 inline style）——與既有 self-hosting doc 的 CSP 一致；crypto 走純 JS（無 WASM），故不需 `wasm-unsafe-eval`。
  - **金鑰邊界不變**（ADR-0090/0147）：web app 應放與官網**不同 origin**（子網域即可）；送 JS 的伺服器等於握有金鑰，故仍建議追求最強保證者用桌面原生版。
  - 本 ADR 只加部署檔，不改任何 app 邏輯。
- 後續：`self-hosting-web-app.md` 補一段 Zeabur/Docker 部署。
