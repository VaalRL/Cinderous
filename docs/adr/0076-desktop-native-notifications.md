# 0076. 桌面原生通知（tauri-plugin-notification ＋ 點擊回跳 ＋ 傳訊者/預覽/音效）

- 狀態：已接受
- 日期：2026-07-10
- 相關文件：docs/adr/0015（設定：身分備份/桌面通知/未讀）、0018/0053（Tauri 殼/原生整合）、
  0026（通話 UI／Web Audio 鈴聲）、apps/desktop/src/App.tsx、
  apps/desktop/src-tauri/src/main.rs、apps/desktop/src-tauri/capabilities/default.json

## 背景與問題

桌面版收到**他人訊息、且視窗未聚焦**（含最小化到系統匣）時，`App.tsx` 會用瀏覽器
**Web Notification API** 跳桌面通知（ADR-0015）。此路徑在瀏覽器與 `tauri:dev` 可用，
但打包成 Tauri（Windows WebView2）桌面版有三個缺口：

1. **可靠性**：WebView2 對 Web Notification API 的支援在打包後不穩、缺 App 身分/圖示，
   不像 LINE 那樣穩定出現在系統通知中心。
2. **內容陽春**：通知固定標題 `"Cinder"`、只帶內文，**不顯示是誰傳的**（`App.tsx` 現況）。
3. **點擊無效**：點通知**無法把隱藏於系統匣的視窗叫回、更無法跳到該對話**——這是 LINE
   最基本的體驗。

現有的「僅他人訊息＋視窗未聚焦才跳、未讀徽章、設定開關、權限請求」判斷本身是對的，
問題只在「傳遞層 + 內容 + 點擊路由」。

## 考量的選項

- 選項 A：維持純 Web Notification——打包後不穩、無點擊回跳，否決。
- 選項 B：**接 `tauri-plugin-notification`，抽一層通知服務、瀏覽器 fallback Web Notification**
  （採用）——見決策。
- 選項 C：自寫 Rust 原生通知（直呼 WinRT／`objc2-user-notifications`）——重造輪子、跨平台
  成本高，違反 Fix First，否決。

## 決策

1. **通知服務抽象** `apps/desktop/src/native/notify.ts`：單一 `notify()` 入口，`isTauri()`
   為真走原生外掛（含外掛 `isPermissionGranted`/`requestPermission` 權限流程），否則 fallback
   瀏覽器 Web Notification。**既有「僅他人訊息＋視窗未聚焦才跳」的判斷與呼叫點不變**，
   只是把 `App.tsx` 那次 `new Notification(...)` 改走此服務。
2. **原生外掛**：加 `tauri-plugin-notification`（Rust）＋`@tauri-apps/plugin-notification`（JS）；
   `main.rs` builder 註冊、`capabilities/default.json` 授 `notification:default` 權限。
3. **點擊回跳**：新增 IPC 命令 `focus_window`（薄包既有 `show_main` ＝ show + unminimize +
   set_focus，托盤點擊已在用）；通知點擊 → 叫回視窗 ＋ 開啟該 `pubkey` 對話。外掛在
   Windows 的點擊 action 行為於實作 N3 步實測確認，不先誇口。
4. **內容**：標題改用**聯絡人顯示名**（非固定 `"Cinder"`）＋帶 App 圖示；**預設顯示內文
   （LINE 預設）**，另加「隱藏預覽」設定（開啟＝只顯示「有新訊息」、不露內文）。
5. **提示音**：**預設開、可關**，沿用專案既有 Web Audio 鈴聲手法（無外部音檔、離線/CSP
   相容，比照 ADR-0026 來電鈴聲），收到背景訊息時輕響一聲。
6. **設定**：設定面板通知區加「隱藏預覽」「提示音」兩開關，本機持久化（比照 `nb.notify`）。

## 理由

- 全程重用同一套背景/聚焦判斷與 `show_main`（Fix First），只補「可靠傳遞層 ＋ 點擊路由 ＋
  內容」，不動核心事件流。
- 隱私鐵則不變：通知內容僅在**本機**組出、不外送任何雲端。預設顯示內文以對齊 LINE 體驗；
  防偷看/鎖屏外漏的顧慮以「隱藏預覽」開關交還使用者（隱私預設精神與體驗優先的平衡）。

## 後果

- 正面：打包桌面版通知可靠、顯示是誰傳的、點擊回到對話，體驗貼近 LINE；未讀/背景在線
  （B6 系統匣）路徑不受影響。
- 負面／已知殘餘風險：多一組原生依賴與權限面；外掛在各 OS 的點擊 action 行為需實測
  （N3 確認 Windows，其餘平台後補）；真實 OS toast 需**打包版手動驗證**（開發環境無法
  自動化，會如實標註）。行動端（Phase D）通知另循 React Native 推播路徑，不在此 ADR。
- 後續行動：實作分 N1–N5（依賴/權限 → 通知服務 → 點擊回跳 → 傳訊者/音效 → 設定開關）；
  `notify` 服務以 mock 覆蓋 Tauri／瀏覽器／無權限三分支；`docs/ROADMAP.md` 補 Phase N。
