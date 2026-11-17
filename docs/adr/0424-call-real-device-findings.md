# 0424. 通話實機驗收發現：通話中開的視訊從沒顯示過、答方開視訊送不出去、手機切不了鏡頭

- 狀態：已接受
- 日期：2026-11-17
- 相關文件：ADR-0338（通話中升降級、預先協商的視訊軌）、ADR-0339（切換鏡頭；本 ADR 修訂其「先取新軌再停舊軌」）、ADR-0340、`docs/OPERATOR-TODO.md` §B-Call

## 背景與問題

§B-Call 一直寫著「測試驗的是我方實作符合我對 WebRTC 規格的理解，不是瀏覽器真的那樣行為」。
2026-11-17 第一次用兩台真機跑：桌面（Tauri／WebView2）↔ Android（moto edge 20 pro，行動網路，Capacitor WebView），
透過 DevTools 讀 `getStats()` 與媒體元素狀態判定，不靠肉眼。發現四個 FakePc 測不到的問題：

1. **通話中才開的視訊，對方畫面從來沒顯示過**（兩個方向都是）。預先鋪的視訊 transceiver（ADR-0338）是
   `addTransceiver("video")`，**沒有綁 stream**；對端 `ontrack` 的 `ev.streams` 是空的，而程式只看 `ev.streams[0]`，
   於是視訊軌被丟掉。畫格照收（`framesDecoded` 一直在加），手機上卻只顯示 `<video>` 的預設播放圖示。
2. **答方開視訊，對方永遠收不到**（§B-Call 預警的那種不對稱失敗，但成因不同）。答方的 `ensurePc` 也自己
   `addTransceiver("video")`，而 JSEP 規定只有 `addTrack` 建的 transceiver 會被遠端 offer 重用——
   於是答方有兩條視訊 transceiver，第一條 `mid=null`、不在 SDP 裡。`videoSender()` 拿第一條，
   相機開了、指示燈亮了，送出的畫格數是 0。
3. **桌面自我預覽／對方畫面是黑框**。這兩個 `<video>` 是開了視訊才掛上的，但升級是對**同一個** localStream 加軌，
   `useStream` 的 effect 只在串流物件變動時才設 `srcObject`，新元素就一直是 null。
4. **手機切不了鏡頭**。前鏡頭開著時取後鏡頭 → `NotReadableError: Could not start video source`
   （多數 Android 手機不能同時開兩顆鏡頭）。ADR-0339 的「先取新軌再停舊軌」在這類手機上**永遠**失敗，
   畫面維持前鏡頭，只在背後報一個錯。
5. **一開始就打「視訊通話」，接聽方的畫面送不出去**（比第 2 點更常見：每一通視訊電話都中）。原因同第 2 點：
   答方 `acquireMedia` 用 `addTrack`，而 `addTrack` 重用**第一條**同類、沒上軌的 transceiver——正是 `ensurePc`
   自己鋪、`mid=null` 的那條。相機開了、預覽有畫面，送出畫格數 0；對方畫面顯示「無法播放媒體」。
   推測自 ADR-0338（v0.0.16）起，視訊通話的接聽方一直沒被看見。
   ⚠ 第一版修正「套用 offer 後停掉那條」在 Chrome 上直接失敗：`addTrack` 仍挑中那條**已停**的，
   丟 `InvalidAccessError: The existing transceiver is stopping`，不會跳到下一條。

## 考量的選項

- 問題 1：在送的這端給 transceiver 綁 stream，或在收的這端把沒帶 stream 的軌併進遠端串流。
  已出貨的 v0.0.16–v0.0.24 都是不綁 stream 送的，只改送端救不了和它們的通話 ⇒ **改收端**。
- 問題 2：答方不要自己鋪 transceiver，或挑「協商過的」那條。前者要讓 `ensurePc` 知道角色、牽動 ADR-0338 的時序；
  後者一行、對已出貨的對端也成立 ⇒ **挑 `mid != null` 的那條**。
