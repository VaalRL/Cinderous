# 0137. 行動端貼圖：貼圖格式/資料/驗證下沉 @cinder/core、兩端共用

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0021（貼圖）**、0031（動態貼圖）、0032（自製貼圖）、0042（自製貼圖上限）、
  0043（reduced-motion 護欄）、0133/0134/0136（同批行動端對齊）

## 背景與問題

貼圖（ADR-0021）在**桌面**完整：內建包、動態、自製、編輯器、觸發詞。**行動端完全沒有**——

- 收到貼圖時，行動端把 `nb-sticker:v1:buddy/cat`（或自製的 v2 JSON）**當原始字串顯示**——一坨標記。
- 沒有任何**送出貼圖**的入口。

而貼圖**在協定層根本不是特殊訊息**：它就是一則普通加密文字訊息，本文是標記字串
（`formatSticker`／`formatCustomSticker`）；收端 `parseSticker` 解出來渲染成圖。所以持久化、回應、
收回、限時、Gift Wrap 加密**全都自然沿用**——引擎/後端**零改動**。

問題只在：那套「格式/解析/內建資料/SVG 驗證」的**純邏輯當時全在 `apps/desktop/`**，行動端要用就得
複製——違反 Fix First。

## 決策

### 1. 貼圖純邏輯下沉 `@cinder/core`，兩端共用

把 `apps/desktop/src/stickers.ts`（格式/解析/內建包資料/`resolveSticker`/`stickerSvg`/`svgToDataUri`）
與 `apps/desktop/src/ui/sticker-svg.ts`（`validateStickerSvg` 拒收制、`clampStickerLabel`、
reduced-motion 護欄）**移到** `packages/core/src/`（兩者本就純、node 可測、無 DOM）。桌面所有 import
改指 `@cinder/core`、測試一併移入 core。→ **單一真實來源**，行動端直接取用。編輯器與 localStorage
偏好（`StickerEditor`、`sticker-library`/`-prefs`/`-triggers`）**留桌面**（那些才是平台相關）。

### 2. 行動端：渲染收到的貼圖

訊息本文若是貼圖標記 → 渲染成 `<Image source={{ uri: svgToDataUri(svg) }}>`（無泡泡底、直接顯示，
比照 LINE/WhatsApp），不顯示原始標記字串。內建（v1）取內建 SVG；自製（v2）解出內嵌 SVG 並
**`validateStickerSvg` 驗證**（收端縱深防禦——含 `<script>`／事件處理器／外部參照的惡意 SVG 一律
不渲染，退回文字）。已收回的貼圖不渲染。

### 3. 行動端：送出內建貼圖

composer 加貼圖鈕 → 展開挑選面板（內建包分頁＋圖格）→ 點一下 `onSend(formatSticker(pack, id))`
（走既有加密訊息通道，與桌面互通）。

### 4. 範圍：先做「收/送內建」，編輯器另議

行動端這版**不含自製貼圖編輯器**（畫布 canvas、匯入、fork、觸發詞、收藏/最近——那些是桌面
localStorage/DOM 綁定的較大子系統）。但**收到**自製貼圖仍**渲染得出來**（走 §2 的 v2 驗證路徑）。

## 理由

- 貼圖＝普通加密訊息，收/送本就平台無關（`sendMessage`/`onMessage`）——所以補到行動端**不動協定、
  不動後端**，只補渲染與挑選 UI。
- 下沉 core 是 Fix First 正解：格式、內建資料、SVG 驗證單一真實來源，桌面與行動端共用、共測，杜絕
  兩份漂移。桌面 import 改指 core（純機械、函式位元組不變），測試移入 core。
- SVG 驗證**收端也跑**：惡意對端可手工塞任意 v2 標記，行動端渲染前一律驗證（ADR-0032 的拒收制
  在行動端同樣把關）。

## 後果

- 正面：
  - 行動端能**看到收到的貼圖**（內建＋合法自製）、**送出內建貼圖**——與桌面互通（同一標記格式）。
  - 貼圖格式/資料/驗證單一真實來源（core），桌面與行動端共用、共測。
  - 測試歸位：core +19（stickers/sticker-svg 測試移入）、desktop −19（移出，數不變）、mobile +7
    （收內建/未知不當貼圖/收合法自製/惡意自製不渲染/已收回不渲染/純文字不誤判/挑選入口）。
    全綠：core 300／desktop 307／mobile 127。

- 已知限制：
  - 行動端**無自製貼圖編輯器**（僅收/送內建；收得到自製）——編輯器是桌面 canvas/localStorage 子系統，
    另議。
  - 行動端跑在 react-native-web：`<Image>` 吃 `data:image/svg+xml`（含 CSS keyframe 動態）可播；上
    **真正 React Native** 時 SVG 需 `react-native-svg`（`SvgXml`），屆時換底層、介面不變。
  - 挑選面板的**互動**（開面板→切分頁→點送出）是薄接線，SSR 測試涵蓋渲染與入口；面板互動需 jsdom
    （行動端目前純 SSR，同 ADR-0133 取捨）。
