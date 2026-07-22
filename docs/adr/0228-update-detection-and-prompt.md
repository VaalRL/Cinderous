# 0228. 桌面／行動版更新偵測與提醒

- 狀態：已接受（P1 core／P2 官網發佈／P3 desktop UI 皆已落地）
- 日期：2026-07-21
- 相關文件：ADR-0227（統一版號、`APP_VERSION`、`docs/releases.json`）、0186（官網 GitHub Pages）、0210（CSP）、0071（節流模式）、全域隱私原則（本機優先、明文不上雲）

## 背景與問題

桌面版走 GitHub release（Windows exe/msi，未走商店），使用者**不會被自動告知有新版**；行動版尚無原生發布管道。ADR-0227 已提供本機 `APP_VERSION` 與雙語 `releases.json`，但缺「最新版對外可查 ＋ app 比對並提醒」這一環。目標：**在本機偵測是否有新版、提醒使用者可更新**，且不違背隱私底線。

## 考量的選項

- **A. Tauri 官方 updater**（檢查→下載→安裝）：需 `@tauri-apps/plugin-updater` ＋ updater 專用 minisign 簽章金鑰 ＋ 發佈 update manifest。app 目前**未做程式碼簽章**，較重。列後續。
- **B. 僅偵測＋提醒（採用）**：查一份靜態「最新版本」JSON、比對 `APP_VERSION`、有新版就提示前往下載。輕量、不需簽章、隱私可控。
- **C. 直連 GitHub Releases API**：`api.github.com` 有 rate limit、洩露更多、非自有基礎設施。**否決**（改查自有官網靜態 JSON）。

## 決策（採 B）

1. **最新版本來源＝官網部署的 `releases.json`**（GitHub Pages，`…/Cinderous/releases.json`；`vite` build 時把 `docs/releases.json` 複製進官網 dist）。**於發版時才部署**——即官網 `releases.json` 代表「**已發布**版本的權威」，避免 hold 中的草稿條目（如目前未發版的 0.0.13）被誤報為可更新。**endpoint 可設定**（預設官網），供自架站者指向自己的來源（呼應 self-hosting）。
2. **比對邏輯＝core 純函式**：`latestNewerThan(remote, current)`——semver 比較 remote 最新（`releases[0].version`）與本機 `APP_VERSION`；`fetch` 由各平台注入（desktop/mobile 共用同一純邏輯，可完整於 node 測試）。
3. **檢查時機**：開機查一次；以 localStorage 記上次檢查時間**節流**（如每日至多一次，沿用 ADR-0071 模式）；查詢失敗（離線／被擋）**靜默略過、不打擾**。
4. **提醒 UI**：設定「關於」區（ADR-0227 P4）顯示「**可更新 vX.Y.Z**」徽章 ＋「前往下載」（開 GitHub releases 頁；Tauri 用 opener 開系統瀏覽器）。**不自動下載／安裝**。開機一次的輕量橫幅列為後續增強。
5. **隱私**：**opt-in 開關**（設定，預設開、可關）；**只查版本號 JSON、不送任何使用者資料／身分／訊息／明文**；查自有官網（非第三方追蹤）；自架可改 endpoint。desktop CSP `connect-src` 放行該 endpoint。
6. **跨平台共用**：查詢＋比對邏輯放 core；**desktop 先接**，mobile 待原生發布管道（商店／sideload）確定後接同一邏輯（商店版可改由商店機制提醒）。

## 理由

- 幾乎搭 ADR-0227 現成件：`APP_VERSION`（本機）＋ `releases.json`（版本＋雙語 note）＋ 關於區 UI，只需補「官網發佈 + 查詢比對 + 徽章」。
- 靜態 JSON 查詢最省、無 rate limit、可自架，符合去中心化與 self-host 精神。
- 純邏輯在 core、`fetch` 平台注入＝desktop/mobile 共用且可測；不綁 Tauri。
- 「官網僅於發版部署」確保不把 hold 草稿誤報為可更新。

## 後果

- **正面**：使用者能被告知新版並一鍵前往下載；桌面 sideload 的更新盲點解除；隱私可控（opt-in、只查版本號）。
- **中性／取捨**：
  - 更新檢查是**連外**動作——洩露 IP 與「在用本 app」給官網 host（GitHub Pages / CDN），與查 relay 同級；以 opt-in＋可關＋自架 endpoint 緩解。高隱私使用者可關閉。
  - 「僅提醒不自動安裝」＝使用者仍須手動下載安裝（未簽章，SmartScreen 提示不變）。完整自動更新見選項 A（後續）。
  - 需在**發版流程**多一步：把該版加入官網 `releases.json` 並部署（與 `gh release` 同步）。
  - `releases.json` 本機打包版（關於區顯示本版 note，可含草稿）與官網部署版（已發布，供更新檢查）語意不同——同一檔、差在「部署時機＝發版」。
- **實作階段**：
  1. **P1**（core）：`latestNewerThan`／semver 比較純函式 ＋ 測試。
  2. **P2**（官網／發版）：`website` build 複製 `docs/releases.json` 進 dist；發版 checklist 加「部署官網 releases.json」。
  3. **P3**（desktop）：開機查詢（節流、失敗靜默）＋關於區「可更新」徽章＋下載連結＋設定開關（i18n zh/en）＋CSP `connect-src`。
  - **後續**：開機橫幅、mobile 接入、Tauri 官方 updater（自動下載安裝，需簽章金鑰）。
  - 落地後同步 `ARCHITECTURE.md`，轉「已接受」。
