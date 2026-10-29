# 0395. 客戶端看懂「中繼暫時不能用」：1013 不算上線、5 分鐘後再試、連線列說出原因與恢復時間

- 狀態：已接受（使用者 2026-10-29：「好 開始」）
- 日期：2026-10-29
- 相關文件：ADR-0387（中繼端：DO 起不來時以 NOTICE＋1013 說明原因）、ADR-0368（拒絕的形狀：接受升級→NOTICE→關閉）、ADR-0391（主平面反覆重連限速）、ADR-0069（home 死亡 24 小時後搬家）、ADR-0039／0378（主路由離線時的有界冗餘）、ADR-0169（行動端連線細條）；SDK ADR 0097、0108（`RelayPool` 的同一套處理）

## 背景與問題

Cloudflare 的免費額度用完時，錨點中繼（SDK v0.77.8，ADR-0387）照 ADR-0368 的形狀拒絕連線：先**接受**升級，送 `NOTICE "over quota: … resets around 00:00 UTC …"`，再以 **1013 `over quota`** 關閉。中繼把原因說清楚了，聊天 App 卻完全看不到：

1. **原因被丟掉。** `RelayClient` 有 `onNotice`，引擎從來沒接；`webSocketConnector` 的 `close` 也不看關閉碼。畫面只有「已斷線，重連中…」。
2. **每秒重連一次。** 連線先觸發 `open`，舊版在 `open` 就報上線並把退避歸零，所以每次被關都從 1 秒重來，永遠退不到 15 秒。ADR-0391 假設「正常用戶端被擋一次就會慢下來」，那是 SDK `RelayPool` 的行為，聊天 App 的 connector 沒有，正是 0391 要擋的「不退避的用戶端」。
3. **畫面閃、副作用重跑。** 每次假上線都會重新訂閱、送心跳、補送外送匣，連線列在上線和斷線之間閃。
4. **搬家與冗餘失效。** 每次 online 都清掉 `offlineSince`，所以 ADR-0069「home 死亡 24 小時後搬家」的計時永遠到不了；`publishAddressed` 看到主路由是 online，也就不會走 ADR-0039 的冗餘座。

## 考量的選項

- 選項 A：聊天 App 改用 SDK 的 `RelayPool`。它已經處理好 1013（SDK ADR 0108），但引擎的連線、認證、分片、外送匣全建在 `RelayConnector` 介面上，換掉是另一個大工程。
- 選項 B：在 `webSocketConnector` 補上同一套規則，分類沿用 SDK 的 `classifyRelayClose`（唯一來源），冷卻時間與 SDK 相同。
- 選項 C：只解析 NOTICE 文字顯示原因、不改重連。每秒重連與搬家失效的問題還在。

## 決策

採選項 B。

1. **什麼時候算上線**（`webSocketConnector`）：
   - `open` 之後，中繼送來第一則**非 NOTICE** 的訊息（我們的中繼要求認證，會先送 AUTH 挑戰），或者連上 1 秒沒被關，才報 `online`。拒絕連線時中繼只送 NOTICE 就關，所以不會被當成上線。
   - 退避只有在真的上線之後才歸零。
2. **1013＝這座暫時不能用**：
   - 分類用 SDK 的 `classifyRelayClose`（`@cinderous/core` 轉出），1013 一律是 `unavailable`。
   - 等 `max(一般退避, 5 分鐘)` 才重連，與 SDK `RelayPool` 的 `unavailableMs` 相同（SDK ADR 0108）。不解析 NOTICE 裡的恢復時間，理由同 SDK ADR 0108。
   - `onStatus("offline", unavailable)` 帶出原因：關閉原因開頭是 `over quota` 時為 `over-quota`，`resetsAt` 是下一個 00:00 UTC；其他（`temporarily unavailable`、連線數滿了、反覆重連被擋）都是 `unavailable`。兩者都帶 `retryAt`。
3. **引擎**：`ChatBackendEvents.onConnection(state, unavailable?)` 把原因交給 UI（選用參數，舊的處理程式不受影響）。
4. **UI**（桌面連線列、行動端細條）：文案判斷放在 `@cinderous/i18n` 的 `connectionBannerText`，兩端共用：
   - 額度用完：「已斷線：中繼站今天的額度用完了，約 08:00 恢復」（裝置當地時間）；
   - 其他：「已斷線：中繼站暫時不能用，約 11:05 重試」。
   - 原因的保存用 `nextRelayUnavailable` 判斷：5 分鐘一次的重試（`connecting`）期間沿用原因，真的上線、一般斷線、換身分才清掉。
   - 文案**不宣稱**「訊息已改走其他中繼」：單座中繼模式（自架、企業）沒有冗餘座。

## 理由

- 修的是根因：問題不在少一句文案，而在 connector 把「接受→關閉」當成上線。修好之後，離線狀態是穩定的，既有的冗餘（ADR-0039）與搬家（ADR-0069）自然恢復作用。
- 分類與冷卻時間沿用 SDK，與四款遊戲和 Obsidian 外掛的行為一致，不另立一套。
- 1 秒的等待只發生在完全不開口的第三方中繼；我們的中繼連上就送 AUTH 挑戰，上線時間不變。

## 後果

- 正面：
  - 額度用完時，每個用戶端從每秒一次降到每 5 分鐘一次，也不再吃掉恢復後的額度。
  - 使用者看得到原因與恢復時間。
  - 主路由離線時的冗餘與 24 小時搬家照設計運作。
- 負面 / 已知殘餘風險：
  - 額度恢復後最多晚 5 分鐘才連回。
  - Workers 每日請求數用完時，Cloudflare 在邊緣直接回錯誤，Worker 根本沒執行，送不出 NOTICE 與 1013。客戶端只看得到連不上，照一般退避重試，畫面仍是「已斷線，重連中…」。
  - 不開口的第三方中繼，上線要晚 1 秒。
  - 判斷 `over quota` 靠中繼的關閉原因文字（ADR-0387）。改了就退回 `unavailable`，仍是正確的退路。
- 後續行動 / 待辦：
  - 設定頁的中繼清單（`onRelayPool`）還沒有帶原因，目前只有 🔴。
  - 還沒在真的錨點額度用完時實測。
- 驗證：
  - `packages/engine/src/backend/ws-connector.test.ts`（9 個）：
    - 「接受→NOTICE→1013」不算上線、帶原因與恢復時間、5 分鐘後才重連，再被關還是 5 分鐘；
    - 1013 其他原因；
    - 恢復後正常上線；
    - 開口即上線、安靜 1 秒算上線；
    - 退避只在上線後歸零；
    - 引擎把原因交給 `onConnection`。
  - `packages/i18n/src/connection.test.ts`：文案與原因的保存。
  - `apps/mobile/src/use-self-session.test.tsx`：行動端撐過重試、上線與換身分清掉。
  - 破壞測試三項，各有測試失敗：
    - 引擎不傳原因；
    - 在 `open` 就把退避歸零；
    - NOTICE 也算上線。
