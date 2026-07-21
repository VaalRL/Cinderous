# 0223. 自訂 emoji 內容定址 blob 傳遞（Model B，ADR-0222 Phase 2 細部設計）

- 狀態：提議中（P2a 已實作；P2b 首次推播/離線/群組已實作，跨裝置待）
- 日期：2026-07-21
- 相關文件：ADR-0222（動畫 GIF／Phase 1）、0220（統一自訂資產）、0221（審查修正）、0093（多裝置投遞與檔案持久化）、0017（WebRTC 檔案傳輸）、0124（群組檔案）、0162（org relay 檔案 `FILE_WRAP`）、0042（自製貼圖容量限制）、0054/0112（加密落地）

## 背景與問題

ADR-0222 Phase 1 讓**小**（≤48 KiB）動畫 GIF emoji 能行內（`nb-assets:v1`）送/收/渲染，但受 NIP-44 明文 65535 上限，**多數 slackmojis GIF（50–500 KB）匯入時就被擋**。要支援任意大小，須把「圖」與「訊息」拆開——圖走 out-of-band、**送一次**、訊息只帶輕量參照（Model B）。本 ADR 定其協定細節。

**可複用的既有件**：
- `file-relay.ts`：加密分塊檔案走 relay 信箱（`KIND.FILE_CHUNK=43` / 外層 `FILE_WRAP=1060`，ADR-0162），**儲轉、離線可達**，每塊 ≤48 KB、上限 ~16 MB、自帶 `contentHash` 整合性。
- `sendFile`（P2P WebRTC，ADR-0017/0093）：線上直傳。
- 群組檔案（ADR-0124）：對話鍵＝groupId。
- **customAssets 庫已內容定址**（`id=contentHash`，ADR-0220）。

## 考量的選項

- **A. 純推播**（送訊息時一律附 blob）：等於 Phase 1，撞上限。**否決**。
- **B. 純拉取／backfill**（收端見參照才向寄件者要 blob）：省頻寬、跨裝置穩健，但首次渲染有一次來回延遲。
- **C. 推播（首次用）＋ backfill 後援**（採用）：寄件者對某對象首次用某 emoji 時樂觀推 blob（線上 P2P／離線 relay 信箱），收端缺圖再 backfill。首次即時、又有穩健後援。

## 決策（採 C）

### 1. 參照格式（精修 ADR-0222 的 `v2`）
沿用 `nb-assets:v1:` 清單，**entry 增加可選 `ref`（blob 的 `contentHash`）**：
- 行內小資產：`{label, svg, format?}`（不變）。
- 大 raster 參照：`{label, ref: <hash>, format: "raster"}`（**無 `svg`**）。
一則訊息可混用。**向後相容**：不懂 `ref` 的舊版 client 見「無 `svg`」→ 丟棄→顯示字面（同 v1 取捨），不需新 prefix。

### 2. 內容定址 blob 快取（新，獨立於 32 張策展庫）
新增 `assetBlobs`：`hash → { mime, bytes }`，**加密落地**（AppStorage 新分部，比照 customAssets）、**LRU（較大容量，如 64 顆／N MB）**。
- 大 raster 的 `CustomAsset` 加可選 `ref: hash`（內容在 `assetBlobs`，非行內 `svg`）。
- 渲染解析：`ref` → `assetBlobs[hash]` → `<img src=data:...>`（會動）。
- 收到的 blob 進 `assetBlobs`（**不佔**策展庫 32 上限）；使用者「收藏」才升為庫內具名 emoji。

### 3. 傳遞
- **首次推播**：寄件者維護 per-對象（聯絡人/群組）「已送 hash」集合；訊息引用到對象尚無的 blob 時推一次——線上走 `sendFile`（P2P）、離線/org 走 `FILE_CHUNK`/`FILE_WRAP` relay 信箱（儲轉）。群組**只送一次**（ADR-0124），成員各自快取——**同時解 ADR-0042 群組扇出放大**。
- **缺圖 backfill**：收端渲染 `ref` 時若 `assetBlobs` 無此 hash → 送 **`KIND.ASSET_REQUEST`（新 app rumor kind 44，Gift Wrap）** 給**該訊息寄件者**、帶 hash → 寄件者回 blob（同上通道）；收端快取後重繪。
- **整合性**：收端一律驗 `contentHash(收到位元組) === 參照 hash`，不符即拒（防惡意寄件者/中繼掉包）。

