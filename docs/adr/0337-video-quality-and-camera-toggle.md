# ADR-0337：視訊畫質三檔（可通話中調整）與關鏡頭

- 狀態：已採用
- 日期：2026-08-05
- 關聯：ADR-0101（通話媒體平台縫）、ADR-0243／**ADR-0336**（TURN 成本模型）、M8（通話）

## 1. 起點：視訊早就做完了，但沒有任何約束

盤點視訊「可行性」時發現它**不是待實作項**——core 狀態機（`CallMedia = "audio" | "video"`）、engine 取媒體、桌面與行動端 UI、Android 相機權限（Capacitor 7 的 `BridgeWebChromeClient` 自己處理 runtime 授權）全部都在，測試綠。

缺的是**品質控制**。目前這一行是全部：

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === "video" });
```

沒有解析度約束、沒有 `maxBitrate`、沒有 `degradationPreference`。相機給什麼就送什麼（手機常見 720p 以上），Chrome 會推到 ~2 Mbps。

三重後果：

1. **吃使用者的行動數據**——而且他無從得知，更無從調整。
2. **TURN egress 翻倍**——直接動搖 ADR-0336 §1 的算式（0.9 → 2.2 GB/h）。
3. **弱網下不降級就是卡死**——沒有 `degradationPreference`，瀏覽器的取捨未必是使用者要的。

## 2. 決策一：三檔畫質，值放 core

| 檔位 | 解析度 | fps | 視訊上限 | 經 TURN 的 egress（雙向含音訊） |
| --- | --- | --- | --- | --- |
| `low` | 320×240 | 15 | 150 kbps | **~180 MB/h** |
| `medium`（預設） | 640×480 | 24 | 600 kbps | **~585 MB/h** |
| `high` | 1280×720 | 30 | 1500 kbps | **~1.4 GB/h** |

放 `packages/core/src/video-quality.ts`（純資料＋純函式，無平台相依），桌面與行動端共用同一份數字——**畫質檔位是產品決策，不是各端各自調參**。

**預設 `medium` 而非 `high`。** 預設值服務的是「行動數據上的中階手機」，不是「有線網路上的桌機」。想要更好的人會去調；被預設值吃掉流量的人不會知道發生什麼事。

`degradationPreference: "maintain-framerate"`——視訊通話是看人臉，掉解析度比掉幀順眼。

### 為什麼要能通話中調整

畫質問題**只有在通話中才會被察覺**。做成埋在設定頁、下次通話才生效的偏好，等於要求使用者「先掛斷、去設定、再打一次」——那時他已經改用別的 App 了。

⇒ 選擇器放**通話視窗內**，即時生效；同時**持久化為裝置層預設**，下次直接用上次選的。

裝置層而非身分層：這是「**這台**的相機與網路」，與 ADR-0327 判 `cloudSync` 為身分層的理由正好相反（那個決定的是資料要不要離開裝置）。同類的是 `readReceipts`／`retentionCap`。

### 生效路徑：兩段都要動

即時生效**不能只改 `getUserMedia`**——那只影響擷取端，已在傳的軌道不受影響。兩段都要：

1. `sender.setParameters({ encodings: [{ maxBitrate }] })`——**改的是編碼上限**，立即生效、不需重新協商。
2. `track.applyConstraints({ width, height, frameRate })`——改擷取解析度。

⚠ **順序有意義**：先降 bitrate 再降解析度。反過來會有一小段「低解析度但高位元率」的浪費視窗。

## 3. 決策二：關鏡頭走 UI，不走後端

目前靜音是在 UI 層做的（`CallWindow.tsx` / `CallScreen.tsx` 各自 `getAudioTracks().forEach(t => t.enabled = ...)`）。

**關鏡頭完全對稱——`getVideoTracks()`——所以走同一條路，不新增後端方法。** 這是 Fix-First：既有模式能表達的事，不為了整齊而另闢介面。

而畫質**必須**走後端，因為 `setParameters` 要拿到 `RTCRtpSender`，UI 手上只有 `MediaStream`。

⇒ **兩個功能走兩條路，不是不一致，是各自走它能真正生效的那條。**

`track.enabled = false` 的語意是**送黑畫面**（不是停止傳送）——對端看到黑畫面而非凍結，且能立即恢復。與靜音的語意一致（對方是真的看不到，不是只有本地隱藏）。

## 4. 買不到什麼

1. **`maxBitrate` 是上限不是保證。** 網路不好時實際位元率會更低；`high` 不代表一定拿得到 720p30。
2. **關鏡頭不是關相機。** `enabled = false` 時軌道仍然開著、相機指示燈**可能仍亮**（平台而定）。要真正釋放相機得 `stop()` 軌道，但那需要重新協商才能恢復。⇒ **設定頁不得暗示「相機已關閉」**，文案用「停止傳送視訊」。
3. **沒有自動適應。** 三檔是手動的；沒有依實測頻寬自動升降。`degradationPreference` 只讓瀏覽器在**選定的上限內**做取捨。
4. **對端不知道你調了什麼。** 沒有帶內通知；對方只會看到畫質變化。
5. **不影響已在進行的音訊。** 三檔只約束視訊；音訊一律 Opus 預設。
6. **沒有處理「對方關了鏡頭」的呈現**——遠端 `<video>` 仍是黑的且 UI 不解釋（`ontrack` 只認 `ev.streams[0]`）。列為後續。
7. **Android 仍是 WebView 軟體編碼。** 降到 `low` 能緩解中低階機發燙掉幀，但根治仍需 `call-media.native.tsx` ＋ `react-native-webrtc`（ADR-0101 檔頭已寫明路徑）。

## 5. 後續

- 「對方已關閉鏡頭」的遠端呈現（§4-6）
- 通話中語音↔視訊升降級（需動 core 狀態機，另立 ADR）
- 畫面分享 `getDisplayMedia`
