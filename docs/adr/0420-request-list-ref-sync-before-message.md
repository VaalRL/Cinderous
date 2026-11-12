# 0420. 陌生人的第一則訊息不再跳通知：請求清單要在 onMessage 之前就更新

- 狀態：已接受
- 日期：2026-11-12
- 相關文件：ADR-0121（訊息請求）、ADR-0116／0410（行動端通知）、ADR-0415（離開期間摘要）

## 背景與問題

2026-11-12 在 Pixel 8a（Android 17）上實測背景通知：App 在背景時，一個從沒聯絡過的人（CLI 拋棄式金鑰）傳來第一則訊息，**通知列跳出了通知**，標題是他的 pubkey 開頭。

ADR-0121 明定訊息請求一律不跳通知。原因是：如果陌生人能推播到你的鎖定畫面，那就是騷擾的管道。

原因是時序：

- 引擎收到陌生人的訊息時，先把他放進請求區、送出 `onRequests`，接著在同一個呼叫堆疊裡送出 `onMessage`。
- 兩端（手機 `AppSession`、桌面 `App`）在 `onMessage` 裡用 `requestsRef.current` 判斷「這是不是請求」，再決定要不要跳通知。桌面另外用它決定要不要算進離開期間摘要（ADR-0415）。
- 但這個 ref 只在 **render** 時從 state 鏡像過來。`onRequests` 只呼叫 `setRequests`，那只是排程一次 render。`onMessage` 執行的當下，ref 還是舊清單，於是第一則陌生訊息被當成聯絡人的訊息。
- 同一個人的第二則起就正常了，因為那時已經 render 過。所以只看「之後收得到、請求區裡有他」的測試抓不到這個問題。

## 考量的選項

- A. 引擎改成在請求區的訊息上加一個標記（例如 `m.request = true`），App 不必再查清單。
  - 改動面大：訊息型別、儲存、補送路徑都要帶。
  - 而且「接受之後，舊訊息算不算請求」又是另一個問題。
- **B. 兩端的 `onRequests` 先同步寫入 `requestsRef.current`，再呼叫 setState。**
  - 一行修正。
  - 引擎「先送 onRequests、再送 onMessage」的順序本來就成立；這裡把它寫成測試鎖住，變成契約。

## 決策

採用 **B**。

- 手機 `AppSession.tsx` 與桌面 `App.tsx` 的 `onRequests`：先設定 `requestsRef.current = reqs`，再呼叫 `setRequests`。
- 桌面原本就在處理器開頭讀舊的 `requestsRef`，用來找出「新出現」的請求者（ADR-0217）。寫入放在那段之後。
- 引擎測試鎖住順序：陌生人的第一則訊息，含他的 `onRequests` 必須在 `onMessage` 之前送出。

## 後果

- 正面：陌生人的訊息從第一則起就不跳通知。桌面的離開期間摘要也不會把它算進去。
- 負面 / 已知殘餘風險：
  - 守衛測試是掃原始碼（app 層沒有能真的觸發引擎回呼的測試環境），只擋得住「忘了同步寫入」，擋不住其他寫法上的錯。
  - 其他也是在 render 時鏡像、又在引擎回呼裡讀的 ref（例如 `contactsRef`、`groupsRef`）理論上有同類時序。這次只查了請求清單，因為它直接決定隱私行為。

## 測試

- `packages/engine/src/backend/relay-backend.test.ts`：陌生人的第一則訊息，含他的 `onRequests` 先於 `onMessage`。
- `apps/mobile/src/request-ref-sync.test.ts`：兩端的 `onRequests` 處理器都直接寫入 `requestsRef.current`。修正前兩端都是紅燈。
- 實機（Pixel 8a，App 在背景，錨點 1，測試身分）：
  - 修正前：第一位陌生人的訊息跳了通知。
  - 修正後：用第二把新的陌生人金鑰寄送，沒有通知，訊息在請求區。
  - 接受他之後再寄：跳出通知，標題是寄件人、內文是訊息。
  - 點通知：開到那個對話，通知自動清掉。
