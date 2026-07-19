> 🌐 **English** · [English version](./self-hosting-web-app.en.md)

# 自架 Cinderous 網頁版（瀏覽器 app，與官網分子網域）

把 Cinderous 的**瀏覽器版**部署到你自己的網域：官網放一個「登入」入口，點了跳到 app 子網域，之後整個
以瀏覽器為介面運行，**金鑰與身分都存使用者本機**（加密）。核心通訊體驗與桌面版相同——因為跑的是**同
一份** React＋`@cinderous/engine`，只是 `isTauri()` 偵測為 `false` 時走瀏覽器路徑。

> **先記住一件事（安全邊界）**：對端到端加密的 client-side app 而言，**送出 JS 的伺服器等於握有金鑰**。
> 所以本指南堅持兩件事：**app 與官網放不同 origin（子網域）**、**app origin 全程 HTTPS＋嚴格 CSP**。
> 依據見 `docs/adr/0147-self-hosted-web-app-separate-origin.md` 與 `0090`。

---

## 1. 運作原理

```
使用者 ──HTTPS──▶ www.example.com（官網，純靜態、零追蹤）
                     │ 「登入」= 一條跨 origin 連結
                     ▼
使用者 ──HTTPS──▶ app.example.com（瀏覽器版 app＝apps/desktop 的 web build）
                     │
                     └──wss://──▶ 你的（或預設）relay，只轉發密文
```

- **官網**與 **app** 是**不同子網域（origin）**：官網被入侵也替換不了 app 的 JS（金鑰在 app origin 的
  記憶體裡）。官網的「登入」只是一個 `<a href="https://app.example.com/">`。
- **金鑰存本機**：瀏覽器模式下 nsec 以 Argon2id 本地密碼包裹存 `localStorage`（明文絕不落盤，ADR-0112），
  本地密碼**必填**（ADR-0122）。relay 只轉發密文，看不到明文或私鑰。

---

## 2. 前置

- 一個你能設 DNS 的網域（下例用 `example.com`）。
- 任一**靜態託管**（Cloudflare Pages / Netlify / Vercel / GitHub Pages / nginx …），能綁自訂子網域並提供
  HTTPS，且**能設回應標頭（CSP）**。
- 一座 relay：用預設的 `wss://cinder-relay.cinderous1.workers.dev`，或自架（見
  `docs/self-hosting-zeabur.md` / `self-hosting-raspberry-pi.md`）。

---

## 3. 建置瀏覽器版

在 repo 根目錄：

```bash
pnpm install
pnpm --filter @cinderous/desktop build
```

產物在 **`apps/desktop/dist/`**（`index.html` ＋ 指紋化的 JS/CSS）。`index.html` 就是**產品入口＝登入畫面**。
（`dist/` 內也會有 `demo.html`／`webrtc.html`，部署產品時可忽略或不對外連結。）

---

## 4. 指定要連的 relay（自架 relay 才需要）

預設站來自 `@cinderous/engine` 的 `ANCHOR_RELAYS`。要把使用者導向**你自己的** relay，三選一（不需改核心邏輯）：

1. **官網登入連結帶參數**（最省事）：`https://app.example.com/?relay=wss://relay.example.com`
   ——`?relay=` 優先於本地記憶，使用者一進來就連你的站。
2. **建置前改預設**：編輯 `@cinderous/engine` 的 `ANCHOR_RELAYS` 再 build。
3. **讓使用者自己填**：登入畫面的「使用其他中繼站」。

---

## 5. 部署到 app 子網域（HTTPS）

把 `apps/desktop/dist/` 發佈到 **`app.example.com`**（與官網 `www.example.com` **分開**）。各家靜態託管作法
不同，共通點：**建置輸出目錄指向 `apps/desktop/dist`**、**綁 `app.example.com` 並開 HTTPS**。

### 建議的 CSP（在 app origin 上設回應標頭）

只允許自己的資源與你的 relay，禁掉第三方腳本，縮小「被塞惡意 JS」的面：

```
Content-Security-Policy:
  default-src 'self';
  connect-src 'self' wss://relay.example.com;
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  base-uri 'none';
  object-src 'none';
  frame-ancestors 'none'
```

- `connect-src` 填**你實際要連的 relay**（自架就填自架網址；用預設站就填
  `wss://cinder-relay.cinderous1.workers.dev`）。若允許使用者自填任意 relay，需放寬 `connect-src wss:`
  ——**取捨**：彈性換來較大的連線面，自架情境建議釘死自己的 relay。
- WebRTC 通話走 P2P，不需在 `connect-src` 額外開（瀏覽器 RTC 不受 `connect-src` 限制）；如需 TURN，另按你的 TURN 設定調整。

### 各家託管商的實際設定

三家常見靜態託管的具體設定。共通點：monorepo 用 pnpm workspace，**建置根目錄保持 repo 根**（需要根
lockfile 與 `packages/*`）、**輸出目錄 `apps/desktop/dist`**。下面 CSP 裡的 `wss://relay.example.com`
**換成你實際的 relay**。

