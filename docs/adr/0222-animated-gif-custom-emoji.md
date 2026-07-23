# 0222. 自訂 emoji 動畫 GIF 支援：raster 渲染路徑＋內容定址傳遞（Model B）

- 狀態：已接受（Phase 1 raster 地基＋Phase 2 Model B 內容定址傳遞皆已實作，見 ADR-0223；跨裝置由 ADR-0224 補齊）
- 日期：2026-07-21
- 相關文件：ADR-0220（統一自訂資產）、0221（審查修正）、0093（檔案 P2P 傳遞與持久化）、0102（圖片縮圖）、0032（自製貼圖 SVG）、0043（動態貼圖 reduced-motion）、0042（自製貼圖容量限制）

## 背景與問題

slackmojis.com 等站的主打是**動畫 GIF**（跳舞 blob、party-parrot…）。ADR-0220 的自訂 emoji 目前無法保留動畫：

- **匯入**：任何非 SVG 圖 → `createImageBitmap` ＋ `<canvas>` **只取第一幀** → 靜態 WebP → 包成 SVG（`wrapRasterAsSvg`）。動畫必然遺失。
- **渲染**：一律 `svgToDataUri` → `<img src=data:image/svg+xml>`（SVG secure static mode）。
- **傳遞**：走 `nb-assets:v1:` 行內清單，受 NIP-44 明文 65535／清單 48 KiB／每筆 SVG 32 KiB 上限。

兩道本質障礙：

1. **渲染**：GIF 要動，必須以 raster `<img src=data:image/gif>` **直接**渲染；包進 SVG-in-`<img>`（secure static mode）不保證播放、且徒增體積。App 內建「動態」貼圖是 **SVG CSS keyframes**，非 raster 逐幀——兩套不同機制。
2. **傳遞＋轉碼**：動畫 GIF 常 50–500 KB，**塞不進單則 65535 明文清單**；且瀏覽器**無原生動畫 WebP／APNG 編碼器**（`canvas.toDataURL` 只出靜態、`MediaRecorder` 出的是影片），要「縮小成小動畫圖」得引入 WASM 編碼器（重依賴），且多數仍超預算。

## 考量的選項

- **A. GIF 內嵌 SVG**（`wrapRasterAsSvg(gifDataUri)`）：secure static mode 下多半不動、且原始 GIF 常撞 32 KiB SVG 上限。**否決**。
- **B. Raster 資產型別 ＋ 直接 `<img>` 渲染**（會動）；小尺寸走 inline 清單、大尺寸走**內容定址 P2P blob（Model B，複用 ADR-0093）**。既有檔案附件即以 `<img src=url>` 渲染、GIF 會動——證明此路可行。
- **C. 匯入時 WASM 轉碼**縮成小動畫 WebP 塞 inline：需重依賴、且多數 slackmojis GIF 仍超預算。**列為非必要**。

## 決策（採 B，分兩階段）

1. **資產模型加 `format`**：`CustomAsset` 加 `format?: "svg" | "raster"`（預設 `svg`，向後相容）。`raster` 直接存 `data:image/gif|webp|png|jpeg` data URI（不包 SVG、不 canvas 壓平），保留原動畫。
2. **渲染分路**：`svg` 走現有 `svgToDataUri`；`raster` 直接 `<img class="emoji" src={dataUri}>`（GIF／動畫 WebP 會動）。尊重 reduced-motion（ADR-0043）：偏好降級時可顯示首幀或加暫停（後續細化）。
3. **驗證分路**：`raster` 不套 `validateStickerSvg`（raster 無腳本面）；改 **magic-byte 嗅探**（僅允許 image/gif|png|webp|jpeg）＋尺寸上限（擋非圖 MIME 與超大檔 DoS）。
4. **傳遞兩層**：
   - **Phase 1 行內小 raster**：≤ 清單預算（沿用 48 KiB）者，raster data URI 隨 `nb-assets:v1:` 送、收端行內渲染即動。匯入動畫檔時**不壓平**；原檔 ≤ 預算才可 inline（僅部分小動畫 emoji 適用）。
   - **Phase 2 內容定址（Model B）**：> 預算者（多數 slackmojis GIF），以 `contentHash` 標識、blob 走 **ADR-0093 P2P 通道送一次**、訊息只帶 `nb-assets:v2:{shortcode:hash}` 輕量參照；收端以 hash 快取（加密 AppStorage）、缺 blob 時向對端回填。群組扇出以 blob 去重（送一次 vs 每人一份）——同時解 ADR-0042 的頻寬放大。
5. **匯入**：偵測動畫（多幀）→ 保留原位元組走 raster 路徑；靜態圖沿用現有 64px 壓平 SVG 路徑（體積最小）。批次匯入（ADR-0220）同套。

## 理由

- 直接 `<img>` 是唯一可靠讓 GIF 動的方式（既有檔案附件即這樣渲染）。
- 動畫 GIF 體積本質超 inline 上限 → **內容定址 ＋ P2P blob（Model B）是唯一**能送大檔又不撞明文上限的路；ADR-0093 通道已存在，Model B 同時解掉 ADR-0042 群組扇出放大與 ADR-0220 對大自訂資產的頻寬顧慮。
- 轉碼縮小無原生 API、依賴重，不列為必要路徑。

## 後果

- **正面**：slackmojis 動畫 GIF 可用（Phase 2 後任意大小）；Model B 順帶省頻寬、跨資產去重。
- **負面／已知殘餘風險**：
  - **Model B 是大協定變更**：blob 快取、缺圖回填、群組去重、加密落地、跨裝置同步、外送匣節流——工程量大、屬紅線敏感（不可弄丟或洩漏）。
  - raster 少了 `validateStickerSvg` 那層，改靠 magic-byte ＋尺寸；raster 本無腳本面，但仍須擋超大檔（DoS）與非圖 MIME、並注意記憶體（多動圖同屏）。
  - **Phase 1 對「多數 slackmojis GIF 太大」幫助有限**——真正可用要等 Phase 2。
  - 無障礙（reduced-motion）與效能（同屏多動圖、GIF 解碼）需處理。
- **後續行動／待辦**：
  1. **Phase 1**（地基，✅ 已實作）：`CustomAsset.format`、raster 渲染分路（直接 `<img>` 會動）、magic-byte 驗證＋尺寸上限（inline 48 KiB）、匯入 GIF 保留原位元組、inline 小 raster 送/收/自動收藏＋渲染；core 362＋desktop 472 綠。**殘留**：reduced-motion 對 GIF 尚未凍首幀（GIF 無法以 CSS 暫停，需 canvas 取首幀，後續）。
  2. **Phase 2**（Model B）：`nb-assets:v2:` 參照格式、內容定址 blob store（接 ADR-0093 sendFile/onFileBytes）、收端 hash 快取＋回填＋群組去重；另可拆獨立 ADR。
  3. 實作時同步 `ARCHITECTURE.md`（新增 raster 資產與 `nb-assets:v2:` 契約）；**實作＋測試落地後轉「已接受」。**
