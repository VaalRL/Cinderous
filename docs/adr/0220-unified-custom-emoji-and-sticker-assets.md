# 0220. 統一自訂資產（emoji＋貼圖）：共用模型、收到自動收藏、加密本地庫

- 狀態：提議中
- 日期：2026-07-20
- 相關文件：ADR-0021（貼圖）、0032（自製貼圖）、0033（貼圖編輯器）、0037（貼圖文字觸發）、0042（自製貼圖容量限制）、0043（動態貼圖規範）、0054（加密儲存基質 AppStorage）、0093（檔案附件 P2P）、0219（可換式同步 KV）、0027/0041（群組扇出／外送匣節流）

## 背景與問題

現況盤點：

- **自製貼圖（ADR-0032）已完整**：`nb-sticker:v2:{label,svg}` 內容隨訊息、E2E、收端渲染；桌面有編輯器（0033）、庫（`sticker-library.ts`，key `nb.stickers.custom`，`LIBRARY_MAX=32`，以 `contentHash` 去重）、匯入（`wrapRasterAsSvg` 吃 `data:image/*`、`validateStickerSvg` ＋ `STICKER_SVG_MAX_BYTES=32 KiB`）、收藏（`acquireSticker`：匯入／fork／點擊收藏共用一條寫入路徑）。
- **Emoji 目前只有 emoticon 短碼**（`emoticons.ts`，`:)`→🙂，固定 Unicode 對照），**無使用者自訂**。
- **需求**：仿 Slack 引入**自訂 emoji**（`:shortcode:` → 行內小圖、可上傳 PNG／GIF／JPG），且「接受過的人直接擁有、桌面存本地」。

問題與限制：

1. **是否另立一套 emoji 管線**，還是與貼圖共用？兩者在資產層是同一種東西——**帶標籤的圖片 blob**——只差**渲染用法**（整則大圖 vs 行內小圖）與**觸發方式**（挑選器 vs `:shortcode:`）。另立 `v2` 平行路徑違反 Fix-First 與 SSOT。
2. **去中心化沒有中央目錄**：Slack `:name:` 靠工作區伺服器解析；Cinderous 零伺服器狀態，`:name:` 對「沒有該資產的收件人」是死字。
3. **儲存不一致**：貼圖庫**直接寫 `localStorage`**（`nb.stickers.custom`），繞過 ADR-0219 的 `getKv()` 抽象，也未用 ADR-0054 的加密 AppStorage；webview `localStorage` 為**明文**、容量約 5 MB，emoji 數量一多即撞牆。
4. **收藏是手動**（收到自製貼圖需點「收藏」才進庫）；使用者希望「**接受過即擁有**」。
5. **頻寬**：內容隨訊息在群組**對每位成員各扇出一份**（ADR-0042）；emoji 使用頻率遠高於貼圖，放大更嚴重。

## 考量的選項

**自訂 emoji 傳遞模型（去中心化下如何讓對方也看得到）**

- **A．行內內嵌**：訊息帶一份「本則用到的資產清單」（blob 隨訊息），收端一定看得到。簡單、複用 v2 樣板、與「收到即擁有」天然相容。代價＝每次用都重送 blob（頻寬）。
- **B．內容定址**：資產以 `contentHash` 標識，首次送 blob（可走 ADR-0093 的 P2P out-of-band 通道），之後只送 `:hash:` 參照，收端快取。省頻寬，但要 blob 快取＋缺圖回填＋「對端是否已有」的協定升級。
- **C．org 共用集**：以已簽章 org-roster 分發共用 emoji 目錄，成員隨 roster 下載一次。精準複刻 Slack「工作區 emoji」，但僅限 org 情境。

**收藏**：手動（現況，點擊收藏）／**自動收藏**（收到即入庫）。

**本地儲存**：續用 `localStorage`（明文、容量小）／**加密 AppStorage（ADR-0054）** ＋ web 走 `getKv()`（0219）／使用者可見檔案（`save-file.ts`，明文）。

## 決策

1. **統一資產模型**：把 `CustomSticker` 升為 `CustomAsset { id: contentHash, label, svg, kind: "sticker" | "emoji" | "both", shortcode? }`。**匯入／驗證（`validateStickerSvg` ＋ 32 KiB）／去重（`contentHash`）／庫／收藏全共用**。差異只在薄薄一層「用法」：
   - **貼圖**：整則 `nb-sticker:v2:`（不變）、大尺寸、挑選器點選。
   - **emoji**：有 `shortcode`、行內小尺寸、打 `:shortcode:` 插入；訊息以**行內資產清單**承載（見 2）。
   - 一顆資產可 `kind:"both"`：既能當貼圖送、也能當 emoji 打。

2. **傳遞採 Model A（行內內嵌）為出貨型態**：訊息內容尾端附一段**分隔的資產清單** `nb-assets:v1:<JSON>`，JSON 為 `{ [hash]: { label, svg } }`，**只含本則文字實際引用的資產**；文字內以 `:shortcode:` 引用，**解析順序＝本則清單（依 shortcode／hash）→ 本機庫 → 保留原字**（未知則顯示字面，優雅退化）。emoji 匯入時**降尺寸至 ≤64px**，使多顆仍安全落在 NIP-44 明文上限（65535）內，並設**每則資產預算**（清單總量 ≤ 48 KiB，超出則拒送並提示）。**Model B（內容定址省頻寬）與 C（org 共用集）列為後續 ADR。**