> **pnpm 版本別重複指定**：三家都會用 corepack 依 `package.json` 的 `packageManager`（`pnpm@10.33.0`）
> 自動裝對版本——**不要**再在平台設定裡另填 pnpm 版本，否則「指定了多個 pnpm 版本」會卡在安裝階段
> （與本專案 CI 踩過的坑同一個）。

以下 `_headers`／`netlify.toml`／`vercel.json` 都是**部署專屬**（內含你的 relay 網址）——放在**你自己的
fork／部署**，不要 PR 回共用 repo（共用 repo 保持與 relay 網域無關）。

**Cloudflare Pages**
- 連結 repo → Framework preset 選 **None**。
- Build command：`pnpm --filter @cinderous/desktop build`（CF 會自動先 install）
- Build output directory：`apps/desktop/dist`；Root directory：repo 根（`/`）。
- CSP：在你的 fork 放 `apps/desktop/public/_headers`（Vite 會複製進 `dist`；無 `public/` 就新建）：
  ```
  /*
    Content-Security-Policy: default-src 'self'; connect-src 'self' wss://relay.example.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'
  ```
- 自訂網域：加 `app.example.com`。

**Netlify**
- 在你的 fork 放 repo 根 `netlify.toml`：
  ```toml
  [build]
    command = "pnpm --filter @cinderous/desktop build"
    publish = "apps/desktop/dist"

  [[headers]]
    for = "/*"
    [headers.values]
      Content-Security-Policy = "default-src 'self'; connect-src 'self' wss://relay.example.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
  ```
- 自訂網域：Domain settings 加 `app.example.com`。

**Vercel**
- 專案設定：Framework Preset **Other**、Build Command `pnpm --filter @cinderous/desktop build`、
  Output Directory `apps/desktop/dist`、Install Command `pnpm install`。
- 在你的 fork 放 repo 根 `vercel.json`：
  ```json
  {
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          { "key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' wss://relay.example.com; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" }
        ]
      }
    ]
  }
  ```
- 自訂網域：Project → Domains 加 `app.example.com`。

**Zeabur（Docker，可與 relay 同平台；ADR-0207）**
- repo 已附 **`apps/desktop/Dockerfile`**（Node 建置 → Caddy 靜態伺服，**已內建嚴格 CSP 真標頭**，含 `frame-ancestors`——這是 GitHub Pages 做不到、而 Caddy 做得到的關鍵）。
- Zeabur → 專案 → Add Service → **Deploy from GitHub** → 選這個 repo；建置方式 **Dockerfile**：
  - **Dockerfile 路徑**：`apps/desktop/Dockerfile`
  - **根目錄（Root）**：保持 **repo 根**（`/`）——不可設 `apps/desktop/`（pnpm workspace 需根 lockfile 與 `packages/*`）。
- **環境變數**：`PORT` 由 Zeabur 自動注入（不用設）。可選 `CSP_CONNECT=wss://relay.你的網域` 把 CSP 的 `connect-src` **鎖死到你的 relay**（不設＝預設允許任意 `wss:`，配合「使用者可自選 relay」）。
- **子網域**：Networking → 綁自訂網域 `app.你的網域`，Zeabur 自動配 TLS → 使用者開 `https://app.你的網域` 就是登入畫面。
- 這樣 **relay（`relay/Dockerfile`）與 web app（`apps/desktop/Dockerfile`）可放同一個 Zeabur 專案的兩個服務**，各自綁 `relay.你的網域` / `app.你的網域`。

---

## 6. 官網那一側

官網就是一般靜態站（可直接用 `apps/website`，或你自己的）。**唯一要做的**是放一個指向 app 的連結：

```html
<a href="https://app.example.com/?relay=wss://relay.example.com">登入 / 開始使用</a>
```

**不要**在官網 origin 內嵌 iframe 載入 app、也不要把 app 建置塞進官網同一個 origin——那會讓官網的攻擊面
接觸到金鑰邊界（正是 ADR-0090／0147 要避免的）。

---

## 7. 一定要告訴使用者的兩件事

1. **本地密碼必填、且請備份 nsec**：瀏覽器沒有 OS 金鑰庫。使用者「清除網站資料」或瀏覽器儲存驅逐會
   **清掉本機（加密）身分**——只有先在「設定 → 身分備份」抄下 **nsec／加密備份碼** 才救得回。
2. **這是網頁交付的 E2E app**：每次載入都信任 `app.example.com` 送出的 JS。要更強保證（簽章二進位＋OS
   金鑰庫）請引導改用**桌面原生版**。

---

## 8. 驗收清單

- [ ] `app.example.com` 與官網 `www.example.com` 是**不同 origin**。
- [ ] app origin **HTTPS**、且設了**嚴格 CSP**（`connect-src` 只含你的 relay）。
- [ ] 打開 `app.example.com` 出現登入畫面，能建立身分並連上 relay（DevTools → Network 看到 `wss://` 已連）。
- [ ] 建一個身分、重整頁面 → 走**解鎖畫面**（證明本地密碼包裹生效、金鑰存本機）。
- [ ] 官網「登入」連結跳到 app 子網域（若帶 `?relay=` 則自動連對站）。
- [ ] 使用手冊/首次畫面提醒使用者**備份 nsec**。
