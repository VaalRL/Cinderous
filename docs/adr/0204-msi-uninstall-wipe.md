# 0204. MSI（WiX）反安裝可選一併清空——屬性驅動（`WIPEDATA=1`）

- 狀態：已接受
- 日期：2026-07-19
- 相關文件：`apps/desktop/src-tauri/wix-uninstall-wipe.wxs`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/src/main.rs`（`--wipe-local`）、ADR-0203（NSIS 反安裝清空）、ADR-0202（清空裝置）

## 背景與問題

ADR-0203 只替 **NSIS setup.exe** 加了反安裝可選清空；**MSI（企業派送）沒有**——用 MSI 反安裝只移除程式，私鑰（認證管理員）與 `%APPDATA%` 資料留著。企業離職清機情境需要 MSI 也能清。

MSI 的限制與 NSIS 不同：**互動對話框不適合 MSI**——企業多以 `msiexec /qn`（無人值守/靜默）派送與移除，反安裝時彈 Yes/No 會卡住流程。且 ARP（新增移除程式）觸發的反安裝通常不顯示自訂 UI。

## 決策

MSI 採**屬性驅動**（企業慣例），而非互動框——這是 NSIS 互動提示在 MSI 的**等效**：

- 預設**不清**（保留資料）：`msiexec /x Cinderous.msi`
- 一併清空：`msiexec /x Cinderous.msi WIPEDATA=1`

實作（`wix-uninstall-wipe.wxs`，經 `tauri.conf.json → bundle.windows.wix.fragmentPaths` ＋ `componentGroupRefs` 連結）：
- `CustomAction CinderWipeLocal`：`FileKey="Path"`（主程式檔）＋`ExeCommand="--wipe-local"`＋`Execute="deferred"`＋`Impersonate="yes"`＋`Return="ignore"`。
- 排程於 `InstallExecuteSequence`：`Before="RemoveFiles"`（此時主程式仍在），條件 `(REMOVE="ALL") AND (WIPEDATA="1")`。
- `Property WIPEDATA Secure="yes"`：可自命令列傳入、跨到 execute 序列。
- 重用 ADR-0203 既有的 `--wipe-local`（同一份 keyring/檔案清除邏輯），**Rust 端零改**。

## 理由

- **屬性驅動＝MSI 慣例**：讓 IT 用一致的 `msiexec` 參數控制，靜默可自動化；不打斷無人值守流程。
- **重用 `--wipe-local`**：清除邏輯單一來源（NSIS 與 MSI 共用），行為一致。
- **`Impersonate="yes"`**：認證管理員金鑰與 `%APPDATA%` 皆 **per-user**；必須在觸發反安裝的使用者情境執行才刪得到「該使用者」的資料。

## 後果

- 正面：MSI 也能在反安裝時清空私鑰與資料，補齊企業離職清機缺口；與 NSIS 清除邏輯一致。
- 負面 / 已知殘餘風險：
  - **與 NSIS 的體驗不同**：NSIS 互動 Yes/No、MSI 需 `WIPEDATA=1`（無互動框）。從 ARP 直接反安裝**不會**清資料（未帶屬性）——需以 `msiexec` 帶參數，或用 app 內「清空裝置」。文件須寫清楚。
  - **per-user 情境限制**：若以 SYSTEM/其他管理員情境（如 Intune 裝置層）反安裝，`Impersonate` 對象非原使用者，可能清不到原使用者的認證/資料。真正 per-user 清除需在該使用者 session 觸發。
  - **僅 Windows**；此路徑**無法於 CI 涵蓋**，需真實 `msiexec /x … WIPEDATA=1` 驗證。
- 後續：需重建重發方含此變更（僅 MSI 產物改變，app 二進位與 setup.exe/portable 不變）。macOS/Linux 另議。
