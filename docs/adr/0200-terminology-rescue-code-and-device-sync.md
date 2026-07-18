# 0200. 使用者術語正名：「備份碼」→「救援登入碼」、「雲端備份/快照」→「多裝置狀態同步」

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：`packages/i18n/src/messages.ts`、ADR-0070（加密備份碼）、ADR-0071（加密雲端快照）

## 背景與問題

兩個功能的**使用者可見名稱**與其真實用途不符，造成理解偏差：

1. **「加密備份碼」（ADR-0070）**：名稱像「資料備份」，但它實際只包私鑰＋home relay（NIP-49 `ncryptsec`），用途是**在裝置遺失/重灌、且無其他裝置可配對時把身分登入回來**——是「救援登入」，不是資料備份。且專案本就有 `rescue_*` 救援流程，名稱應與之對齊。
2. **「雲端備份（加密）」（ADR-0071）**：名稱像「單向雲端存檔」，但它實際是**多台裝置間、經 relay 的加密狀態同步**（交換律合併、接收恆開），且舊文案誤導成「換裝置時用備份碼＋密碼秒級還原」（還原其實由身分私鑰自動完成，與救援登入碼無關）。

## 決策

**只正名使用者可見文案（i18n 值），不動內部識別字與 ADR。**

- 「備份碼／backup code」→**「救援登入碼／rescue login code」**；其密碼「備份密碼／Backup password」→**「救援密碼／Rescue password」**。涉及 `settings_backupCode*`、`backup_copy`、`backup_wrong`、`rescue_secret`、`rescue_hint`、`rescue_backupPw`、`rescue_error`、`unlock_forgot`、`addId_import`、`addId_error`（中英各一）。
- 「雲端備份／雲端快照／Cloud backup」→**「多裝置狀態同步／Multi-device state sync」**；`settings_cloudHint` 改寫為準確描述「多裝置自動同步聯絡人／群組／封鎖（＋近期訊息）」、`settings_cloudBackupNow`「立即備份」→「立即同步」、`settings_cloudOffConfirm`／`settings_cloudOff` 同步改語意。

**刻意不動**：
- 內部識別字（`makeBackupCode`／`isBackupCode`、`cloudSync`／`CloudSyncMode`／`buildSnapshotContent`、事件 kind、`purgeCloudSnapshot`、`d` tag device-id）——避免大範圍 churn 與破壞相容。
- 程式碼註解與 ADR-0070/0071 標題／內文（ADR 不可竄改；註解屬內部術語）。
- 設定分頁名「連線與備份／Connection & Backup」暫留（救援登入碼仍屬廣義備份；如要一致化可後續另議）。
- 「身分備份（複製 nsec）」＝不同功能，維持原名。

## 後果

- 正面：名稱直指用途，降低使用者把「救援登入碼」當資料備份、把「多裝置同步」當單向雲存的誤解；`settings_cloudHint` 不再有「用備份碼還原」的錯誤描述。
- 中性：僅顯示字串改動，i18n 鍵名與型別介面不變＝中英 parity 自動維持；無測試斷言舊顯示字串。
- 負面 / 已知殘餘：UI 名稱與內部識別字（`cloudSync` 等）自此語義分離，讀碼者需知兩者對應（本 ADR 即對照表）。需重建桌面方於安裝版生效。
