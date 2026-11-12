# 0419. 桌面版 CSP 的 connect-src 加 http:——ws:// 中繼的 NIP-11 探測才通

- 狀態：**已接受（Accepted，2026-11-12）**——使用者 2026-11-12 要求修掉 ADR-0417 實測時順帶發現的問題
- 日期：2026-11-12
- 相關文件：0235 C4（Tauri CSP）、0401（連不上時探測 NIP-11，`connect-src` 因此加 `https:`）、0417（嚴格 `style-src`；本問題在它的實測中發現）；SDK ADR 0125

## 背景與問題

桌面版連 `ws://` 的中繼（本機開發站、區網自架站），NIP-11 的抓取改走 `http://`：

- 連不上時分辨「額度用完」與「斷網」的探測（ADR-0401／SDK ADR 0125）。
- 設定裡的贊助卡（`fetchRelayInfo`）。

桌面 CSP 的 `connect-src` 放行 `ws:` 卻沒有 `http:`，這兩個請求都被擋下，只在 console 留錯誤。ADR-0417 用 `app.cinder.qa` 實測時看到。

## 考量的選項

1. **`connect-src` 加 `http:`**（採用）。
2. 只放行 `http://localhost:*`、`http://127.0.0.1:*`：區網自架站（`ws://192.168.…`）仍被擋，CSP 也寫不出「私有網段」這種範圍。
3. NIP-11 改由 Rust IPC 代抓：多一條原生指令與它的權限檢查，只為了繞過自己的 CSP。
4. `ws://` 中繼不探測：連不上時一律當成斷網，額度用完的提示對自架站失效。

## 決定

- 桌面 `tauri.conf.json` 的 `csp` 與 `devCsp` 的 `connect-src` 都加 `http:`。
- 網頁版（`_headers`、Caddyfile）不動：網頁版只放行 `wss:`，`ws://` 中繼本來就連不上（https 頁面也不准混用），沒有這個問題。
- `tauri-csp.test.ts` 釘住：桌面 `connect-src` 同時有 `ws:` 與 `http:`。

## 理由

- `connect-src` 已經放行 `ws:` 到任何主機，任何注入的腳本本來就能用明文 WebSocket 把資料送出去。加 `http:` 沒有多開外洩管道。
- CSP 在桌面防的是「載入並執行外來程式碼」，那由 `script-src 'self'` 負責，與 `connect-src` 無關。
- `img-src` 仍不放行遠端主機（遠端圖片＝追蹤信標，既有測試照舊）。

## 後果

- `ws://` 中繼連不上時，探測結果正確（額度用完會顯示對的提示）；贊助卡也抓得到。
- 殘餘：`connect-src` 對明文連線本來就寬；收緊要連 `ws:` 一起處理，那會讓區網自架站不能用，不在本 ADR 範圍。