- 問題 4：一律先停舊軌（有空窗、失敗回不去）；或維持原順序，只有遇到「鏡頭忙碌」才改先停舊軌並備退路。

## 決策

1. `ontrack`：每條遠端軌都併進這一通的遠端串流，並送出**新的** `MediaStream` 物件；沒帶 stream 的軌也收。
2. `videoSender()`：先挑 `mid != null`（協商過）的視訊 transceiver，沒有才退回第一條。
3. 本地串流變動（開／關視訊、換鏡頭）一律送出**新的** `MediaStream` 物件；桌面 `useStream` 改成每次 render 都比對
   `srcObject`，後掛上的元素也接得上（行動端 `StreamView` 每次都是新掛上的元件，不受影響，補回歸測試）。
4. **修訂 ADR-0339**：換鏡頭仍先取新軌；但遇到 `NotReadableError`／`TrackStartError`／`AbortError`（鏡頭忙碌）時，
   改成**先停舊軌再開新軌**。新鏡頭開不了 → 用原本的鏡頭重開；連原本的都開不了 → 正式降級成語音（通知對方，
   不送一條死掉的軌）。其他錯誤（例如裝置被拔掉）照舊：舊軌不動。
5. 答方 `acquireMedia`：視訊軌若有「協商過（`mid != null`）、還沒上軌」的 transceiver，就 `replaceTrack` 放上去，
   再 `setStreams(stream)` 補 msid（舊版對端的 `ontrack` 才拿得到 stream）；沒有（主叫還沒協商）才照舊 `addTrack`。
   自己鋪的那條**不停掉**（停了 `addTrack` 會丟例外）；只有 offer 根本沒有視訊（舊版對端）時才停，
   `canChangeMedia` 才會照實回 false。
6. 桌面通話視窗控制列可換行：視訊時一列有五個控制項，原本把「關閉我的視訊」擠成直排、掛斷擠出框外。

## 理由

- 這四個都是「規格允許、我們的替身沒模擬到」的行為：transceiver 的 stream 綁定、JSEP 的重用規則、React effect 的觸發條件、
  手機相機的同時開啟限制。單元測試照我們的理解寫，所以全過；只有真機能抓。
- 收端修正讓新版和已出貨的舊版之間的通話也能看到通話中開的視訊。
- 換鏡頭只在「鏡頭忙碌」才改順序，保留 ADR-0339 在桌面（多顆鏡頭可同時開）上無空窗的好處。

## 後果

- 正面：通話中開視訊在兩個方向、兩種角色下都真的看得到；手機可以翻到後鏡頭。
- 負面 / 已知殘餘風險：
  - 手機換鏡頭會有一小段沒有畫面（停舊軌到新軌送出之間）；指示燈不會兩個同時亮。
  - 舊版（v0.0.24 以前）的**答方**開視訊（含一開始就是視訊通話）仍送不出去，要對方也更新。
  - 答方那條沒進 SDP 的視訊 transceiver 仍然存在（不能停，見決策 5），無害。
  - 桌面換到開不了的鏡頭（實測：沒在跑的 OBS 虛擬鏡頭 → `NotReadableError`）會走「鏡頭忙碌」退路，
    重開原本的鏡頭，畫面不中斷；但沒有告訴使用者「那台開不了」，選單也停在新選的那台。
- 驗證：
  - `webrtc-call.test.ts`：答方升級換到協商過的那條、沒帶 stream 的遠端軌併進串流、開／關視訊送新的串流物件、
    鏡頭忙碌時先停舊軌、新鏡頭開不了用原本的重開、都開不了降級成語音；`CallWindow.stream.test.tsx`、`CallScreen.stream.test.tsx`。
  - 實機（2026-11-17，桌面 Tauri ↔ moto edge 20 pro 行動網路）：見 `OPERATOR-TODO.md` §B-Call 的驗收紀錄。
