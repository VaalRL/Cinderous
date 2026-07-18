# 0195. 登入 relay 切換改為明確按鈕＋桌面圖示改為 Cinderous 餘燼標誌

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：ADR-0069（登入自動選座）、ADR-0194（移除示範文字）、`apps/desktop/src-tauri/icons/`

## 背景與問題

1. **relay 切換入口太隱蔽**：初次啟動 relay 輸入預設收起（正確——不需填），但展開入口是視窗右下角一顆**低調的 📡 emoji**（`signin__relaycorner`，ADR-0069 刻意低調），使用者常找不到「要去哪改中繼站」。
2. **桌面圖示是佔位圖**：`icons/` 為 `tauri icon` 產生的**藍色漸層佔位圖**（見舊 `icons/README.md`），工具列/安裝檔顯示的不是 Cinderous 標誌。

## 決策

1. **relay 切換改為明確文字鈕**：收合狀態列在「將連線到 {host}」旁直接放一顆 `signIn_relayChange`（「使用其他中繼站」）文字鈕，點了才展開輸入框；移除右下角 📡 角落鈕。`data-testid="relay-change"` 保留（測試不變）。行為不變——**未動 relay ＝用自動選座的預設錨點**（ADR-0069/0194）。
2. **桌面圖示改為真標誌**：以官網 favicon／`CinderMark` 的餘燼意象（深藍圓角底＋暖橙/琥珀/亮黃三層）做 1024 來源（`icons/cinderous-ember.svg`），`tauri icon` 生成整套（`icon.ico`/`icon.icns`/各尺寸/`Square*Logo`）取代佔位圖。

## 理由

- 明確文字鈕讓「換中繼站」可被發現，同時維持「預設不必填、進階才展開」的原意（ADR-0069）。
- 真圖示消除佔位藍圖，工具列/安裝檔呈現品牌；來源 SVG 入 repo 供重生。

## 後果

- 正面：登入更好用（換站入口明確）；桌面版/portable 工具列與安裝檔顯示 Cinderous 餘燼標誌。
- 負面 / 已知殘餘風險：需**重建並重發 v0.0.1**（圖示烘進 exe/安裝檔；relay 鈕為前端）。圖示為程式繪製（非設計師手稿），日後可再美化。
- 測試：desktop 406 綠（`relay-change` testid 保留）。
