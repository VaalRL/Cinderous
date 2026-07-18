# 0203. 反安裝程序可選「一併清空」＋`--wipe-local` CLI＋明文身分索引

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：`apps/desktop/src-tauri/installer-hooks.nsh`、`apps/desktop/src-tauri/src/main.rs`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src/App.tsx`、ADR-0053（OS 金鑰庫）、ADR-0197（版本更新清快取）、ADR-0202（清空裝置）

## 背景與問題

安裝版（NSIS）反安裝**只移除程式目錄**，使用者的私鑰（Windows 認證管理員）、加密資料（`%APPDATA%`）與 WebView2 設定檔（`%LOCALAPPDATA%`）都**留在裝置上**。轉手/報廢時無從一鍵清乾淨。

技術難點：反安裝時 **app 不在跑**，讀不到 WebView 的登錄（`nb.profiles`）；而金鑰庫（keyring）**無法枚舉**——NSIS 也難以正確刪除認證管理員的 per-pubkey 條目。

## 決策

反安裝時**詢問**是否一併清空（預設否），選是則**呼叫仍在原地的主程式以 headless 模式**清除，重用 app 自己的 keyring 邏輯。

1. **明文身分索引**（`sync_identity_index` 命令）：前端於身分清單變動時把 `[{pubkey, namespace}]` 寫到 `%APPDATA%\app.cinder.desktop\identity-index.txt`（每行 `pubkey\tnamespace`）。內容**非機密**（公鑰與命名空間皆公開）。這是反安裝時得知「要刪哪些金鑰庫條目」的唯一來源。
2. **`--wipe-local` CLI**（`main()` 最前）：以此旗標啟動＝不開視窗，`run_wipe_cli()` 由環境變數推路徑、讀索引逐一 `keyvault::delete_key`（`pubkey`/`db:`/`rescue:`/`db-next:`），刪 `store`／`file-authz`／索引與 `EBWebView`，然後結束。
3. **NSIS hook**（`installer-hooks.nsh` → `NSIS_HOOK_PREUNINSTALL`）：`MessageBox MB_YESNO`（`/SD IDNO`＝預設否/靜默不刪），選是則 `ExecWait "$INSTDIR\${MAINBINARYNAME}.exe" --wipe-local`，再繼續正常反安裝。

## 理由

- **重用 app 的 keyring**＝可靠刪除認證管理員條目，避開 NSIS 硬刪 credential 的脆弱路徑。
- **明文索引**解「app 未跑讀不到登錄」；只放公開資訊，不洩漏任何機密。
- **預設否**：清空不可逆，反安裝未必等於要銷毀身分（可能只是重裝），故保守預設保留資料。

## 後果

- 正面：安裝版可在反安裝時徹底清除私鑰與資料，補齊 ADR-0202 的 app 內清空在「連 app 一起移除」情境的缺口。
- 負面 / 已知殘餘風險：
  - **僅 Windows/NSIS**；其他安裝形式（未來 macOS/Linux）另議。
  - 依賴 `${MAINBINARYNAME}` 為已安裝主程式檔名；若 Tauri 範本改名需同步。**此路徑無法於 CI 單元測試涵蓋**，需真實安裝→反安裝驗證。
  - 索引檔為明文（設計如此，僅公開資訊）；隨清空一併刪除。
  - 舊版本安裝者升級後才會有索引檔；升級前產生的身分於下次執行同步時補齊。
- 後續：需重建並重發（v0.0.9）方含此 hook。macOS/Linux 反安裝清空另立 ADR。
