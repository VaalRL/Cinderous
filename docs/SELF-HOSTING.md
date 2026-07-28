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

### 設定（環境變數總表）

**全部選填**——一個都不設也能正常跑。兩座宿主（Cloudflare Worker／`node-relay`）用的是同一組
名稱，只有設定的**位置**不同：Worker 走 `wrangler.toml` 的 `[vars]`（機密用 `wrangler secret put`），
容器／自架走一般環境變數。

| 變數 | 預設 | 用途 | 適用 |
| --- | --- | --- | --- |
| `MAX_TTL_DAYS` | `7` | 離線留言保留天數上限。發送端蓋超過此上限的過期章會被截斷——**站方上限恆為權威**（ADR-0160/0065）。 | 兩者 |
| `MAX_FILE_MB` | 未設 | 設 ≥1 才收檔案塊（`FILE_WRAP` 1060）。**未設＝整類拒收**，公共站零儲存風險（ADR-0162/0244）。 | 兩者 |
| `MAX_EVENTS_PER_MINUTE` | `120` | 每 pubkey 每分鐘事件上限；設 `0` 關閉（ADR-0235 H1）。 | 僅 `node-relay` |
| `REQUIRE_AUTH` | 開啟 | 設 `0` 關閉 NIP-42 認證。**強烈不建議**——見各平台文件的說明。 | 僅 `node-relay` |
| `PORT`／`DB_PATH` | `8787`／`cinder-relay.db` | 監聽埠與 SQLite 檔路徑。 | 僅 `node-relay` |
| `TURN_KEY_ID`／`TURN_API_TOKEN`／`TURN_TTL_SECONDS` | 未設 | 公共 TURN 保底（ADR-0243）。未設＝`GET /turn` 回 204、客戶端退回純 STUN。**務必在 Cloudflare 端設用量上限封頂**（TURN 按流量計費）。 | 僅 Worker |

> **`MAX_PER_RECIPIENT`（每收件人 500 則）是程式內建常數，不是環境變數**——設了不會有作用。
> 舊版文件曾誤列為可設定，已更正。

### 節點識別與贊助入口（NIP-11）

你的中繼會對帶 `Accept: application/nostr+json` 的 HTTP GET 回一份
**NIP-11 Relay Information Document**（ADR-0260）；**不帶這個 header 時仍回純文字
`Cinderous relay`**，健康檢查不受影響。

下列變數**全部選填、未填的欄位不會出現在文件裡**：

| 變數 | 說明 |
| --- | --- |
| `RELAY_NAME` | 站名（未設＝`Cinderous relay`）。 |
| `RELAY_DESCRIPTION` | 一句話描述。 |
| `RELAY_CONTACT` | 聯絡方式（email／npub）。**想被選座池收錄就要填**——收錄標準之一是「出事找得到人」（`NODE-SUBMISSION.md`）。 |
| `RELAY_PUBKEY` | 營運者公鑰（hex）。 |
| `NODE_ATTESTATION` | 你以營運者金鑰簽章的節點自報事件（JSON 字串），供維護者工具拉取驗簽（ADR-0092）。 |

**贊助入口（ADR-0089，全部選填）**——填了之後，桌面版連到你這座的使用者會在角落看到一張
低調、可關閉的「贊助此節點」小卡：

| 變數 | 例 |
| --- | --- |
| `DONATE_GITHUB_SPONSORS` | `https://github.com/sponsors/你的帳號` |
| `DONATE_BUY_ME_A_COFFEE` | `https://buymeacoffee.com/你的帳號` |
| `DONATE_LIBERAPAY` | `https://liberapay.com/你的帳號` |
| `DONATE_LIGHTNING` | `你@網域` 或 `lnurl1…` |

規則與界線：

- **三個網頁平台只收 `https://`**，`http://` 會被客戶端丟棄（贊助頁會輸入付款資訊）。
- **一個都不填＝不顯示贊助卡**（不會出現空卡片）。
- 客戶端**只對使用者的 home 座**顯示，且**行動端刻意不顯示**（App 商店政策）；企業模式隱藏。
- 卡片明講這是**你自報的**、**非官方背書**、**永不自動付款**——點擊只會用系統瀏覽器或錢包
  開啟外部連結。App 不經手金流、不抽成（PRD §12）。

Worker 範例（`wrangler.toml`）：

```toml
[vars]
RELAY_NAME = "某某的營火"
RELAY_CONTACT = "op@example.com"
DONATE_GITHUB_SPONSORS = "https://github.com/sponsors/yourname"
```

容器／自架範例：

```bash
RELAY_NAME="某某的營火" RELAY_CONTACT="op@example.com" \
DONATE_LIGHTNING="op@example.com" pnpm --filter @cinderous/relay node-relay
```

### 使用者可以要求你刪除他的資料（NIP-62）

中繼支援 **NIP-62 Request to Vanish**（ADR-0260）：使用者送出以自己私鑰簽章的 kind 62，
你的節點會**立刻**刪掉他發的事件、寄給他的離線留言、以及他的加密雲端快照——不必等 TTL 到期。

- 這是**自動**的，你不需要做任何事，也**沒有**後台可以否決。
- 請求必須指名你這座（`relay` tag）或 `ALL_RELAYS`；指向別座的請求不會生效。
- 對營運者的意義：使用者的「刪除我的資料」是**協定層保證**，不必寫在你的隱私權政策裡靠人信任。

---

## B. 自架網頁客戶端（web app）

把 Cinderous 的**瀏覽器版**部署到你自己的網域（金鑰與身分仍存使用者本機、加密）。**安全邊界**：對 client-side E2E app 而言「送出 JS 的伺服器等於握有金鑰」，故務必 **app 與官網分不同 origin＋全程 HTTPS＋嚴格 CSP**。詳見 [`self-hosting-web-app.md`](./self-hosting-web-app.md)（依據 ADR-0147/0090）。

---

## 相關文件

- 維護者啟用簽章池：[`MAINTAINER-ACTIVATION.md`](./MAINTAINER-ACTIVATION.md)
- 第三方節點提交：[`NODE-SUBMISSION.md`](./NODE-SUBMISSION.md)
- 決策背景：ADR-0005（自建 Worker relay）、0075（容器化自架）、0039（錨點/簽章清單）、0147（web app 分 origin）
