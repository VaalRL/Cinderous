# 0022. 語音訊息（Voice Messages，M7）

- 狀態：已接受
- 日期：2026-07-01
- 相關文件：docs/ROADMAP.md（Phase E / M7）；docs/adr/0017（WebRTC 檔案傳輸）

## 背景與問題

M7 語音訊息：錄音後傳給對方並可播放。希望**複用**已完成、已驗證的 A4 WebRTC P2P
檔案傳輸，而非另立通道；語音內容走 P2P（不經中繼、DTLS 加密）。

## 決策

- **錄音**：對話視窗以瀏覽器 `MediaRecorder`（`getUserMedia({audio:true})`）錄音，
  停止時得到音訊 `Blob`（通常 `audio/webm;opus`）。
- **傳送（複用 A4）**：把 `Blob` 包成 `File`（`voice-message.webm`）交給既有
  `onSendFile` → `WebRtcTransfer.sendFile`。**語音訊息就是一個檔案**，以 `mime`
  `audio/*` 標示，無需新協定或後端改動。
- **渲染**：訊息列偵測 `file.mime` 以 `audio/` 開頭時，渲染 `<audio controls>` 播放器
  （而非一般檔案卡）。送出端也保留本機 `blob:` URL，故自己也能重播。

## 後果

- 正面：以極小新增（錄音 + 一個渲染分支）獲得語音訊息，完全站在 A4 之上（分塊、
  進度、背壓、P2P 加密皆沿用）。經**真實 relay + 真實 WebRTC** 兩 context E2E 驗證
  （以 Chromium 假音源錄音，Bob 端收到可播放的音訊，位元組 > 0）。
- 負面 / 未來：v1 無錄音波形/時長預覽、無邊錄邊傳（錄完才送）；離線對方收不到
  （P2P 需雙方在線——與 A4 同，離線語音的中繼退回策略仍為未決 ADR，受中繼大小限制）；
  格式依瀏覽器（webm/opus），跨平台播放相容性於行動端再驗。相簿（M7 另一項）將以
  相同「收到的檔案」為基礎聚合媒體。
