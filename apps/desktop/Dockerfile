# Cinderous 瀏覽器版 web app —— 容器化部署（Zeabur / Railway / Fly / 任何 Docker 平台）。
# 跑的是同一份 apps/desktop 前端（`isTauri()===false` 走瀏覽器路徑）；以 Caddy 靜態伺服，
# 設**嚴格 CSP 回應標頭**（ADR-0090/0147 要求 app origin 有 CSP——真標頭才做得到 frame-ancestors，
# 這就是不用 GitHub Pages 的原因）。說明見 docs/self-hosting-web-app.md 與 ADR-0207。
#
# 重要：build context 必須是 **repo 根目錄**（pnpm workspace 需根 lockfile 與 packages/*）。
# 在 Zeabur 設定服務時，Dockerfile 路徑填 apps/desktop/Dockerfile、根目錄保持 repo 根。

# ── 建置：安裝 workspace，Vite 打包瀏覽器版 ──────────────────────────────────
FROM node:22-slim AS builder
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cinderous/desktop build
# 產物：apps/desktop/dist（index.html ＋ 指紋化 JS/CSS）；base 為 "/"，適合子網域根部署。

# ── 執行：Caddy 靜態伺服 ────────────────────────────────────────────────────
# Zeabur 閘道在邊緣終結 TLS/HTTPS → 容器只跑 HTTP（Caddyfile 內 auto_https off）；PORT 由平台注入。
FROM caddy:2-alpine AS runtime
COPY --from=builder /app/apps/desktop/dist /srv
COPY apps/desktop/Caddyfile /etc/caddy/Caddyfile
