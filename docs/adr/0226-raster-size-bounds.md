# 0226. Raster 資產尺寸把關（blob 位元組上限＋GIF 像素上限）

- 狀態：已接受
- 日期：2026-07-21
- 相關文件：ADR-0223（內容定址 blob）、0222（動畫 GIF raster）、0220（統一自訂資產）、0225（magic-byte 嗅探）、0221（不信任對端）

## 背景與問題

ADR-0223 的 blob 傳輸有上限（`ASSET_CHUNK_CHARS 48000` × `ASSET_CHUNK_MAX_TOTAL 64` ≈ 3MB，收端 `parseAssetChunk` 驗 `total>64` 即丟棄），但**產生端沒有對齊的上限**：

- `addRaster`（desktop）「≤48KB 行內、否則存 blob」那條**不限 blob 大小**——一個 5MB GIF 本機存得下、也送得出，但對端每塊 `total>64` 全丟棄 → **本機成功、對端靜默失敗**（對方永遠占位、你卻不知）。
- GIF **保留原位元組、不解碼**，故**像素寬高不受限**（非 GIF 匯入時已 `createImageBitmap`→canvas 正規化到 64/256）；巨大像素 GIF 可撐爆 UI/記憶體。

## 決策

### 1. 單顆 blob 位元組上限 `BLOB_MAX_BYTES`
- 定義於 `asset-relay.ts`：`BLOB_MAX_BYTES = ASSET_CHUNK_CHARS × ASSET_CHUNK_MAX_TOTAL`（＝可在分塊上限內送達的最大字元數）。
- **產生端（desktop `addRaster`）**：存 blob 前超過即**拒收**（`too-large`）——把「靜默失敗」變「當下就知道太大」。
- **送端（engine `sendAssetBlob`／`pushReferencedBlobs`）**：`blob.data.length > BLOB_MAX_BYTES` 即**不送**（避免對超大 blob 做註定被丟棄的無效傳輸），並保留占位。

### 2. GIF 像素上限 `RASTER_MAX_EDGE`
- 定義於 `custom-assets.ts`：`RASTER_MAX_EDGE`（GIF 寬或高的像素上限）。
- `gifDimensions(dataUri)`：解 GIF **Logical Screen Descriptor**（byte 6–7 寬、8–9 高，little-endian；沿用 ADR-0225 的 `firstBytes`，不用 atob/Buffer）；非 GIF 或讀不到回 null。
- `rasterWithinPixelBounds(dataUri, maxEdge)`：**只對 GIF** 比對寬高上限；**非 GIF 一律 true**（已 canvas 正規化，不適用）。
- 串接：匯入（desktop）、收端行內（`parseAssetManifest` raster 分支）、收端 blob（engine `receiveAssetChunk` 重組後）皆擋超大像素 GIF。

## 理由

- 產生端上限與傳輸能力對齊＝**消除跨裝置/跨聯絡人的靜默失敗**（ADR-0223 唯一漏的洞）。
- GIF 是唯一保留原尺寸的型別，補像素上限與非 GIF 的正規化「對齊嚴格度」。
- 純函式、無新依賴（沿用 ADR-0225 `firstBytes`）；上限集中於 core 常數，desktop/engine 共用不漂移。

## 後果

- **正面**：超大 GIF 匯入當下即被擋（明確提示）、送端不做無效傳輸、對端不再靜默占位；巨大像素 GIF 擋於匯入與收端。
- **中性／邊界**：
  - 上限為權衡值——`BLOB_MAX_BYTES`≈3MB（＝傳輸能力）、`RASTER_MAX_EDGE` 取足夠涵蓋貼圖用途的緩衝。
  - 舊資料若已存超大 blob：送端會擋（不送）＝維持占位（比靜默丟棄好，本機仍可見）。
  - 像素上限**僅 GIF**；PNG/WEBP/JPEG 匯入時已正規化，收端行內亦 ≤48KB。
  - blob 位元組上限只在**產生端/送端**；收端本就受 `ASSET_CHUNK_MAX_TOTAL` 隱含限制（≤64 塊）。
- **測試**：core 純函式（`gifDimensions`／`rasterWithinPixelBounds`／`BLOB_MAX_BYTES`）＋engine（送端擋超大、收端像素丟棄）＋desktop（`addRaster` 拒收）。
