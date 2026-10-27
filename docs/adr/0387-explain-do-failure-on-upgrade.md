# ADR-0387：Durable Object 起不來時說明原因（額度用完／暫時無法使用，1013 關閉）

- 狀態：已接受（2026-10-19，使用者「好，附上原因」）
- 對應：ADR-0368（拒絕連線時說明原因）；SDK ADR 0097（同一件事在 SDK 中繼，逐字相同）

## 背景
2026-10-19 錨點 1 的 Durable Objects 免費每日寫入額度用光，整座中繼（根路徑、`/app/cindersync`、`/app/dochost`）的 WebSocket 升級都回 500（1101）。原因是 Worker 的 `return stub.fetch(request)` 沒有接住錯誤，客戶端分不出原因，也沒辦法說明。

## 決策
1. 接住 `stub.fetch` 的錯誤，或沒有 WebSocket 的 5xx 回應；照 ADR-0368 的做法「接受、送 NOTICE、關閉」，但關閉碼改用 1013 Try Again Later。
2. 錯誤訊息含 `exceeded allowed rows written／read`、`free tier`、`quota` 的，NOTICE 寫 `over quota:`，說明約在 00:00 UTC 恢復、先改用別座中繼；其餘寫 `temporarily unavailable:`。兩種都不附開發者文件。
3. 內部錯誤訊息只寫進日誌，不回給客戶端。

## 後果
- ＋ 額度用完時，客戶端拿得到原因與恢復時間，可以馬上換別座。
- － 判斷靠 Cloudflare 的錯誤訊息文字；文字改了就會落到「暫時無法使用」。
- 要部署到錨點才生效（部署要使用者同意）。
- 驗證：`relay/src/worker.test.ts`〈DO 起不來時說明原因〉。