3. **收到自動收藏**：收端解出 `nb-assets:v1:` 的資產後，**自動 upsert 進本機庫**（`contentHash` 去重），不需點擊。防濫用護欄：
   - **僅信任來源自動收藏**（已在通訊錄／已接受的聯絡人與其群組）；**非信任來源＝不自動、維持點擊收藏**。
   - 尊重 `LIBRARY_MAX=32`：自動收藏採 **LRU 淘汰未加入最愛者**（最愛／自建永不淘汰）；淘汰只影響本機庫，**不影響已收到訊息的渲染**（該則自帶清單）。
   - 企業 `disableStickers` 政策仍為總閘（關閉＝不渲染、不收藏、不可送）。
   - 設定頁提供「自動收藏自訂 emoji／貼圖」開關（預設**開**、限信任來源）。

4. **加密本地庫**：庫改走**儲存基質抽象**——
   - **桌面**：接入 ADR-0054 加密 AppStorage（Rust AES-256-GCM 落地、防抖持久化），新增資產儲存分部（part）；**加密落地**、不受 `localStorage` 容量限制。
   - **web／RN**：走 ADR-0219 `getKv()`（`localStorage`／IndexedDB 回退）。
   - **一次性遷移**舊 `nb.stickers.custom`（`localStorage`）→ 新儲存。
   - **「使用者可見的檔案」另做匯出**（`save-file.ts`，明示是明文落地），非主儲存。

## 理由

- **共用而非平行**：emoji 與貼圖資產同源，統一符合 Fix-First 與 SSOT；`wrapRasterAsSvg`／`validateStickerSvg`／`contentHash`／`acquireSticker` 已驗證可靠，直接複用而非再造。
- **Model A 先行**：唯一能同時滿足「零伺服器」「收到即擁有（bytes 必到）」「最小協定改動（延伸既有內容隨訊息）」；B 雖省頻寬但需「對端已有」的協定升級（ADR-0042 已列為後續），A→B 是自然演進而非返工。
- **降尺寸＋每則預算**：emoji 只需小圖，64px 通常 <10 KiB，讓「行內多顆」與 NIP-44 明文上限並存；預算硬擋一則塞爆扇出。
- **自動收藏＋信任閘**：滿足「接受過即擁有」，同時以信任來源＋LRU＋企業閘擋洗版與容量爆炸。
- **加密 AppStorage**：貼圖／emoji 屬使用者內容，明文躺 `localStorage` 與「明文不上雲、隱私預設」精神不符；ADR-0054 已提供同步介面的加密落地，零後端改動即可加密；web／RN 以 0219 抽象保持可移植。

## 後果

- **正面**：
  - 一套資產模型服務 emoji＋貼圖；收到即擁有、桌面加密落地。
  - Slack 圖片格式（PNG／JPEG／GIF ＋ 既有 avatar 已收 WebP）經現成 `wrapRasterAsSvg` 相容；動畫走既有 reduced-motion 護欄（ADR-0043）。
  - 批次匯入資料夾 `name.ext` → `:name:` 直接對應現有 `addSticker` 流程；亦可支援 Slack 匯出的 `name→檔` 清單。
- **負面／已知殘餘風險**：
  - **頻寬**：Model A 每次用都重送 blob，群組 ×N 放大；靠降尺寸＋每則預算＋外送匣節流（ADR-0041）緩解，根解待 Model B。
  - **向後相容**：不解析 `nb-assets:v1:` 的舊版 client 會把清單顯示為尾端字面文字（與 `nb-sticker:v2:` 貼圖同類取捨）；以不易誤觸的分隔前綴降低視覺干擾，長期可改走事件 tag。
  - **shortcode 碰撞**：不同來源同名 `:blob:` 以 `hash` 區分（本則清單優先），但 UI 顯示同名需標示來源／預覽。
  - **自動收藏觀感／隱私**：即便信任來源，庫會被動增長；以開關＋LRU＋最愛保護處理。
  - **明文上限**：單則資產總量受 65535 限制＝一則能放的 emoji 有限（預算硬擋、超出拒送）。
- **後續行動／待辦**：
  1. **core**：`CustomAsset` 型別；`nb-assets:v1:` 清單格式化／解析（防禦性夾住 label／大小／數量）；行內 `:shortcode:` 解析（純函式＋測試）。
  2. **desktop**：markdown 渲染器輸出行內 `<img class=emoji>`；composer `:shortcode:` 自動補全／插入；統一庫接 AppStorage（0054）＋遷移；設定頁自動收藏開關；批次匯入。
  3. **engine**：庫儲存以 `getKv()`（0219）作 web／RN 後端；信任來源判定與 LRU 淘汰純函式。
  4. **後續 ADR**：Model B（內容定址＋P2P blob，接 ADR-0093）省頻寬；Model C（org 共用 emoji 集）。
  5. 實作時同步更新 `ARCHITECTURE.md`（訊息內容契約新增 `nb-assets:v1:`）；**實作＋測試落地後，本 ADR 由「提議中」轉「已接受」。**