### 4. 渲染狀態機（每個 `ref`）
`resolved`（快取有）→ 渲染動畫｜`missing` → 觸發 backfill → `pending`（占位：淡色 `:shortcode:` 或小轉圈）→ 到貨 `resolved`｜`failed`（backfill 逾時/寄件者不可達）→ 退回字面文字。

### 5. 限制與防濫用
- **單顆 blob 上限**（如 2 MB；emoji 不應巨大，遠低於 16 MB 檔案上限）。
- `assetBlobs` LRU（顆數＋總位元組）；受保護＝自建（`mine`）。
- **backfill 節流**：每 hash 單一在途請求＋退避；**只向該訊息寄件者**請求（不對任意 peer）；防放大 DoS。
- 自動收藏收到的大 emoji 受信任來源閘（ADR-0221）＋快取 LRU 管控。

## 理由

- C 兼顧首次即時與跨裝置/離線穩健；blob 通道（`file-relay`/`sendFile`）與內容定址（customAssets）皆已存在，改動集中在「參照＋快取＋backfill」。
- 內容定址天然去重、整合性、零伺服器明文；群組送一次直接解 ADR-0042。

## 後果

- **正面**：任意大小動畫 GIF emoji 可用；群組/重複使用大幅省頻寬；blob 加密落地。
- **負面／風險（紅線敏感）**：
  - 新協定面（推播集合、backfill 請求/回應、狀態機、群組去重、跨裝置）＝**大工程且不可弄丟/洩漏**；需完整測試（傳遞/整合性/節流/加密/群組）。
  - 首次或缺圖有渲染延遲（占位→到貨）。
  - 跨裝置：自己的大 emoji blob 需能從任一裝置送出——metadata（庫）走既有多裝置同步，blob 以「向自己 backfill」或多裝置投遞（ADR-0093）補齊（細節待 P2b）。
  - backfill 洩漏「我收到你訊息但沒這顆 emoji」給寄件者（輕微、寄件者本知情）。
- **後續行動／待辦（Phase 2 分段）**：
  1. **P2a**（✅ 已實作）：`assetBlobs` 加密快取＋`ref`（庫/清單/CustomAsset）＋由 blob 渲染＋整合性驗證＋1:1 backfill（`ASSET_REQUEST`/`ASSET_CHUNK`，外層皆 Gift Wrap 1059 經 receiveDm）＋pending 占位＋觸發/重繪。core 374＋engine 281＋desktop 475 綠。**實作註**：`ASSET_CHUNK` 未用 `FILE_WRAP` 外層（測試網不路由；改與請求同走 1059，emoji blob 為有界 backfill 流量、共用 DM 路徑可接受）。
  2. **P2b**（部分實作）：✅ **首次推播**（送訊息時把引用到的 blob 主動推給對象/群組成員，per 對象去重 `sentBlobs`；對端以「訊息曾引用」`expectedBlobs` 接受主動推播、免等 backfill 往返）；✅ **離線信箱**（`ASSET_CHUNK` 走 1059＝離線 DM 信箱，儲轉可達）；✅ **群組**（逐成員推播＋各自快取，refs+backfill 已給 ADR-0042 省頻寬）。⏳ **跨裝置**：使用者自己的 `customAssets`／`assetBlobs` 尚未跨裝置同步——他裝置無該 emoji 庫/blob，須另做裝置同步（後續）。engine 282 綠。
  3. 匯入：放開 Phase 1 的 48 KiB 硬擋——大 GIF 存 `assetBlobs`＋庫記 `ref`（可自用/預覽/送出）。
  4. 實作時同步 `ARCHITECTURE.md`（`assetBlobs` 分部、`ref` 清單契約、`ASSET_REQUEST` kind）；落地＋測試後轉「已接受」。
