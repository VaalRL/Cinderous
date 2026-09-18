# 0361. 刪掉 `connection.ts` 的傳輸選擇抽象——ICE 已經在做這件事了

- 狀態：已接受
- 日期：2026-09-18
- 相關文件：ADR-0008（WebRTC 信令與資料通道協定，提出這組抽象）、
  ADR-0017（WebRTC 檔案傳輸）、ADR-0243（公共 TURN 的成本論證）、
  ADR-0344（ICE 路徑判定；§後續行動 ③ 正是本案）、ADR-0342（TURN 用量）

## 背景與問題

ADR-0008 §3 定下「雙軌降級」：

> `selectTransport` 依偏好順序挑第一個可用路徑。Nudge `p2p→turn→relay`；檔案 `p2p→turn`（不經中繼）。

實作住在 `packages/core/src/connection.ts`：`Transport`、`Reachability`、
`NUDGE_TRANSPORT_ORDER`、`FILE_TRANSPORT_ORDER`、`selectTransport()`。

**沒有任何生產程式碼呼叫過它們**（整份版本庫的引用只有它自己的測試）。ADR-0344 §後續 ③
已經點名這件事，並把處置列為「另案處理」。本 ADR 就是那一案。

實際發生的事情是：**ICE 自己做完了這件事**。`RTCPeerConnection` 拿到一組含 STUN／TURN 的
`iceServers`，然後自行協商出 host／srflx／relay 候選配對——沒有人需要先算「現在哪條路可用」。
`Reachability`（要求呼叫端事先知道三條路各自通不通）描述的是一個從未存在過的世界。

留著它有實際成本：

1. **它是一份平行的政策宣告。** `ice-path.ts` 與 `file-gate.ts` 的檔頭註解都寫著
   「`FILE_TRANSPORT_ORDER` 讓檔案走同一條管子」——**把一個沒人讀的常數當成控制點在引用**。
   有人要改「檔案能不能走 TURN」時，grep 會把他帶到那個常數，改了它什麼都不會發生。
2. **它是公開匯出。** 從 `@cinderous/core` 的 index 出去，隨時可能被接上，
   而一旦接上，傳輸政策就真的有兩個來源了。

## 考量的選項

- **A：接上真實判定。** 讓 `selectTransport` 吃 `classifyIcePath()` 的結果。
  否決：它會是一層**沒有決定權的包裝**——ICE 已經選好了路，這個函式只能事後複述。
  ADR-0344 的 `classifyIcePath()` 回報實際路徑、`file-gate.ts` 據此把關，那才是真正
  可執行的政策。多一層轉譯只是多一個會漂移的地方。
- **B：留著當文件。** 否決：程式碼當文件的前提是它會被執行。不會執行的程式碼是**看起來
  像真的**的文件，比註解更危險——註解至少不會讓人以為改了它就有效。
- **C（採用）：刪除整個模組，並把兩處引用它的註解改寫成指向真正的控制點。**

## 決策

1. 刪除 `packages/core/src/connection.ts` 與 `connection.test.ts`，移除 index 的 re-export。
2. `ice-path.ts` 與 `file-gate.ts` 的檔頭改成描述**真正讓檔案走得上 TURN 的東西**：
   檔案與通話共用同一個 `RTCPeerConnection` 設定（`webrtc.ts` 的 `rtcConfig`，內含 TURN
   伺服器），所以兩者走同一條管子。政策論證（成本、把關門檻）完全不變，只是不再指錯地方。

ADR-0008 §3 因此在這一點上被取代。ADR 是歷史紀錄，不回頭改寫；讀到那一段的人，
由本 ADR 接手說明現況。

## 理由

- **ICE 本來就是傳輸選擇器。** 在它上面再疊一層「先判斷哪條可用」的抽象，是把
  瀏覽器已經做完而且做得更好的事重做一遍。ADR-0008 寫在還沒有 STUN/TURN 的時期
  （ADR-0017 自承「目前無 STUN/TURN 設定」），那時這個抽象是合理的設計預留。
  預留沒有兌現，就該收掉，而不是留在原地假裝自己在運作。
- **CLAUDE.md 的 SSOT 與 Fix First**：傳輸政策的真實來源是 `rtcConfig` 與 `file-gate.ts`。
  第二份宣告即使不被執行，也會在下一個人 grep 的時候變成錯誤的起點——而這件事**已經發生過**，
  證據就是那兩處註解。

## 後果

- **正面**：傳輸政策只剩一個來源；grep `FILE_TRANSPORT_ORDER` 不再把人帶到死路。
- **正面**：ADR-0344 §後續 ③ 結案。
- **負面 / 已知殘餘風險**：
  - **ADR-0008 §3 與 ADR-0017 的敘述就此與程式碼不符**。這是 ADR 作為歷史紀錄的正常狀態，
    但讀舊 ADR 的人可能被誤導，所以在此明白寫下取代關係。
  - **「檔案不經 Nostr 中繼」這條政策失去了一個顯式宣告**。它現在是**結構性的**——
    檔案走資料通道，資料通道只有 P2P／TURN 兩種可能，沒有第三條路可走。結構保證比常數
    強，但它沒有名字，不容易在程式碼裡被指認。
  - 刪的是公開匯出。`@cinderous/core` 是 `private: true` 的工作區套件、無外部使用者，
    所以沒有相容性問題；若日後要發佈，這一筆屬於破壞性變更。
