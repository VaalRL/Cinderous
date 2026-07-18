> 🌐 **English** · [English version](./SELF-HOSTING.en.md)

# 自架 Cinderous（單一入口）

這是自架的**總覽入口**——一頁看懂「有哪些部署方式、各自差在哪、該選哪個」，再點進對應的詳細文件。

自架分兩類：

- **A. 自架中繼節點（relay）** — 為這片森林添一簇營火。中繼**只轉發密文**，看不到你的訊息內容，也看不到誰在跟誰說話。多數人要的是這個。
- **B. 自架網頁客戶端（web app）** — 把瀏覽器版部署到你自己的網域。屬進階／組織用途。

---

## A. 自架中繼節點（relay）

同一份 `RelayCore`，四種外殼任選；**中繼一律只轉發密文**。

| 方式 | 難度 | TLS（`wss://`） | 免費層/限制 | 適合 |
| --- | --- | --- | --- | --- |
| **Cloudflare Worker** | ★☆☆ 最省事 | 平台自動 | 免費層：~10 萬請求/天、duration 上限 | 想最快上線、流量不大 |
| **Zeabur（PaaS 容器）** | ★☆☆ | 平台自動 | 無免費層硬限、固定網域 | 想擺脫免費層限制又不想碰 TLS/開埠 |
| **Docker / VPS** | ★★☆ | 需自備（反向代理） | 由你的主機決定 | 已有 VPS、想完全自主 |
| **樹莓派 / 家用機** | ★★★ | 需自備（開埠＋TLS＋動態 IP） | 只有電費（~2–5W） | 極致自主、隱私最大化 |

### 各方式怎麼做

- **Cloudflare Worker**（`relay/` 的 Worker）：`pnpm dlx wrangler login` → `wrangler deploy`，取得 `wss://<worker>.<你的子網域>.workers.dev`。詳見 [README 的「在 Cloudflare Workers 架設中繼站」](../README.md#-在-cloudflare-workers-架設中繼站nostr--webrtc-信令-relay) 與 [`relay/wrangler.toml`](../relay/wrangler.toml)。多座錨點的部署與收錄見 [`MAINTAINER-ACTIVATION.md`](./MAINTAINER-ACTIVATION.md)。
- **Zeabur（PaaS）**：平台在邊緣終結 HTTPS/WSS，容器只跑純 `ws://` 的 `node-relay`。詳見 [`self-hosting-zeabur.md`](./self-hosting-zeabur.md)。
- **Docker / VPS**：`relay/Dockerfile` 已備好（`node-relay`＋內建 SQLite，`DB_PATH=/data/…`）；自行掛 volume 與反向代理（Caddy/Nginx）上 TLS。可參照 [`self-hosting-zeabur.md`](./self-hosting-zeabur.md)（同一容器）與 [`self-hosting-raspberry-pi.md`](./self-hosting-raspberry-pi.md)（systemd/環境變數）。
- **樹莓派 / 家用機**：任何 Node 22+ 機器即可（`node-relay` 用內建 `node:sqlite`）。詳見 [`self-hosting-raspberry-pi.md`](./self-hosting-raspberry-pi.md)。

### 部署完之後

- 你的節點**立刻可用**：手動填網址的人、或把它設為 home 的聯絡人都連得到。
- 想被官方**自動選座池**收錄（進維護者簽章清單）→ 見 [`NODE-SUBMISSION.md`](./NODE-SUBMISSION.md)（拉取式、可驗證、無審查後台）。

---

## B. 自架網頁客戶端（web app）

把 Cinderous 的**瀏覽器版**部署到你自己的網域（金鑰與身分仍存使用者本機、加密）。**安全邊界**：對 client-side E2E app 而言「送出 JS 的伺服器等於握有金鑰」，故務必 **app 與官網分不同 origin＋全程 HTTPS＋嚴格 CSP**。詳見 [`self-hosting-web-app.md`](./self-hosting-web-app.md)（依據 ADR-0147/0090）。

---

## 相關文件

- 維護者啟用簽章池：[`MAINTAINER-ACTIVATION.md`](./MAINTAINER-ACTIVATION.md)
- 第三方節點提交：[`NODE-SUBMISSION.md`](./NODE-SUBMISSION.md)
- 決策背景：ADR-0005（自建 Worker relay）、0075（容器化自架）、0039（錨點/簽章清單）、0147（web app 分 origin）
