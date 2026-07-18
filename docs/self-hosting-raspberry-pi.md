> 🌐 **English** · [English version](./self-hosting-raspberry-pi.en.md)

# 在樹莓派自架 Cinderous 中繼站（node-relay）

在你自己的樹莓派（或任何 Node 22+ 的機器）上跑一個 Cinderous 中繼站。它跑的是**與 Cloudflare 版完全相同的 `RelayCore`**，差別只是外殼換成 Node.js + 本機 SQLite。

> **重點**：自架＝**完全擺脫 Cloudflare 免費層限制**（沒有 10 萬請求/天、沒有 13,000 GB-s duration），成本只有電費（約 2–5W）。中繼站**只轉發密文**，看不到你的明文或私鑰——自架反而隱私更好。

---

## 1. 需求

- 樹莓派（Pi 3 / Pi 4 / Pi Zero 2 皆可；小圈子好友綽綽有餘）或任何 Linux 機器。
- **Node.js 22 以上**（node-relay 用 Node 內建的 `node:sqlite`，需 22+）。
- `pnpm`（`npm i -g pnpm`）。
- 對外可達的方式（見 §5，家用網路的重點）。

安裝 Node 22（Raspberry Pi OS / Debian）：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 應顯示 v22.x 以上
```

---

## 2. 快速開始

```bash
git clone https://github.com/VaalRL/Nostr-buddy.git cinder
cd cinder
pnpm install
# 建置並啟動 node-relay（預設 ws://0.0.0.0:8787、開啟 NIP-42 認證、SQLite 存於 cinder-relay.db）
pnpm --filter @cinderous/relay node-relay
```

看到這行就代表起來了：

```
Cinderous node-relay：ws://0.0.0.0:8787（DB=cinder-relay.db, requireAuth=true）
```

本機自我測試（另開一個終端）：

```bash
# 用 wscat 連連看（npm i -g wscat）；連上後會收到一則 ["AUTH", "<challenge>"]（NIP-42 挑戰）
wscat -c ws://localhost:8787
```

---

## 3. 設定（環境變數）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `8787` | 監聽通訊埠。 |
| `DB_PATH` | `cinder-relay.db` | 離線留言的 SQLite 檔路徑（建議用絕對路徑）。 |
| `REQUIRE_AUTH` | 開啟 | 設 `REQUIRE_AUTH=0` 可關閉 NIP-42 認證（**不建議**——關了任何人都能拉他人的加密收件匣元資料，雲端快照密文（ADR-0071）也會失去「只回作者本人」的閘門，見 ADR-0057）。 |
| `MAX_PER_RECIPIENT` | `500` | 每位收件人的離線留言上限（防塞爆）。 |

範例：

```bash
PORT=9000 DB_PATH=/home/pi/cinder/relay.db pnpm --filter @cinderous/relay node-relay
```

---

## 4. 對外可達（家用網路的重點）

客戶端需要用**加密的 `wss://`** 連你。家用網路在 NAT 後面，有兩條路：

### 方案 A（推薦）：Cloudflare Tunnel — 免開埠、免自弄憑證

`cloudflared` 幫你把本機服務打通到一個公開的 HTTPS/WSS 端點（自帶 TLS）：

```bash
# 安裝 cloudflared（arm64 Pi）
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo install cloudflared /usr/local/bin/

# 快速臨時通道（測試用）：印出一個 https://xxxx.trycloudflare.com
cloudflared tunnel --url http://localhost:8787
```

拿到的網址把 `https` 換成 `wss` 就是你的中繼站位址：`wss://xxxx.trycloudflare.com`。
正式長期用請設**具名通道 + 自己的網域**（`cloudflared tunnel login` → `create` → 綁 DNS），網址會固定。

### 方案 B：通訊埠轉發 + 反向代理上 TLS

1. 路由器把外部埠轉發到 Pi 的 `8787`。
2. 用 Caddy 之類的反向代理自動申請 Let's Encrypt 憑證、把 `wss://relay.你的網域` 代理到 `localhost:8787`：

```
relay.你的網域 {
    reverse_proxy localhost:8787
}
```

（需要一個指向你家 IP 的網域；浮動 IP 可搭配動態 DNS。）

---

## 5. 在 Cinderous 用你的節點

Cinderous 內建多中繼路由（ADR-0034）：你分享的 ID 會帶上 relay 提示 `npub…@wss://…`。

- 登入時把中繼站網址填成你的：`wss://relay.你的網域`（或 trycloudflare 網址）。
- 分享給好友的 ID 就會變成 `npub…@wss://relay.你的網域`，對方一加就會連到你的節點。
- 好友在別座 relay 也沒關係——多中繼路由會各自連對方 relay 送收，你的節點只是其中一座。

---

## 6. 24/7 常駐（systemd）

先建置一次，再用 systemd 常駐（開機自動啟動、當掉自動重啟）：

```bash
pnpm --filter @cinderous/relay build:node-relay   # 產出 relay/dist/node-relay.js
```

`/etc/systemd/system/cinder-relay.service`：

```ini
[Unit]
Description=Cinderous node-relay
After=network-online.target

[Service]
Environment=PORT=8787
Environment=DB_PATH=/home/pi/cinder/relay.db
WorkingDirectory=/home/pi/cinder/relay
ExecStart=/usr/bin/node dist/node-relay.js
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cinder-relay
sudo systemctl status cinder-relay
journalctl -u cinder-relay -f   # 看即時日誌
```

（`cloudflared` 同樣可做成 service 常駐；具名通道用 `cloudflared service install`。）

---

## 7. 與 Cloudflare 版的差異

| | Cloudflare（worker.ts） | 樹莓派（node-relay.ts） |
| --- | --- | --- |
| 核心 | 同一套 `RelayCore` | 同一套 `RelayCore` |
| 持久層 | DO 內建 SQLite | Node `node:sqlite` 檔案 |
| 過期清理 | DO `alarm()` 每小時 | `setInterval` 每小時 |
| 休眠 | Hibernation API 省 duration | 不需要（你自己的硬體，只花電費） |
| 額度 | 免費層 10 萬請求/13,000 GB-s | **無**——受限於你 Pi 的容量 |

---

## 8. 安全與隱私

- 中繼站**只轉發密文**（NIP-59 Gift Wrap）與 Ephemeral 狀態，看不到明文，也不持有任何私鑰。
- 保持 `requireAuth` 開啟：只有本人（能簽自己 pubkey）能拉自己的加密收件匣（ADR-0057）。
- 資料庫 `relay.db` 只有密文與過期時間；仍建議放在你信任的機器、限制檔案權限。

有問題或要把 node-relay 打包成更省事的一鍵安裝，回報給維護者即可。

> **不想弄家用網路的開埠/TLS？** 同一個 node-relay 也能一鍵部署到 Zeabur 這類 PaaS（自動 HTTPS/wss、固定網域、免開埠）——見 [`docs/self-hosting-zeabur.md`](./self-hosting-zeabur.md)。
