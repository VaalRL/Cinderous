# 0224. 跨裝置自訂資產同步（emoji／貼圖庫與 blob）

- 狀態：已接受
- 日期：2026-07-21
- 相關文件：ADR-0220（統一自訂資產）、0222（動畫 GIF）、0223（內容定址 blob backfill/push）、0071（加密雲端快照）、0009（多裝置同步）、0107（NIP-17 自封副本）、0054/0112（加密落地）、0221（審查修正：mine/最愛保護）

## 背景與問題

ADR-0220～0223 讓自訂 emoji（含大動畫 GIF）在單裝置＋1:1／群組可用，但 `customAssets`（庫）與 `assetBlobs`（blob 快取）是**每裝置、每身分的本機加密儲存**，**不跨裝置同步**。後果：

- 使用者在裝置 A 匯入的 emoji，在裝置 B **不在庫裡**——B 打 `:shortcode:` 找不到、無法送。
- B 收到自己（A 送）的大 GIF 訊息（自封副本，ADR-0107）時，**blob 不在 B 的快取**——顯示占位、無法渲染。

需讓「使用者自己的資產庫與 blob」在其各裝置間一致。

**可複用的既有機制**：
- **加密雲端快照（ADR-0071）**：`buildSnapshotContent`→自封 `SNAPSHOT_KIND` 事件；**交換律合併**（補缺不覆蓋、封鎖聯集、訊息 id 去重）；明文預算 180KB（relay 單顆 256KB）。目前**不含** `customAssets`／`assetBlobs`。
- **自封副本（ADR-0107）**：定址給自己 pubkey 的事件會被自己各裝置收到。
- **blob backfill/push（ADR-0223）**：`ASSET_REQUEST`/`ASSET_CHUNK`＋整合性；目前只對**聯絡人**收發。

## 考量的選項

- **A. 全量塞進雲端快照**：把 `customAssets`＋`assetBlobs` 一併放進快照。blob 動輒數 MB，遠超 180KB 預算＋relay 256KB 上限 → 備份靜默失敗。**否決**。
- **B. 庫走快照（含小圖內容）＋blob 走「向自己 backfill」**（採用）：庫（含小 SVG 內容、大圖只帶 `ref`）經快照交換律合併；大 blob 排除於快照，改在需要時**向自己其他裝置** backfill。
- **C. 逐筆增量廣播**：每次庫變更發一顆自封事件。增量省頻寬，但漏收需全量對帳退路，狀態機較複雜。列為後續優化。

## 決策（採 B）

### 1. 庫（`customAssets`）走加密雲端快照
`CloudSnapshotContent` 增加 `customAssets`（ADR-0071 同機制、同交換律合併）：
- 每筆帶 `{id, shortcode, label, kind, format, mine}`；**小圖帶行內 `svg`**（可直接渲染/送出）；**大 raster 只帶 `ref`**（blob 另同步）。
- **位元組預算**：沿用快照 180KB 明文預算——庫與訊息共用；累計超限即以「最愛→自建（`mine`）→最近」優先取前綴（其餘該裝置仍可事後 backfill／再匯入）。超大庫的分片留後續。
- **合併語意（交換律，鏡像 ADR-0221 `acquireAssets`）**：以 `id`（內容雜湊）去重補回；**本地 `mine`／最愛不被覆蓋**；shortcode 衝突保留本地（ADR-0221 H2）。

### 2. blob（`assetBlobs`）排除於快照，改「向自己 backfill」
- `assetBlobs` **不進快照**（體積）。
- 擴充 ADR-0223：**允許 `ASSET_REQUEST` 定址給自己 pubkey**（自封副本送達自己各裝置），且 `sendAssetBlob` **對 `sender === self.pubkey` 亦回應**（目前僅回應聯絡人）。
- 裝置 B 有庫的 `ref` 但快取無 blob（來自快照同步或自封訊息）→ 向**自己**索取 → 任一持有該 blob 的自家裝置回傳 → B 驗整合性入快取、重繪。`expectedBlobs`/`sentBlobs`／節流沿用。

### 3. 觸發時機
- **庫**：開機收快照即合併；本機庫變更（匯入/收藏/改短碼/刪除）後 debounce 重發快照（沿用 ADR-0071 節流）。
- **blob**：渲染/送出遇到「有 `ref` 無 blob」時，若寄件者是自己或該資產屬自己庫 → `requestAsset(self.pubkey, ref)`。

### 4. 刪除傳播：墓碑（tombstone，LWW 交換律）
「補缺不覆蓋」無法傳播刪除（A 刪的會被 B 快照補回）。改採**墓碑＋最後寫入者勝（LWW）**，仍維持交換律：

- **時間戳**：`customAssets` 每筆帶 `at`（加入／最後更新毫秒）；刪除時寫一筆墓碑 `{ id, at }` 到新的 `assetTombstones`（`id`＝內容雜湊）。墓碑與庫**一同存進 AppStorage、一同隨快照同步**。
- **合併語意（取代原「補缺不覆蓋」）**：對同一 `id`，比較「該資產最新 `at`」與「該 id 最新墓碑 `at`」，**較大者勝**——墓碑較新＝刪除、資產較新＝復活。故**重新匯入同一資產（同 id）其 `at` 自然大於舊墓碑 → 自動復活**，無需特別處理。不管幾台、什麼順序合併，結果一致。
- **範圍界定**：跨裝置同步僅在**同一使用者自封快照**之間；墓碑因此**只在你自己的裝置間生效**，不影響其他使用者——別人是經訊息 `acquireAssets`（ADR-0221）收藏，走不同路徑、不受你的墓碑影響。
- **`mine`／最愛保護仍在**：保護的是「別台補缺時不覆蓋本地的自建/最愛旗標」，**不是「不可刪」**；使用者主動刪自己的資產＝合法（寫墓碑）。
- **上限**：`ASSET_TOMBSTONE_MAX`（例如 128）FIFO 淘汰最舊。殘留風險：極舊墓碑被淘汰後，若一台離線甚久、仍持該舊資產的裝置才上線，可能復活該資產（罕見、可接受，使用者再刪一次即可）。

