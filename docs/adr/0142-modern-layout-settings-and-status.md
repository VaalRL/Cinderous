# 0142. 三欄版：設定入口移上方 nav、補回自訂狀態文字、設定改分頁

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：ADR-0079（桌面佈局 classic/modern）、0045（多身分 idbar）、0030（狀態 UX）、
  apps/desktop/src/App.tsx、DeckSidebar.tsx、SettingsPanel.tsx

## 背景與問題

三欄（modern）版有三處體驗缺口：

1. **設定入口位置怪**：⚙ 塞在左側欄的頭像旁（`DeckSidebar` 的 `dsb__me`），不像全域動作。
2. **不能自訂狀態文字**：`DeckSidebar` 只給 `onStatus`（上線/離開/忙碌），**缺 `onStatusMessage`
   與 `onNowPlaying`**——經典版的 `ContactListWindow` 兩者都有。三欄版使用者設不了「我在發呆」。
3. **設定頁又長又要捲**：所有區塊擠在一個 `settings__body` 裡一路捲。

## 決策

### 1. 設定入口移到上方 nav bar（idbar）

`idbar`（身分切換列，`grid-area: top`）就是三欄版的上方 nav bar。把 ⚙ 從 `DeckSidebar` 移出，改放
`idbar` 右側（`margin-left:auto`），僅 modern 顯示。並讓 `idbar` 在 modern 下**即使沒有 profile 也渲染**
（否則示範模式會沒有設定入口）。經典版維持在 `ContactListWindow`，不動。

### 2. 三欄左側欄補回自訂狀態文字＋正在聽

`DeckSidebar` 新增 `onStatusMessage`（必填）與 `onNowPlaying`（可選），`dsb__me` 頭像列改為：
名稱 → 狀態選擇 → **個人狀態文字輸入（含 `:emoji:` 富狀態預覽）** → **正在聽**。重用經典版同一套
`me__msg`／`me__np`／`renderStatus`，兩版一致。App 端把 `setStatusMessage`／`setNowPlaying` 接上。

### 3. 設定改分頁結構

`SettingsPanel` 由單一長捲頁改為**分頁**：外觀｜身分與安全｜連線與備份｜隱私與通知｜進階。分頁列固定在
標題下（不隨內文捲動），內文只渲染作用中分頁的區塊。**身分/進階分頁只在有內容時出現**（全條件式，
可能為空）。新增 `initialTab?` prop 供深連結與測試（SSR 無法點分頁）。

## 理由

- 設定是全域動作，屬上方 nav 而非某欄的頭像旁——與多身分切換器同列，順手。
- 狀態文字是 ADR-0030 的既有能力，三欄版漏接是缺口非設計；補上即與經典版對齊，且共用同一套呈現。
- 分頁把十幾個區塊分成五類，開啟即見、減少捲動；只顯示有內容的分頁避免空頁。

## 後果

- 正面：
  - 三欄版設定入口在上方 nav；能設自訂狀態文字與正在聽；設定頁分頁、少捲動。
  - 測試 316 → **321**（SettingsPanel 分頁 3：固定分頁恆在/身分進階條件出現/預設外觀只顯外觀；
    DeckSidebar 2：有狀態文字輸入且無齒輪、給 onNowPlaying 顯示正在聽）。既有 SettingsPanel 測試改用
    `initialTab` 指定分頁（SSR 無法點）。
- 已知限制：
  - 分頁切換是 client state；SSR 測試靠 `initialTab` 指定。分頁「點擊切換」的互動由 client 提供，
    未做 jsdom 級點擊測試（純函式/顯示分流已覆蓋）。
  - 經典版（floating windows）維持原樣——本 ADR 只動三欄版與設定分頁（設定分頁兩版共用，經典版一樣受惠）。
