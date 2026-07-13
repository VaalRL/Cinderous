# 0093. 多設備即時投遞與檔案接收：檔案 metadata 中繼化＋位元組 P2P＋收檔另存至使用者選定路徑

- 狀態：已接受（已實作）
- 日期：2026-07-13
- 相關文件：ADR-0017（WebRTC 檔案傳輸）、0009（多設備同步）、0029（資料通道二進位框架）、
  0054（加密儲存基質）、0034（多中繼路由）、0059/0056（離線留言儲存）；
  `packages/engine/src/backend/webrtc.ts`、`relay-backend.ts`、`packages/engine/src/storage/*`

## 背景與問題（含現況勘查）

多設備（B 同時用電腦＋手機，同一把金鑰）現況：

1. **文字訊息**：kind 1059（**relay 儲存**、NIP-40 TTL），兩台都收到；本地由後端 `storage.appendMessage`
   持久化（`AppStorage`，每對話上限 `MESSAGES_PER_CONVO=1000`；Tauri 版加密 blob ADR-0054，瀏覽器/開發為
   localStorage 明文）。→ **多設備 OK、本地持久 OK。**
2. **WebRTC P2P**：連線以**對方 pubkey**為 key（`peers: Map<PubkeyHex, PeerConn>`）——**身分定址、非裝置定址**。
   B 兩台共用同一 pubkey → A 對 B 只有一條連線；兩台都收到 offer、都回 answer，A 套第一個、第二個因連線已
   `stable` 丟錯被丟棄（glare）。→ **P2P 只落一台。**
3. **檔案**：純 P2P（`sendFile` 只呼叫 `transfer.sendFile`、**不發任何 relay 訊息**）；收檔 `onFileReceived`
   做成 `URL.createObjectURL(blob)` 加進 **React state**、**不寫儲存**（`StoredMessage` 無 file 欄位）。

由 (2)(3) 得三個缺口：
- **G1 靜默部分投遞**：檔案只到一台；另一台**完全不知有檔案**（relay 無痕跡、metadata 在它沒拿到的 P2P 通道裡）。
- **G2 檔案不持久**：收到的檔案是記憶體 object URL，**重載即失**——連**單一設備**都不保留檔案歷史。
- **G3 sender 無投遞可見度**：A 送給「B」，落哪台是 race，A 不知只有一台收到。

## 考量的選項

- **選項 X（裝置定址 P2P 扇出）**：信令加 device id，A 對 B **每台各建一條** P2P，位元組扇出到所有裝置。
  優：真多設備即時。缺：N 條連線、glare/裝置發現複雜、頻寬 ×N，且與「身分＝一把金鑰、裝置對等」的簡潔性衝突。**暫不採**（列未來）。
- **選項 Y（採用方向）**：**檔案 metadata 走中繼＋位元組 P2P＋收檔另存至使用者選定路徑**（不採中繼備援、App 不存位元組）。
- **選項 Z（僅靠多設備同步 ADR-0009 事後補）**：收到那台把檔案訊息同步過去。缺：非即時、URL 裝置本地、
  D4b delta 未實作、位元組仍不在。不足以獨立解 G1。

## 決策（草案，待裁示）

採**選項 Y**，分項：

1. **檔案 metadata 中繼化（解 G1/G3）**：送檔時**另發一則 relay 訊息**（kind 1059）帶檔案 metadata
   （檔名、大小、mime、可選縮圖占位）。**metadata 全在加密 rumor 內層**——relay 看不到（同一般訊息），
   無隱私損失。→ **兩台都看到「📎 檔名」**；沒拿到位元組的裝置顯示「檔案在你另一台裝置——可請對方重送
   或走中繼下載」，而非靜默漏掉。sender 也能顯示投遞狀態。
2. **位元組走 P2P**（不變）：到連上的那台，省中繼頻寬（延續 ADR-0017）。
3. **不採中繼位元組備援（使用者裁示）**：位元組不上中繼。代價＝沒拿到位元組的裝置無法自行下載，
   只能請 sender 重送（見 G1 的收斂結果）；換得中繼零檔案負載、位元組永不離開 P2P。