### 5. 佔位與優雅降級（容許無檔案／來源離線）
「有 `ref` 無 blob」是**正常過渡態、不是錯誤**，一律優雅降級、不阻塞：

- **渲染**：顯示佔位（沿用 ADR-0223 P2a 的 pending span／占位方塊），可帶短碼或 `label` 讓使用者知道那是什麼、正在載入；背景同時發 `requestAsset`。
- **來源皆離線／逾時**：**維持佔位、不報錯、不阻塞** UI；任一持有 blob 的裝置上線並回應後，`onAssetCached` 觸發重繪、佔位換成實圖（可經 relay 1059 信箱離線儲轉，先上線的裝置先補）。
- **送出**：不因「自己另一台暫時沒 blob」而失敗——訊息照送（帶 `ref`），blob 事後補齊。收送兩端都不會因缺檔而中斷主流程。

## 理由

- B 幾乎不新增機制：庫搭上既有交換律快照、blob 搭上既有 backfill（僅放行自我定址）。
- blob 排除於快照＝不撞 180KB/256KB 上限；on-demand 只在真的要用時才拉、且只拉一次（入快取）。
- 交換律合併與 `mine`/最愛保護已在 ADR-0221 驗證，語意一致、多裝置任意順序合併結果一致。

## 後果

- **正面**：多裝置間 emoji 庫一致、大 GIF blob 隨用隨拉；補完 ADR-0223 唯一缺口。
- **刪除已可傳播（墓碑）**：LWW＋墓碑取代「補缺不覆蓋」，A 刪的不再被 B 補回；重新匯入自動復活。**殘留**：墓碑上限淘汰後的極端復活（見決策 4，罕見、可接受）。
- **無檔案／來源離線已優雅降級**：缺 blob 時顯示佔位、背景索取、上線即補（見決策 5），收送主流程都不中斷——這是**接受的行為，非錯誤**。
- **快照預算競爭**：庫（＋墓碑）與訊息共用 180KB；大庫（多小圖）可能截斷 → 該裝置事後 backfill／再匯入補齊。超大庫分片為後續。
- **隱私**：快照與 blob 皆 E2E 加密、僅自封給自己；relay 只見密文。庫內容本就是使用者自有資產。
- **實作階段（TDD）**：
  - **M1（core，快照契約）**：`CloudSnapshotContent` 加 `customAssets`（小圖帶行內 svg、大圖只帶 ref、每筆帶 `at`）與 `assetTombstones`；`buildSnapshotContent` 納入（180KB 預算截斷、剝除大 blob 只留 ref）；`mergeSnapshotContent` 以 **LWW＋墓碑** 合併庫（`mine`/最愛保護、shortcode 衝突保留本地）＋測試。
  - **M2（engine，自我 backfill）**：`requestAsset` 放行自我定址、`sendAssetBlob` 回應 `sender===self`、`receiveDm` 的 `ASSET_REQUEST` 分支允許 self；庫變更後 debounce 重發快照＋測試。
  - **M3（desktop，觸發＋墓碑＋佔位）**：遇「自封/自庫 `ref` 無 blob」→ `requestAsset(self, ref)`；刪除資產寫墓碑；佔位 UX 沿用 P2a；設定同步。
  - **收尾**：同步 `ARCHITECTURE.md`（快照契約新增 customAssets/assetTombstones、blob 自我 backfill）；三層測試綠後轉「已接受」。
  - **仍列後續**：增量廣播（選項 C）、超大庫分片、墓碑上限的更精緻淘汰。

## 實作註記（2026-07-21，已落地）

- **M1（core／engine，commit aa390aa）**：`CustomAsset.at`、`AssetTombstone`／`ASSET_TOMBSTONE_MAX`、`mergeAssetLibrary`（LWW＋墓碑交換律，mine/最愛保護）；`CloudSnapshotContent.customAssets`＋`assetTombstones`（90KB 子預算、mine 優先截斷、大圖只帶 ref）、build/parse/merge；AppStorage `load/saveAssetTombstones`（MemoryStorage／LocalStorage 加密／TauriStorage）。
- **M2（engine，commit 9025159）**：`sendAssetBlob` 放行 `sender===self`＝向自己 backfill；`resyncAssets()`（庫變更重發快照，搭 ADR-0071 節流）。
- **M3（desktop，commit 0340251）**：`addSticker/setShortcode` 帶 `at`、`addTombstone`；`deleteCustom` 先記墓碑再存庫；匯入／收藏統一帶 `at`；自庫 `ref` 缺 blob→`requestAsset(self)`；`persistLib`→`onLibraryChanged`→`resyncAssets`。
- 測試：core 383／engine 291／desktop 480 綠；三層 typecheck 綠。**桌面互動（跨裝置實機）待驗收**——自動化只涵蓋純函式與 in-memory 網路 round-trip。
