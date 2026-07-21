# 0224. 跨裝置自訂資產同步（emoji／貼圖庫與 blob）

- 狀態：提議中
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

## 理由

- B 幾乎不新增機制：庫搭上既有交換律快照、blob 搭上既有 backfill（僅放行自我定址）。
- blob 排除於快照＝不撞 180KB/256KB 上限；on-demand 只在真的要用時才拉、且只拉一次（入快取）。
- 交換律合併與 `mine`/最愛保護已在 ADR-0221 驗證，語意一致、多裝置任意順序合併結果一致。

## 後果

- **正面**：多裝置間 emoji 庫一致、大 GIF blob 隨用隨拉；補完 ADR-0223 唯一缺口。
- **負面／已知殘餘風險**：
  - **刪除不傳播**：交換律「補缺不覆蓋」下，A 刪的 emoji 會被 B 的快照重新補回。需**墓碑（tombstone）**才乾淨（列後續；短期可接受＝刪除僅本機）。
  - **blob 需來源在線**：向自己 backfill 需另一台有該 blob 的裝置在線（或經 relay 信箱儲轉，1059 已支援離線）。皆離線時維持占位，待任一裝置上線補齊。
  - **快照預算競爭**：庫與訊息共用 180KB；大庫（多小圖）可能截斷 → 該裝置事後 backfill／再匯入補齊。超大庫分片為後續。
  - **隱私**：快照與 blob 皆 E2E 加密、僅自封給自己；relay 只見密文。庫內容本就是使用者自有資產。
- **後續行動／待辦**：
  1. core/engine：`CloudSnapshotContent.customAssets`（帶預算截斷＋交換律合併，鏡像 acquireAssets）＋測試。
  2. engine：`ASSET_REQUEST` 放行自我定址、`sendAssetBlob` 回應自己；desktop 於自封/自庫 `ref` 觸發 `requestAsset(self, ref)`。
  3. 後續：刪除墓碑、增量廣播（選項 C）、超大庫分片。
  4. 實作時同步 `ARCHITECTURE.md`（快照契約新增 customAssets、blob 自我 backfill）；落地＋測試後轉「已接受」。
