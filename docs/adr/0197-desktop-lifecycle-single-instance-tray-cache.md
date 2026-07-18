# 0197. 桌面生命週期：單一實體、關閉提示、版本更新清快取（修「更新後仍見舊前端」）

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：`apps/desktop/src-tauri/src/main.rs`、ADR-0105（原生殼）

## 背景與問題

回報：更新版本後桌面/portable **仍看到舊前端**（登入頁還有舊的 relay 輸入/示範文字），即使下載新檔、清 WebView2 HTTP 快取仍舊。查證：原始碼、`apps/desktop/dist`、release 上的 exe **都是新的**；但 exe 內嵌前端經 brotli 壓縮無法直接驗。

根因判定：**Tauri 於編譯期以 `generate_context!` 把前端 dist 嵌進 exe**。純前端改動（改 `.tsx`）不一定觸發 `main.rs` 重編譯 → 巨集不重跑 → exe 內留**舊前端**。此時清 WebView2 快取無效（exe 直接吐內嵌舊資產）。

另有兩個關聯問題：關閉＝靜默縮到系統匣（使用者以為已結束、卻仍在跑）；無單一實體 → 舊實體常駐系統匣時再啟動會有多個程序/看到舊視窗。

## 決策（三項，皆在 `main.rs`）

1. **單一實體**（`tauri-plugin-single-instance`）：第二次啟動 → `show_main` 聚焦既有視窗、不開新程序（須最先註冊）。
2. **關閉提示**：`CloseRequested` → `prevent_close`＋`hide()` 縮到系統匣，另起執行緒以 `rfd` YesNo 對話框問「程式尚未關閉（在系統匣背景執行），要直接結束嗎？」→ Yes `app.exit(0)`、No 留背景。
3. **版本更新清快取**：`main()` 於 Builder 前呼叫 `clear_webview_cache_on_update()`——比對 `CARGO_PKG_VERSION` 與 `%LOCALAPPDATA%\app.cinder.desktop\app-version.txt`，不同即刪 `EBWebView\Default\{Cache,Code Cache,GPUCache}`（**保留 Local Storage/IndexedDB**＝使用者資料），再寫入新版本。僅 Windows（無 `LOCALAPPDATA` 早退）。

**同時**：這三項是 Rust 原始碼改動 → **強制 `main.rs` 重編譯 → `generate_context!` 重嵌目前 dist**，本次 0.0.3 exe 保證帶新前端（治本）。

## 理由

- 症狀治本＝強制重嵌（Rust 改動達成）；feature 3 再從 WebView2 快取面確保更新後不吃舊資產＝雙保險。
- 單一實體避免舊實體常駐造成的重複/看到舊視窗；關閉提示讓使用者理解背景行為並能真正結束。

## 後果

- 正面：更新後保證見新前端；不再有殘留多實體；關閉行為透明可選。
- 負面 / 已知殘餘風險：
  - 清快取路徑為 Windows 專屬（`EBWebView`）；他平台 no-op。
  - 關閉每次都提示（日後可加「不再詢問」）。
  - 需重建＋重發（0.0.3）才生效。
- 後續：日後若要避免「純前端改動不重嵌」，可於 `build.rs` 對 dist 加 `rerun-if-changed`，或每次發版都 bump 版本（已成慣例）。
