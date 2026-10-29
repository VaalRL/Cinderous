# 0401. 連線列說得出「主機有回應、回答的卻不是中繼」

- 狀態：已接受（使用者 2026-10-29：「1」——做在 SDK 的 RelayPool，Cinderous 升版接上並加文案）
- 日期：2026-10-29
- 相關文件：SDK ADR 0125（邊緣代答探測）、ADR-0395（客戶端看懂 1013）、ADR-0398／0400（連線改由 SDK 負責、轉接層在 core `connectRelay`）、ADR-0394（錨點 2 的背景流量）、ADR-0235 C4（Tauri CSP 防回歸）、ADR-0207／0208（網頁版 CSP）

## 背景與問題

ADR-0395 讓客戶端看懂中繼的 1013：中繼自己的額度用完時，先送 NOTICE、再以 1013 關閉，連線列說「額度用完了，約 08:00 恢復」。

但 Cloudflare **Workers 免費方案的每日請求數**（10 萬次）用完時，邊緣直接回 Error 1027，Worker 根本沒執行，NOTICE 與 1013 都送不出來。瀏覽器的 WebSocket 只看到 1006，跟網路斷了一樣：

- 使用者整天看到「已斷線，重連中…」，以為是自己的網路；
- 每 10 秒重連一次，打一整天。

錨點 2 一天約有 4.6 萬次背景請求（ADR-0394），這不是假想的情況。這是設計缺口清單的第 3 項。

## 決策

### 1. 判斷交給 SDK（v0.84.0，SDK ADR 0125）

連續兩次還沒連上就斷時，SDK 的 `RelayPool` 對中繼的 NIP-11 抓兩次：

- 一般請求失敗、`no-cors` 請求成功 ⇒ 主機有回應，卻沒有中繼一定會帶的 CORS 標頭 ⇒ 回答的不是中繼；
- 兩次都失敗 ⇒ 真的連不上。

判定是邊緣代答時，SDK 照 1013 處理：回報 `onRelayReject`（`source: 'probe'`、`token: 'edge'`）、整座標成 5 分鐘不能用、重連等到那時。每座最多 5 分鐘探測一次。

### 2. core `connectRelay` 轉給 UI

- `RelayUnavailable.kind` 新增 `edge`，`resetsAt` 是下一個 00:00 UTC（與 `over-quota` 同一個重置時間），`retryAt` 是 SDK 健康標記的到期時間。
- 探測在斷線**之後**才回來，那時離線早就報過了，所以帶著原因**再報一次** `offline`。已經上線或連線已關閉時 SDK 不會回報（SDK ADR 0125），轉接層不另外守。

### 3. 文案：只說「最可能」

Worker 當掉（1101）、公司的攔截代理也是「主機有回應、回答的不是中繼」，所以不能說死。

- 中文：「已斷線：中繼站的主機有回應，但中繼站沒有。最可能是今天的額度用完了，約 {time} 恢復」
- 英文：「Disconnected: the relay's host answered, but the relay didn't. Most likely it has used up today's quota; it should be back around {time}.」

桌面與手機共用 `@cinderous/i18n` 的 `connectionBannerText`，一處改兩邊都有。

### 4. CSP 的 `connect-src` 加上 `https:`

探測是對中繼網址的 `https://` 送請求。桌面版的 Tauri CSP 與網頁版（Pages 的 `_headers`、自架的 Caddyfile）原本只放行 `wss:`，請求會被 CSP 擋下。擋下時兩次都失敗，結果是「連不上」：不會誤判，但這個功能在桌面與網頁版上等於沒有。

加上 `https:` 的理由：

- `connect-src` 本來就放行**任意主機**的 `wss:`（使用者可以自選中繼）。萬一 webview 有 XSS，攻擊者早就能用 `wss://` 把資料送出去，多一個 `https:` 沒有多開一條外流的路。
- 中繼是使用者自選的，CSP 沒辦法只列那幾座。

其餘指令（`img-src` 不放行遠端、`script-src` 不放行 inline 等）不變。手機（Capacitor）沒有設 CSP，不受影響。

自架的部署者若用 `CSP_CONNECT` 鎖死自己的中繼，要寫成 `"wss://relay.你的網域 https://relay.你的網域"`（`docs/self-hosting-web-app.md` 已改）。

## 後果

- 正面：
  - 每日請求數用完時，連線列第一次說得出原因，不再跟斷網混在一起。
  - 用完的那段時間，重連從每 10 秒一次降到每 5 分鐘一次（省下來的也是那座主機的請求數）。
- 負面／殘餘：
  - **沒看過真正的 1027 回應**。要看到就得把一座錨點的當日額度燒光，所以沒做（SDK ADR 0125 有模擬驗證）。
  - 每 5 分鐘重試一次又失敗時，SDK 先報一次沒有原因的離線，探測回來（約兩個請求的時間）才再帶原因。這段時間連線列會短暫變回「已斷線，重連中…」。
  - 網路真的斷了也會多花兩個 HTTP 請求（每 5 分鐘最多一次）。
  - 桌面與網頁版的 `connect-src` 變寬了一點（見決策 4 的理由）。
- 驗證：
  - `ws-connector.test.ts` 新增 3 個：邊緣代答（再報一次離線、帶 `edge`、恢復時間、5 分鐘後才重連）；真的斷網（不帶原因）；`close()` 之後探測才回來（不回報）。引擎測試的全域 `fetch` 預設改成「像斷網」，不碰真的網路。
  - `connection.test.ts` 新增文案測試（中英文、重試中也繼續說原因）。
  - `tauri-csp.test.ts` 新增 2 個：Tauri 的 `csp`／`devCsp`、網頁版的 `_headers`／Caddyfile 的 `connect-src` 都含 `https:`。
  - 破壞測試 8 項抓到 7 項。沒抓到的是轉接層自己的「已關閉／已上線就不報」守衛：SDK 在連線池關閉或連線已開時本來就不回報探測結果，那行是多餘的，已拿掉；`close()` 的測試留著，當作 SDK 這個承諾的契約。
