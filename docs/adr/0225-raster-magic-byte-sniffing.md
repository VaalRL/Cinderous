# 0225. Raster 資產 magic-byte 內容嗅探

- 狀態：已接受
- 日期：2026-07-21
- 相關文件：ADR-0220（統一自訂資產）、0222（動畫 GIF raster）、0223（內容定址 blob）、0221（審查修正：不信任對端）、sticker-svg（SVG 拒收制 `validateStickerSvg`）

## 背景與問題

自訂資產匯入與收端對 **raster**（GIF/PNG/WEBP/JPEG）的把關，目前只有 `isValidRasterDataUri`：

```
/^data:image\/(gif|png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/
```

它只檢查 **data URI 宣告的 MIME 字串＋base64 字元合法性＋尺寸**，**不讀實際位元組**。後果：

- 一個把副檔名/`f.type` 改成 `image/gif`、但內容不是 GIF 的檔，會通過驗證入庫、也能經清單送給對端。
- **不對稱**：SVG 走的是內容層安全驗證（`validateStickerSvg` 拒收 `<script>`、`javascript:`、`<foreignobject>` 等），raster 卻只有「宣告層」。

raster 沒有腳本面（`<img src=data:>` 解不出就是壞圖，非 XSS），故這不是安全漏洞；但「宣告與內容可不符」是格式正確性與一致性的缺口，值得補齊。

## 決策

新增 `rasterMagicOk(dataUri)`：**解碼 base64 前綴、取前 12 bytes、比對該型別的 magic-byte**，要求**宣告 MIME 與實際 magic 一致**。

- Magic：GIF＝`47 49 46 38`（"GIF8"）、PNG＝`89 50 4E 47`、JPEG＝`FF D8 FF`、WEBP＝`52 49 46 46`（RIFF）＋ byte 8–11＝`57 45 42 50`（"WEBP"）。
- 解碼用**手寫極簡 base64 前綴解碼**（只解需要的前 12 bytes），**不引入 `atob`／`Buffer`**——避免 node／瀏覽器環境差異，純函式、可完整於 node 測試。
- **Fix First 串進既有 `isValidRasterDataUri`**：`RASTER_DATA_URI.test(...) && rasterMagicOk(...)`。所有呼叫端——匯入（desktop `addRaster`／`addSticker` raster 分支）、**收端 `parseAssetManifest`**（不信任對端，ADR-0221）——一次全部升級，不建平行路徑。
- `detectRasterType` **維持只看宣告**（供渲染分流用），驗證責任集中在 `isValidRasterDataUri`。

## 理由

- 把 raster 從「宣告層」升到「內容層」，與 SVG 的內容驗證對齊；擋掉偽裝副檔名/MIME 的檔。
- 串進單一驗證函式＝匯入與收端同步受惠，零散不掉。
- 純函式、無新外部依賴、只解前 12 bytes（效能可忽略）。

## 後果

- **正面**：宣告 MIME 與實際位元組一致；偽裝檔在匯入與收端都被擋；raster 與 SVG 驗證嚴格度對齊。
- **中性／已知邊界**：
  - **blob（`assetBlobs`）不經此檢查**：大 blob 走 backfill、以 `contentHash` 整合性防掉包（ADR-0223），維持原樣（不重複驗、省成本）。
  - 極短／被截斷、前 12 bytes 不足者會被拒（罕見，可接受——正常圖檔標頭遠長於此）。
  - 仍非唯一安全防線：raster 本無腳本面，此為**健壯性與一致性**強化。
- **測試**：core／engine／desktop 既有 raster fixture 皆用真 GIF89a（`R0lGODlh…`）或 `ref`，不受影響；新增涵蓋各型別真/假 magic 的單元測試。
