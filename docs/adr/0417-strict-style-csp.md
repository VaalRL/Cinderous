# 0417. CSP 的 style-src 拿掉 'unsafe-inline'（桌面版與網頁版）

- 狀態：已接受
- 日期：2026-11-12
- 相關文件：ADR-0235 C4（Tauri CSP）、ADR-0147（自架網頁版要嚴格 CSP）、ADR-0207（Caddyfile）、ADR-0208（Pages `_headers`）、
  ADR-0060（當初把「嚴格 CSP」列為另做）；ROADMAP「此環境可選打磨：嚴格 CSP」

## 背景與問題

ADR-0235 C4 已經讓桌面版有完整 CSP：`script-src 'self'`（無 inline、無 eval）、`img-src` 不放行遠端、
`object-src`／`base-uri`／`frame-ancestors` 收斂。剩下一個缺口是 `style-src 'self' 'unsafe-inline'`，
網頁版的 `_headers` 與 Caddyfile 也一樣。

放行 inline 樣式的風險：只要有一處能把攻擊者的字串當 HTML 插進畫面，就能塞 `<style>`，用屬性選擇器
加背景圖把畫面上的內容一個字一個字送出去（CSS 外洩）。`img-src` 不放行遠端已經擋掉大部分送出管道，但
`'unsafe-inline'` 本身沒有存在的理由，就不該留著。

ROADMAP 當初寫「需 tauri:dev 逐項驗」：怕某個畫面靠 inline 樣式，拿掉後版面壞掉卻沒有測試抓得到。

## 考量的選項

- 選項 A：維持現狀。
- 選項 B：改用 `'unsafe-hashes'`＋逐一列 hash。只有在真的有 inline style 屬性時才需要，徒增維護。
- 選項 C：直接改成 `style-src 'self'`，先實機走過主要畫面確認沒有違規。

## 決策

採選項 C，桌面版的 `csp`、網頁版的 `_headers` 與 Caddyfile 一起改。`devCsp` 不動：Vite 開發伺服器用 `<style>` 注入 CSS（HMR）。

### 為什麼不會壞

- React 的 `style={...}` 在瀏覽器端是經 CSSOM（`element.style`）設定，CSP 不管；被擋的只有 HTML 裡的 `style` 屬性、
  `setAttribute("style", …)` 與 `<style>` 標籤。
- 出貨程式碼掃過：沒有 `setAttribute("style")`、沒有 `<style>`、沒有 `dangerouslySetInnerHTML`；唯一的 `innerHTML` 在 `src/demo/`（展示頁）。
  `demo.html`、`webrtc.html` 兩個測試頁有 `<style>`，網頁版部署時這兩頁會沒有樣式，不影響 App。
- Vite 正式建置的 CSS 都是 `<link>` 外部檔。

### 實機驗證（2026-11-12）

- **桌面版**：用 `app.cinder.qa` 識別碼建了套用新 CSP 的 debug 版（`tauri build --debug --no-bundle`），以 WebView2 除錯埠：
  - 探針確認新 CSP 生效：`setAttribute("style")` 與 `<style>` 被擋、`element.style` 正常。
  - 走過登入、建立身分、設定六個分頁（展開所有 `<details>`）、加好友、對話視窗的搜尋／標籤／表情／貼圖／震動／相簿／格式、
    主畫面的主題、QR、狀態、音樂、建立群組、語言：**`style-src` 違規 0 筆**，截圖版面正常。
  - 測試身分指向不存在的本機中繼，沒有連官方錨點；結束後刪了 QA 資料夾與該測試身分的金鑰庫條目。
- **網頁版**：`vite build` 的 `dist` 由一個套用 `_headers` CSP 標頭的小伺服器提供，Edge headless 走同一套流程（含設定本機密碼）：違規 0 筆。

## 後果

- 正面：CSS 注入不再是一條可用的外洩路線；`tauri-csp.test.ts` 加了兩條防回歸（桌面 `csp`、網頁版兩份標頭的 `style-src` 必須正好是 `'self'`）。
- 負面 / 已知殘餘風險：
  - 之後若有人寫了 inline `style` 屬性或 `<style>`，畫面會靜悄悄地少了樣式（瀏覽器只在 console 報錯），測試抓不到。
    寫法上一律用 class 或 React 的 `style={}`。
  - 自架者若照舊文件自己寫了含 `'unsafe-inline'` 的標頭，仍然可以用，只是沒有這層保護；文件已改。
- 順帶發現（與本 ADR 無關，未處理）：
  - 用 `ws://` 的本機中繼時，連線前的 NIP-11 探測走 `http://`，被 `connect-src`（只放行 `https:`）擋掉。→ 已由 ADR-0419 修正（桌面 `connect-src` 加 `http:`）。
  - App 內「本版更新內容」把 `releases.json` 的 `**粗體**` 原樣顯示，歷來各版都是如此。→ 2026-11-12 已修：關於頁渲染 `**粗體**` 與 `` `程式碼` ``（`noteSegments`），並補上 0.0.17 英文條目少一個 `**` 的錯字。同一個問題也出現在 28 個 UI 字串（設定提示、確認對話框）：解析搬到 `@cinderous/i18n` 的 `richSegments`，桌面 `RichText`、手機 `rich()` 渲染；原生 confirm、系統通知、手機訊息氣泡用 `stripRich` 拿掉標記。
