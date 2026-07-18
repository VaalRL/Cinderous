# 在 Zeabur 上自架 Cinderous 中繼站（node-relay）

在 [Zeabur](https://zeabur.com) 這類 PaaS 上跑一座 Cinderous 中繼站——比家用網路／樹莓派省事很多：**平台自動配 HTTPS（`wss://` 直接可用、免自己弄憑證）、有固定網域、可綁自訂網域**。跑的是**與 Cloudflare 版完全相同的 `RelayCore`**，只是外殼換成 Node.js + 本機 SQLite（同 `docs/self-hosting-raspberry-pi.md` 的 node-relay）。

> **為什麼比 Cloudflare 版好？** 擺脫免費層限制（沒有 10 萬請求/天、沒有 duration 上限）；比樹莓派省事（不用開埠、不用弄 TLS、不用管動態 IP）。中繼站**只轉發密文**，看不到你的明文或私鑰。

---

## 1. 運作原理（先理解一件事）

Cinderous 客戶端連的是 `wss://`（加密 WebSocket）。你**不需要在容器裡處理 TLS**——Zeabur 的閘道在邊緣終結 HTTPS/WSS，再以純 `ws://` 轉發到你的容器。所以：

```
客戶端  ──wss://你的服務.zeabur.app──▶  Zeabur 閘道(TLS)  ──ws://──▶  你的容器 :PORT
```

容器只需監聽 Zeabur 注入的 `PORT`（node-relay 已自動讀取），其餘 Zeabur 打理。

---

## 2. 前置

- 一個 [Zeabur](https://zeabur.com) 帳號（可用 GitHub 登入）。
- 這個 repo 在你能連上的 GitHub（例如你自己的 fork）。
- repo 內已附 **`relay/Dockerfile`** 與根目錄 **`.dockerignore`**——不用自己寫。

---

## 3. 部署步驟

### 3.1 建立服務

1. Zeabur → 建立專案（Project）→ 新增服務（Add Service）→ **Deploy from GitHub**，選這個 repo。
2. 因為是 monorepo、且要用附的 Dockerfile，設定服務的建置方式為 **Dockerfile**：
   - **Dockerfile 路徑**：`relay/Dockerfile`
   - **建置根目錄（build context / Root Directory）**：保持 **repo 根目錄**（`/`）——pnpm workspace 需要根 lockfile 與 `packages/core`，不可設成 `relay/`。

> 若 Zeabur 的介面把「根目錄」與「Dockerfile 位置」綁在一起、無法分開設，最省事的替代做法：把 `relay/Dockerfile` 複製一份到 repo 根目錄命名為 `Dockerfile`，Zeabur 就會自動抓到（build context 即為根，一切正常）。

### 3.2 加一個持久化 Volume（重要）

離線留言存在 SQLite 檔，容器重啟/重新部署預設會清空。掛一個 Volume 讓它存活：

- 服務 → Volumes → 新增，**掛載路徑填 `/data`**。
- `relay/Dockerfile` 已預設 `DB_PATH=/data/cinder-relay.db`，掛好即生效，不用再改。

> 不掛也能跑，只是每次重部署會清掉「尚未取件的離線留言」（本來也只存 7 天，影響有限）。要穩就掛。

### 3.3 環境變數（大多可用預設）

服務 → Variables，需要時才設：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | Zeabur 自動注入 | **不用自己設**，node-relay 會讀。 |
| `DB_PATH` | `/data/cinder-relay.db` | Dockerfile 已設；配合 §3.2 的 Volume。 |
| `REQUIRE_AUTH` | 開啟 | 保持開啟。設 `0` 會關掉 NIP-42 認證——任何人都能拉他人加密收件匣元資料、雲端快照也失去「只回本人」閘門（ADR-0057/0071），**強烈不建議**。 |
| `MAX_PER_RECIPIENT` | `500` | 每位收件人的離線留言上限。 |

### 3.4 開對外網域

- 服務 → Networking（網路）→ 產生公開網域，會拿到 `你的服務.zeabur.app`。
- 想要正式網址可綁**自訂網域**（例如 `relay.你的網域`）——Zeabur 會自動配 TLS。
- 你的中繼站位址就是把 `https` 換成 `wss`：**`wss://你的服務.zeabur.app`**。

### 3.5 驗證

- 瀏覽器開 `https://你的服務.zeabur.app/` 應看到純文字 **`Cinderous relay`**（這也是健康檢查會打的端點）。
- 進一步可用 `wscat -c wss://你的服務.zeabur.app`，連上會收到一則 `["AUTH", "<challenge>"]`（NIP-42 挑戰）＝一切正常。

---

## 4. 在 Cinderous 用你的節點

拿到 `wss://你的服務.zeabur.app` 後，兩種用法：

1. **只有自己/小圈子用**：登入 Cinderous 時把中繼站網址改成你的（登入欄預設已填官方站，改掉即可）。你分享的 ID 會自動變成 `npub…@wss://你的服務.zeabur.app`，好友一加就連到你的節點。
2. **想當作 App 的預設中繼站**（讓新使用者自動連你的）：把它填進 `apps/desktop/src/bootstrap-config.ts` 的 `ANCHOR_RELAYS`（見 `docs/OPERATOR-TODO.md §A`）。建議至少兩座不同平台的錨點以避免單點故障（ADR-0039）。

> 好友在別座 relay 也沒關係——Cinderous 的多中繼路由（ADR-0034）會各自連對方 relay 送收，你的節點只是其中一座。

---

## 5. 成本與注意事項

- **喚醒/常駐**：Zeabur 依方案可能有休眠策略。中繼站要「隨時收得到離線留言」最好保持常駐——確認你的方案不會讓它睡死（睡著時離線留言雖仍靠客戶端重試，但即時性下降）。
- **容量**：不再受 Cloudflare 免費層的請求/duration 限制，改為受你 Zeabur 方案的資源額度約束。心跳量級估算見 `docs/adr/0006`。
- **隱私**：自架＝訊息路徑不經第三方雲端。中繼站全程只見密文，看不到內容與社交圖譜。

---

## 6. 與其他部署方式的差異

| | Cloudflare（worker.ts） | 樹莓派（node-relay） | **Zeabur（node-relay）** |
| --- | --- | --- | --- |
| 核心 | 同一套 `RelayCore` | 同一套 `RelayCore` | 同一套 `RelayCore` |
| 持久層 | DO 內建 SQLite | Node `node:sqlite` 檔 | Node `node:sqlite` + Volume |
| TLS / `wss://` | Cloudflare 自動 | 要自己弄（cloudflared/Caddy） | **Zeabur 自動** |
| 對外網域 | `*.workers.dev` | 要自己弄動態 DNS | **`*.zeabur.app` + 可綁自訂網域** |
| 免開埠 | ✅ | ❌（家用網路要開埠/打洞） | ✅ |
| 額度限制 | 免費層 10 萬請求/duration | 無（只花電費） | 依 Zeabur 方案 |

---

> **一句話**：Zeabur 幾乎把「自架的麻煩」（憑證、網域、開埠）全包了，附的 `relay/Dockerfile` 直接可部署——你只要掛個 Volume、開個網域，就有一座自己的 `wss://` 中繼站。
