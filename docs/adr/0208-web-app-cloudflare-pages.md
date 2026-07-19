# 0208. 瀏覽器版 web app 走 Cloudflare Pages：repo 內建 `_headers`＋`_redirects`

- 狀態：已接受
- 日期：2026-07-19
- 相關文件：`apps/desktop/public/_headers`、`apps/desktop/public/_redirects`、`docs/self-hosting-web-app.md`、ADR-0090（金鑰邊界）、ADR-0147（web app 獨立 origin＋CSP）、ADR-0207（web app 容器化）

## 背景與問題

要把瀏覽器版部署到 **Cloudflare Pages**（純靜態）。對已把網域放 Cloudflare 的部署者最省事：**原生綁子網域、自動 HTTPS、免手動 CNAME**。但需要：(1) 嚴格 CSP 真標頭（ADR-0090/0147）；(2) 單頁 fallback。原本 `docs/self-hosting-web-app.md` 只教「把 `_headers` 放你自己的 fork」，repo 內沒有現成檔。

## 決策

repo 內建 Cloudflare Pages 兩個慣例檔（Vite `public/` 會複製進 `dist/`）：

- **`apps/desktop/public/_headers`**：`Content-Security-Policy`（`default-src 'self'`、`frame-ancestors 'none'`、`object-src 'none'`…）＋ `X-Content-Type-Options: nosniff` ＋ `Referrer-Policy: no-referrer`。Pages `_headers` 是**真標頭**（含 `frame-ancestors`，GitHub Pages 的 `<meta>` 做不到）。
- **`apps/desktop/public/_redirects`**：`/* /index.html 200`（SPA fallback；實體檔優先，故指紋化資產與 `demo.html`/`webrtc.html` 仍直接命中）。

**`connect-src` 用通用的 `'self' wss:`**（允許任意安全 WebSocket）：因為 repo 是共用的、不綁特定 relay（沿用 self-hosting doc「部署專屬 relay 網址不進共用 repo」原則），且客戶端本就可自選 relay。要**鎖死到單一 relay** 的部署者，在自己的部署把 `connect-src` 改成 `'self' wss://relay.你的網域`（Pages `_headers` 為靜態、無環境變數插值；與 ADR-0207 Caddy 版的 `{$CSP_CONNECT}` 差異點）。

> 註：`_headers`/`_redirects` 也會被 Vite 複製進桌面 Tauri 的 `dist`（隨 `generate_context!` 內嵌），Tauri 不讀取＝無害的極小檔。

## 理由

- 網域已在 Cloudflare → Pages 原生綁 `cinderous.propfolk.com`、自動 TLS、免手動 CNAME/灰橘雲取捨。
- Pages `_headers` 真標頭滿足 ADR-0090/0147 的嚴格 CSP。
- 通用 `wss:` 保持 repo 與 relay 無關；要嚴格者自行收斂 `connect-src`。

## 後果

- 正面：一鍵 git-connect Cloudflare Pages 即可部署帶 CSP 的瀏覽器版；與 ADR-0207 的 Zeabur/Docker 並存為兩條可選路。
- 中性 / 已知殘餘：
  - 預設 `connect-src wss:` 較寬；最嚴格請把它收斂到自己的 relay（需在部署處改 `_headers`，Pages 無 env 插值）。
  - **信任邊界**：Cloudflare Pages 交付客戶端 JS → CF 在「程式碼交付」信任路徑內（與 ADR-0207 Zeabur+灰雲「CF 只做 DNS」相對）；對已信任 CF（DNS/relay 在其上）者不增加信任方。最強保證仍是桌面原生版。
  - 只加靜態設定檔，不改 app 邏輯。
- 後續：`self-hosting-web-app.md` 的 Cloudflare Pages 段更新為「repo 已內建 `_headers`/`_redirects`」。