4. **收檔另存至使用者選定路徑（解 G2；使用者裁示）**：App **不保存位元組**。收到位元組時（Tauri 桌面）
   跳原生「另存新檔」對話框讓使用者選位置 → 以 fs 寫入該路徑 → `StoredMessage` 只記 file metadata
   （檔名、大小、mime）＋使用者選定的 `savedPath`，UI 事後顯示該路徑（可「在檔案總管開啟」）。
   位元組交由 OS 檔案系統，App 不做加密存檔、不需上限/逐出。瀏覽器/web preview 無任意檔案系統存取，
   退回瀏覽器下載（最終路徑不可知，UI 顯示「已下載」）。

## 理由（草案）

- **CP 值**：G1/G3 只需「多發一則加密 metadata 訊息」＋UI 提示，複用既有 relay 訊息路徑，不背 N-連線複雜度。
- **隱私不變**：metadata 走加密內層，relay 看不到；位元組全程 P2P、且不上中繼備援。
- **檔案歸使用者**：另存至使用者選定路徑而非 App 內部存檔——所有權與清理交還 OS，App 只留 metadata＋路徑，
  避免 App 背位元組儲存的加密/上限/逐出複雜度（G2 現況連單設備都丟檔，此法一併解決）。

## 後果 / 決議

- 正面：另一台不再對檔案無感（顯示「檔案在你另一台裝置」）；收到的檔案由使用者另存到選定路徑、重載後
  仍見得到路徑；sender 有投遞可見度。
- 使用者裁示（2026-07-13）：採 metadata 中繼化（item 1）＋位元組 P2P（item 2）；**不採**中繼位元組備援
  （item 3）；檔案**不由 App 保存**，改為收檔跳「另存新檔」對話框、UI 顯示儲存路徑（item 4）。
- 取捨 / 待實作細節：
  - `StoredMessage` 加 file 欄位＝**僅 metadata＋`savedPath`**（無位元組、無位元組儲存層、無加密存檔/逐出）。
    對 ADR-0054 儲存僅多幾個字串欄位；ADR-0009 同步時 metadata 可進快照，但 `savedPath` 為**裝置本地語意**
    （各裝置各自的路徑，不跨裝置搬移檔案本體）。
  - G1 收斂：沒拿到位元組的裝置**知道有檔案**但**無法自取**（因 item 3 不採備援），UI 提示需請對方重送。
  - Tauri 用 `dialog.save()`＋`fs` 寫檔；瀏覽器退回下載、路徑不可知顯示「已下載」。
  - **選項 X（裝置定址 P2P 扇出）** 留作未來；若「多台同時即時收位元組」成硬需求再立專屬 ADR。

## 實作（已完成）

- **契約（`packages/core`）**：`wrapFileMessage`/`parseFileMeta`＋rumor `file` tag（`["file", tid, name, size, mime]`，
  全在加密內層，中繼看不到）；`ReceivedFile` 增 `id`（＝傳輸 id `tid`）供關聯 P2P 位元組與中繼 metadata。
- **關聯（`relay-backend.ts`）**：`fileMsgByTid` 以 `tid` 去重——中繼 metadata 與 P2P 位元組**任一先到都只產生一則**
  檔案訊息。訊息 id＝metadata 事件 id（送達/已讀回條對得上，G3）；`file.id`＝tid（進度/位元組關聯）。
  - `sendFile`：位元組走 P2P（不變）＋另發 `wrapFileMessage` 中繼訊息＋持久化 outgoing 檔案訊息。
  - `receiveDm` 檔案分支：建 metadata-only 訊息（`sent=0`＝在另一台）＋回送已送達回條（G3）。
  - `onFileBytes` 事件：位元組到本機時交 App 另存；`setFileSavedPath` 回填 `savedPath` 並持久化。
- **儲存（`packages/engine/storage`）**：`StoredMessage.file`＝`StoredFileMeta`（`tid/name/size/mime/savedPath?`，
  **無位元組**）；新增 `AppStorage.setFileSavedPath`（Memory/Local/Tauri 三實作）。
- **UI（`apps/desktop`）**：`native/save-file.ts`——Tauri 走 Rust `save_file`（rfd 原生「另存新檔」＋`fs::write`，
  回傳路徑）、瀏覽器退回下載；檔案卡片顯示「已儲存於 {路徑}」/「📍 檔案在你另一台裝置」/「已接收（未儲存）」。
- **測試**：core（metadata 往返、內層不外洩、`ReceivedFile.id`）、engine（送檔另發 metadata＋雙方持久化、
  metadata-only 收斂、`setFileSavedPath` 持久化）。
- G1 收斂如決議：沒拿到位元組的裝置**知道有檔案**但**無法自取**（不採中繼備援），UI 提示需請對方重送。
