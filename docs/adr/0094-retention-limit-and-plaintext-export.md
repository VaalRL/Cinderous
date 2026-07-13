# 0094. 本地紀錄保留上限（可設定、預設無上限）與明文紀錄導出

- 狀態：已接受（已實作）
- 日期：2026-07-13
- 相關文件：ADR-0054（加密儲存基質）、0071（雲端快照）、0093（檔案接收）；
  `packages/engine/src/storage/*`、`apps/desktop/src/ui/SettingsPanel.tsx`、`apps/mobile/src/screens/SettingsScreen.tsx`

## 背景與問題

1. **保留上限**：目前每對話持久化上限硬編碼 `MESSAGES_PER_CONVO = 1000`（`storage/types.ts`），寫入時逐出最舊
   （P0-1，防 localStorage 配額爆掉）。但這對長期使用者是**破壞性**的——第 1001 則以後被永久刪除，且 relay 只保 7 天，
   舊訊息一旦擠掉又沒進雲端快照就永久消失。使用者應能自選保留量、且**預設不該替他刪**。
2. **明文導出**：使用者需要把對話紀錄帶出 App（備份、存證、遷移）。但 Cinder 的預設是「明文不外流」——
   導出＝**刻意把解密後明文寫出加密邊界**，屬隱私敏感操作，需審慎設計（僅本機、使用者主動、明確警告）。

## 考量的選項

### A. 保留上限
- **A1 維持硬上限 1000**：簡單但持續替使用者刪資料，與「使用者掌控自己的紀錄」相悖。**不採**。
- **A2 可設定、預設無上限（採用）**：儲存層 cap 參數化（`0`＝無上限），預設無上限；桌面/手機各給設定。
  代價＝瀏覽器配額、載入/記憶體成本（見後果），以優雅降級與提示處理。

### B. 明文導出
- **B1 不提供**：最安全但無法備份/遷移，不符需求。**不採**。
- **B2 使用者主動、僅本機的明文導出（採用）**：複用 ADR-0093 的 `save_file`（Tauri 原生另存）／瀏覽器下載；
  導出時明確警告明文離開加密保護。格式與範圍見決策。

## 決策（草案，依使用者裁示）

### A. 可設定保留上限，預設無上限
- 儲存層（`MemoryStorage`/`LocalStorage`，`TauriStorage` 委派）新增 `maxPerConvo`（建構參數＋`setMaxPerConvo()`）；
  `0`／未設＝**無上限**（不逐出）。`MESSAGES_PER_CONVO` 保留為「有限模式」的建議值之一，不再是預設。
- 設定：裝置本地偏好 `nb.retentionCap`（**不同步**——保留是各裝置的儲存考量）。桌面 `SettingsPanel`、手機
  `SettingsScreen` 各一區，選項 **無上限（預設）/ 1000 / 5000 / 10000 / 自訂 N**；改動即時套用到當前 storage。
- **瀏覽器配額降級**：`write()` 捕捉 `QuotaExceededError`，跳一次警告（建議改用桌面版或設有限值），不崩潰。
- **雲端快照 cap 不變**：`SNAPSHOT_MESSAGE_CAP`（ADR-0071）另行控 relay 體積；本地無上限 ≠ 快照無上限。

### B. 明文導出（TXT＋Markdown＋JSON，範圍可選，含文字＋檔案 metadata＋emoji 回應）
- **格式**：三種皆產出——`.txt`（人類可讀、一行一則）、`.md`（Markdown 標題＋清單）、`.json`（結構化、未來可重匯入）。
- **範圍可選**：對話選單「導出此對話」（單一）＋設定頁「導出紀錄…」可**勾選**要匯出的對話/群組（或全選）。
- **內容**：文字訊息＋檔案訊息（顯示為 metadata 行：檔名/大小/`savedPath`，**無位元組**）＋emoji 回應（NIP-25）。
  已收回訊息標「（已收回）」。**不含私鑰、不含檔案本體**。
- **序列化在 engine**（純函式、可測）：`packages/engine/src/storage/export.ts`——`exportRecords(storage, format, opts)`。
  UI 只負責選範圍/格式與寫檔（Tauri `save_file`／瀏覽器下載）。
- **隱私**：導出前彈警告「此檔為明文，離開裝置加密保護，請自行保管」；**僅寫本機、絕不自動/上網**。

## 理由

- **使用者掌控**：預設無上限＝不替使用者偷刪歷史；要省空間者自行設限。導出讓紀錄可攜、可長期保存。
- **複用既有基礎**：導出寫檔複用 ADR-0093 `save_file`；序列化放 engine 讓桌面/手機共用同一套、可測。
- **隱私邊界誠實**：導出是唯一「刻意」把明文寫出加密邊界之處，故限使用者主動＋本機＋明確警告，不破壞預設。

## 後果

- 正面：長期歷史不再被自動逐出；紀錄可導出備份/存證/遷移；桌面手機一致。
- 負面 / 已知殘餘風險：
  - 無上限下瀏覽器 localStorage 終會撞配額（~5MB）→ 以優雅降級＋提示處理；桌面（加密 blob）/手機空間寬裕。
  - 歷史越大，開機 `onHistory` 回放與記憶體成本越高（UI 200 則渲染視窗已擋 DOM 爆量）。
  - 導出的明文檔案脫離 App 加密保護，保管責任在使用者（已警告）。
- 後續行動：儲存層 cap 參數化＋設定 UI（桌面/手機）→ `export.ts` 序列化（txt/md/json）＋測試 →
  桌面導出 modal（勾選範圍＋格式）＋對話選單單一導出 → 手機導出入口 → i18n。

## 實作（已完成）

- **保留上限**：`MemoryStorage`/`LocalStorage` 加 `maxPerConvo`（建構參數＋`setMaxPerConvo`，`0`＝無上限、
  **預設值**）；`TauriStorage` 委派並持久化；`AppStorage.setMaxPerConvo` 入介面。`LocalStorage.write` 的
  `QuotaExceededError` 另呼叫 `onStorageQuota` hook → App 顯示滿載提示。設定：`nb.retentionCap` 偏好＋
  桌面 `SettingsPanel`／手機 `SettingsScreen` 各一區（無上限／1000／5000／10000／自訂）；App 以效果即時
  `setMaxPerConvo` 到當前身分儲存（並修正瀏覽器路徑「storageRef 與後端各持一份」使兩者共用同一實例）。
- **導出**：`packages/engine/src/storage/export.ts`——`exportRecords(storage, "txt"|"md"|"json", { keys, ... })`
  純函式，含文字＋檔案 metadata（含 `savedPath`）＋emoji 回應，已收回標「（已收回）」，不含私鑰/位元組。
  桌面 `ExportModal`（勾選範圍＋格式）＋對話視窗「📤 導出此對話」；手機設定頁「導出全部」。寫檔複用
  ADR-0093 `save_file`（Tauri）／瀏覽器下載，導出前顯示明文警告。
- **測試**：engine `export.test.ts`（txt/md/json 格式、已收回、回應開關、範圍、群訊 sender、不含私鑰）＋
  `memory.test.ts`（預設無上限、有限模式逐出、`setMaxPerConvo` 即時逐出）。全 733 測試通過、全 typecheck 通過。
- **預設值變更**：`MESSAGES_PER_CONVO = 1000` 由「硬預設」降為「有限模式的建議值之一」；預設不再逐出。
