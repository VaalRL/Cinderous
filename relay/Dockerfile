# Cinder node-relay — 容器化部署（Zeabur / Railway / Fly / 任何 Docker 平台）。
# 說明見 docs/self-hosting-zeabur.md。
#
# 重要：build context 必須是 **repo 根目錄**（pnpm workspace 需要根 lockfile 與
# packages/core）。在 Zeabur 設定服務時，Dockerfile 路徑填 relay/Dockerfile、
# 根目錄保持 repo 根。

# ── 建置：安裝 workspace，用 esbuild 把 node-relay 打成單一 bundle ──────────────
FROM node:22-slim AS builder
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cinder/relay build:node-relay
# 產物：relay/dist/node-relay.js（97KB，已含 @cinder/core；僅 ws 為外部依賴）

# ── 執行：只帶 bundle 與唯一 runtime 依賴 ws，映像精簡 ─────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
RUN npm install ws@^8 --omit=dev --no-audit --no-fund
COPY --from=builder /app/relay/dist/node-relay.js ./node-relay.js
# 離線留言 SQLite 檔預設放持久化 volume（Zeabur 掛載 /data）；未掛載則存容器內、重啟即失。
ENV DB_PATH=/data/cinder-relay.db
# node:22 的內建 node:sqlite 需 --experimental-sqlite（Node 24+ 可免；換基底映像時一併調整）。
# PORT 由平台注入，node-relay 讀 process.env.PORT，故不寫死。
CMD ["node", "--experimental-sqlite", "node-relay.js"]
