# 0375. 離線留言存不下就回 `OK false`：嚴格平面天花板的拒收要讓寄件端看得見

- 狀態：已接受 (Accepted)——2026-09-30 使用者核准 SDK ADR 0038 的建議並要求先修 P0-R1；**尚未部署**
- 日期：2026-09-30
- 相關文件：ADR-0367（§決策 2：嚴格平面只拒收、不淘汰）、0366（車道、容量）、0041（外送匣：OK 感知重試）、0058（送達分級）、0095（傳送失敗紅色圖示）、
  0241（分片）、0235 H1（重放去重）；SDK ADR 0038（中繼容量訊號與客戶端改用，P0-R1）；Cinderous PR #9（錨點改用 SDK 中繼，暫緩合併）；
  `relay/src/relay-core.ts`、`relay/src/message-store.ts`、`relay/src/sql-message-store.ts`

## 背景與問題

ADR-0367 §決策 2 承諾：嚴格平面（Cinderous 訊息平面）每顆 DO 的容量天花板**只拒收、不淘汰**，滿了就回可診斷的 `OK false`，讓人看得見。
可尋址事件做到了（`putAddressable` 回 false → `OK false "blocked: 取代事件遭拒…"`），**離線留言沒有**：

- `SqlMessageStore.put()` 撞到 `offlineMaxTotalBytes`（128 MB／DO）而 `ceilingEvicts` 沒開時回 `false`；
- `RelayCore.handleEvent()` 寫的是 `this.opts.store?.put(event, this.now());`，**不看回傳值**，接著無條件回 `OK true`、照常扇出。

結果：一顆嚴格平面 DO 的離線留言滿了之後，**每一則新的私訊、群訊、群控都回 `OK true` 然後不見**。寄件端以為送達（外送匣把它當確認），
在線的收件人那一刻收到了即時扇出，離線的收件人（或同一人的其他裝置）永遠收不到，站方也看不到錯誤。
`put()` 另一個回 false 的情況（事件自帶的 NIP-40 `expiration` 已經過了）同樣被當成成功。

`wrangler dev` 實測（修正前，本機、嚴格平面 `/`、16 位收件人各約 240 KB 的 kind 1059）：送 40 顆，**40 顆都回 `OK true` 並扇出，只存了 34 顆**，6 顆 `OK true` 卻不在庫裡。

SDK 中繼（`@cinderous/client/relay`）有同一行、同一個缺陷，已於 SDK v0.31.1 修正（SDK ADR 0038 P0-R1）；本 ADR 把同一個修正做在錨點自己的 `relay/`，
拒收訊息逐字相同，PR #9 把錨點切到 SDK 中繼時客戶端看到的不會變。

## 考量的選項

- **A. 回 `OK false`，照常扇出給在線收件人**：在線的人不必等。但 NIP-01 的 `false` 就是「沒收下」，中繼同時說了兩件相反的事；
  同一位收件人的在線裝置收到、離線裝置收不到（狀態分裂）；寄件端依 `false` 重送或改寄別座時，在線那台會收到第二次。
- **B. 回 `OK true "warning: …"`，照常扇出**：不說謊地承認「沒存」但仍算成功——外送匣與所有 NIP-01 客戶端都會把它當送達，離線收件人照樣收不到，等於沒修。
- **C. 回 `OK false`，不扇出（採用）**。

## 決策

1. `RelayCore.handleEvent` 在非可尋址、非 Ephemeral 的持久化路徑上看 `put()` 的回傳值。`put()` 回 false 只有兩種原因，中繼先自己判斷過期、剩下的就是天花板：
   - 事件自帶的 NIP-40 `expiration` 已經過了 → `["OK", id, false, "invalid: expired: 事件已過期（NIP-40），未保存也未轉送"]`（`EXPIRED_REJECT`）；
   - 這顆 DO 的離線天花板滿了而不淘汰（嚴格平面）→ `["OK", id, false, "blocked: ceiling: 本站離線留言空間已滿，這則未保存也未轉送；請改用其他中繼或稍後再試"]`（`OFFLINE_CEILING_REJECT`）。
   格式是 NIP-01 的機器可讀前綴＋英文詞元＋中文說明（SDK ADR 0038 決策 2）：外站只看得懂 `blocked`／`invalid`，我們的客戶端多拿一層 `ceiling`／`expired`。
   兩句與 SDK 中繼**逐字相同**，是中繼與客戶端之間的契約，改字要兩邊一起改。
