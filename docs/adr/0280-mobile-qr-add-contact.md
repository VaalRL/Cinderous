# ADR-0280：行動端以 QR 加好友（出示／複製／掃描），QR 產生上移 core

- 狀態：已接受
- 日期：2026-07-29
- 相關：ADR-0086（行動端真實 relay 加好友）、ADR-0101（行動端 WebRTC，相機權限來源）、ADR-0135（剪貼簿平台縫）、ADR-0274（Capacitor：能用瀏覽器 API 就不拉原生依賴）、ADR-0278（聊天頁改版）

## 脈絡

行動端要加好友只有一條路：**貼上 npub**。而「自己的 npub」在加好友面板裡只是
一行**不能點的文字**——想把它給朋友，得手動選取一串 63 字的 bech32。

桌面端其實早就有 QR 顯示，`apps/desktop/src/qr.ts` 的檔頭註解甚至白紙黑字寫著：

> 桌面端負責「顯示 QR」；掃描（相機解碼）在行動端（Phase D）。

行動端從來沒補上這半邊。

## 決策

### 1. QR 產生上移 `packages/core`

`qr.ts`（`makeQr` / `qrSvg` / `qrDataUri`，基於 `qrcode-generator`）由 `apps/desktop/src/`
移到 `packages/core/src/`，`qrcode-generator` 相依一併移過去，桌面三個使用點改吃
`@cinderous/core`。行動端要用同一份實作——複製第二份編碼器是 SSOT 的反面。

### 2. 加好友面板重做為 `AddContactPanel`

原本內嵌在 `ChatsListScreen` 的加好友區塊抽成獨立元件，含三件事：

- **出示**：「顯示 QR」切換（預設收合——一開啟就佔半個畫面太吵）
- **複製**：一鍵複製自己的 npub（走既有 `native/clipboard.ts`），成功後按鈕改顯示「已複製」
- **掃描**：開後鏡頭掃對方的 QR，掃到即直接加好友

### 3. 掃描用 `BarcodeDetector`，不拉原生外掛

Chromium 的 Shape Detection API 在 Android WebView 就有，走系統解碼器：
**零第三方相依、零原生程式碼、零 APK 體積**。這與 ADR-0274 選 Capacitor 的理由一致
——能用瀏覽器 API 解決的就不要拉原生依賴（`@capacitor/camera` 當初正是因為硬吃
Java 21 而被移除）。相機權限也不必新增：`android.permission.CAMERA` 早因 WebRTC
視訊通話（ADR-0101）就在 manifest 裡。

**誠實的限界**：`BarcodeDetector` 不保證存在（iOS Safari 沒有；部分 Android 裝置需要
Google Play 服務的條碼模組）。`qrScanSupported()` 據實回報，**不支援就不顯示掃描鈕**
——貼上那條永遠在，掃描只是加速。刻意不做「假裝支援、按了才發現一直轉圈」的降級：
那比沒有按鈕更糟。

### 4. 兩條安全細節

- **掃到的內容先驗證是 npub 才送出**。QR 可以是任何東西——網址、Wi-Fi 設定、別人的名片。
  不驗就把垃圾灌進 `addContact`。不是 npub 就明說，不靜默失敗。
- **相機串流用完一定關**（含使用者取消、元件卸載、解碼例外三條路徑都走 `finally`）。
  鏡頭指示燈亮著不熄是嚴重的隱私觀感問題，測試對「兩條軌道都 `stop()`」有紅字斷言。

## 後果

**正面**

- 面對面加好友從「唸 63 字」變成「掃一下」。
- QR 編碼兩端同一份實作。
- 沒有新增任何原生相依或權限。

**負面／代價**

- **掃描鈕在部分裝置上不會出現**。`BarcodeDetector` 的實際覆蓋率我們沒有實測資料，
  這是本批最大的未知。若實機驗收發現多數裝置沒有，替代方案是引入純 JS 解碼器
  （如 jsQR，約 13KB gzip）——`native/qr-scan.ts` 是唯一碰解碼的地方，換掉是單檔改動。
- 掃描以 ~5fps 輪詢（省電與反應速度的折衷），對焦不良時可能要多晃兩下。

**待辦**

- 實機驗收（**最高優先**）：掃描鈕是否出現？出現的話掃得到嗎？
- 實機驗收：拒絕相機權限時應顯示錯誤而非卡住；取消掃描後鏡頭指示燈要熄。
- iOS 尚無原生殼；屆時 `BarcodeDetector` 缺席，掃描鈕不會出現（行為正確，但體驗上
  iOS 使用者只有貼上一條路）。
