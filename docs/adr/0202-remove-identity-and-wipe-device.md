# 0202. 移除單一身分＋清空裝置（in-app，三端）：破壞性、不可逆

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：`apps/desktop/src-tauri/src/main.rs`、`apps/desktop/src/native/wipe.ts`、`apps/desktop/src/App.tsx`、`apps/desktop/src/ui/SettingsPanel.tsx`、`apps/mobile/src/MobileApp.tsx`、ADR-0053（OS 金鑰庫）、ADR-0138（移除身分）、ADR-0201（軟登出）、ADR-0203（反安裝清空，待補）

## 背景與問題

零伺服器設計下，唯一能徹底移除身分的方式是刪本機資料，但**桌面完全沒有**「移除身分／清空裝置」入口（ADR-0138 只在行動端有 per-身分 forget）。使用者無法在轉手、報廢、或想徹底離開時清掉私鑰與訊息。金鑰庫（keyring）**無法枚舉**，全清必須靠 profiles 登錄提供身分清單逐一刪。

## 決策

新增兩個**破壞性、不可逆**動作，與軟登出（ADR-0201）清楚分開，並置於設定「危險區域」。

**Rust（`main.rs`，桌面）**
- `wipe_identity(pubkey, namespace)`：刪金鑰庫 `pubkey`／`db:{ns}`／`rescue:{ns}`／`db-next:{ns}` ＋ 清解鎖快取 ＋ 刪磁碟 `store/{ns|legacy}.enc` 與 `store/{ns}/`（parts＋archive）。冪等。
- `wipe_store_dir()`：刪整個 `store` 目錄與 `file-authz`（清 orphan）。

**前端清除層（`native/wipe.ts`）**
- `wipeIdentityLocal(p)`：桌面走 Rust；瀏覽器清 `nb.{ns}.*`（純函式 `clearBrowserNamespace`，空 namespace 略過避免誤刪全域，有單測）。
- `wipeDeviceLocal(profiles)`：桌面逐一 `wipe_identity` 再 `wipe_store_dir`；瀏覽器清 IndexedDB／OPFS；兩端最後 `localStorage.clear()`＋`sessionStorage.clear()`。

**UI（三端）**
- 桌面/瀏覽器（`SettingsPanel` 危險區）：「移除此身分」（app 風格 `confirm(danger)`）與「清空裝置」（`prompt` 要求輸入片語 `CLEAR` 才執行，提示先備妥救援登入碼）。
- 行動端（`SettingsScreen` 危險區）：同兩動作，`window.prompt` 片語確認；移除沿用 `forgetActive`（ADR-0138）。

## 理由

- **輸入片語（CLEAR）而非單擊**：清空會永久刪私鑰、零伺服器＝無法找回，故用最高摩擦的確認方式防誤觸。
- **登錄為清單來源**：keyring 無法枚舉，以 `nb.profiles` 逐身分刪金鑰庫條目；`wipe_store_dir` 再兜底磁碟 orphan。
- **與軟登出分離**：登出保留資料（ADR-0201），移除/清空刪資料——三層語意在資料層就不同。

## 後果

- 正面：三端都能徹底移除身分或整台清空；隱私/否認性訴求補上關鍵缺口。
- 負面 / 已知殘餘風險：
  - 瀏覽器 per-身分移除對 **legacy（空 namespace）** 身分只移登錄、不清其 `nb.*` 鍵（與全域鍵無法安全區分）——該資料為 DEK 加密、無 nsec 不可解；整台清空才會清掉。
  - 金鑰庫**無法枚舉**：不在登錄裡的 orphan 金鑰項清不到（正常流程不會產生）。反安裝情境（app 未跑）另由 ADR-0203 的明文身分索引解決。
  - 破壞性不可逆：使用者若無救援登入碼即永久失去身分（UI 已明示警告）。
- 後續：ADR-0203 反安裝程序（NSIS）可選清空＋`--wipe` CLI＋明文身分索引。需重建桌面方於安裝版生效。