2. **不扇出**（選項 C）。被拒的事件不送給任何在線訂閱者。
3. **被拒的事件不記進重放快取**。修正前，重放窗內的事件在通過時鐘窗後就記成「見過」，之後任何一種拒收（限速、PoW、檔案未啟用、可尋址被拒、以及這次的天花板）
   都不會把它拿掉——空間騰出來後重送同一顆，只會拿到 `duplicate`，而 NIP-01 客戶端（包括本 App 的外送匣，`classifyOk` 把 `duplicate` 當確認）會把它當成已送達，
   又是一次靜默遺失。現在所有在記入之後的拒收都會把它拿掉；只有真的收下（或 Ephemeral 轉發、清除成功）才留著。拒收當下回的訊息不變。
4. 不變的：可尋址路徑（仍是同一句 `blocked: 取代事件遭拒（配額/大小/較舊）`）；每收件人 FIFO 與車道天花板淘汰是「收下新的、刪掉舊的」，`put()` 回 true，仍回 `OK true`；
   SQL 版遇到已存在的同一顆（`fresh.length === 0`）仍回 `OK true`。

## 理由

- 這是 ADR-0367 §決策 2 原本的承諾，只是離線留言那一側漏接了；修正不改任何保存、淘汰或容量數字。
- 不扇出的理由：NIP-01 的 `false` 語意必須完整——「沒收下」的東西不該部分生效。部分生效會讓寄件端無法判斷要不要重送：重送會讓在線的人收到兩次，不重送則離線的人永遠收不到。
  事件 id 相同，客戶端多半會去重，但那是在補中繼的矛盾，不是語意。不扇出的代價是在線收件人這一則要等寄件端改寄別座或空間騰出後重送；
  這個情況只在一顆 DO 的 128 MB 滿了才發生，而那時「看得見的失敗」正是 ADR-0367 要的。
- 已過期歸 `invalid`：NIP-40 說中繼 SHOULD 丟棄已過期的發布；重送同一顆永遠是過期的，換哪座都一樣，是寄件端自己的錯。

## 後果

- 正面：嚴格平面不再「回成功、實際丟掉」。本 App 的外送匣收到 `blocked:` → `permanent` → `onDrop` → `markFailed`，訊息顯示紅色重試圖示（ADR-0095），不會無限重送。
- 正面：`wrangler dev` 實測（修正後）：送到第 35 顆開始回 `OK false "blocked: ceiling: …"`、未扇出；回 `OK true` 的 34 顆全部查得到（0 顆遺失）；
  同一顆被拒後重送仍是 `blocked: ceiling:`（不是 `duplicate`）；已過期回 `invalid: expired:`。
- 負面／已知殘餘風險：
  - **App 只在「主連線」看得到 OK**：`RelayBackend` 只有 home client 接了 `onOk`；分片模式（ADR-0241）下寄給別人的訊息走對方訊息片的 pool client，
    那條連線沒接 `onOk`，外送匣收不到任何 OK，30 秒後 `inflightTtl` 靜默視為送達。所以對「收件人所在的那一片滿了」這個情況，
    中繼現在說了實話，但 App 目前**仍看不到**（本 ADR 不改 App；列為後續）。
  - 外送匣把 `blocked:` 一律當永久失敗，`ceiling` 其實是「稍後或換別座會好」；目前只顯示失敗、靠使用者手動重試，不會自動改寄別座（SDK ADR 0038 P0-C／P1 的範圍）。
  - 錨點要部署才生效；兩座錨點都要部署。
- 後續行動／待辦：
  - 部署前先記兩座回滾點；錨點 2 在另一個 Cloudflare 帳號，需要 `CLOUDFLARE_ACCOUNT_ID`，用 `wrangler.toml`＋`--env=""`（部署須使用者另行同意）。
  - PR #9 切換到 SDK 中繼時，需 SDK ≥ v0.31.1。
  - App：pool client 接上 `onOk`（至少對外送匣送出的那幾顆）、`classifyOk` 認得 `ceiling` 詞元（SDK ADR 0038 P0-C）。
  - `duplicate` 改回 `OK true`（SDK ADR 0038 決策 3，P0-R2）時，本中繼同步改。
