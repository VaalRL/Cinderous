# 0170. 行動端功能對齊批次三——新增群組成員、企業自報頭銜 chip（顯示＋編輯）

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0168／0169（行動端對齊批次一、二）、0027（群組成員管理）、0114
  （群組）、0158（企業自報頭銜）、0061（加密個人檔廣播）

## 背景與問題

延續行動端對齊。批次三挑兩項**引擎已就緒、只差 UI** 的項目，其餘企業套件（名冊管理、
儲存槽、金鑰託管）與語音/燈箱等重工續留後批：

1. **新增群組成員**（ADR-0027）：`addGroupMember(groupId, pubkey)` 引擎早支援，行動端
   成員面板只有「移除／離開」，管理者無法從手機加人。
2. **企業自報頭銜**（ADR-0158）：`setSelfTitle/selfTitle` 與 `Contact.title` 都在，行動端
   **既不顯示對方頭銜、也不能設定自己的頭銜**。桌面早有實心 `chip--role` 顯示＋設定頁編輯。

## 決策

### 1. 新增群組成員 UI（僅管理者）

- `ConversationScreen` 成員面板加 `onAddMember?`＋`addMemberCandidates?`（尚非成員的聯絡人）。
  點「＋ 新增成員」（`members_add` 既有 i18n）展開候選清單，逐一加入；候選為空則整區不顯示。
- `MobileApp` 於 `groupProps` 計算候選＝`contacts` 濾掉已在 `group.members` 者，並在
  `group.admin === selfPubkey && backend.addGroupMember` 時才接上（非管理者/示範模式不顯示）。
- 群組**無共用金鑰**（ADR-0027）：新增成員＝下次扇出納入他，即時生效、免 rekey。

### 2. 企業頭銜 chip（顯示）

- `MobileContact` 加 `title?`；`mobileContacts` 對應帶入 `contact.title`。
- 聯絡人列與 1:1 對話標頭以**實心主色 chip**（白字）顯示對方頭銜，與私有標籤（outline）
  色彩區隔——與桌面 `chip--role` 語意一致。頭銜為 1:1 對象語意，**群組不顯示**。

### 3. 企業頭銜編輯（設定頁）

- `SettingsScreen` 加頭銜編輯區（`settings_orgTitle`／`Hint`／`Updated` 既有 i18n）：草稿＋
  「更新」鈕。**廣播是有代價的動作**（`setSelfTitle` 全量重播個人檔給聯絡人），故用套用鈕、
  不逐字送；空＝移除（廣播移除記號）。`MobileApp` 於登入時以 `backend.selfTitle()` 預填。

## 理由

- 兩項共享群組面板／聯絡人顯示的接線點，脈絡一致；全部「引擎已就緒」＝零協定變更、
  零中繼變更。chip 色彩、群組排除頭銜、廣播用套用鈕皆對齊桌面既有設計（Fix First）。

## 後果

- 正面：行動端管理者可從手機加群組成員；企業頭銜在行動端可看（對方）可設（自己），與桌面對齊。
- 已知限制／取捨：
  - **頭銜編輯未依企業身分設閘**：桌面僅 `enterprise/orgOwner` 身分顯示編輯器，行動端目前
    尚無該身分旗標，故對**所有真實 relay 身分**顯示。頭銜為自填、預設空、Hint 已說明「會廣播
    給所有聯絡人」，語意清楚；待行動端接上企業身分模型後再補閘（另立 ADR）。
  - 新增成員 UI 在成員面板內（需先展開面板）——SSR 測試無法正向斷言其互動，改由引擎
    `addGroupMember` 既有測試把關；SSR 只斷言頭銜 chip 這類「常駐條件渲染」。
  - 仍待對齊（後續批次）：企業名冊管理、公司儲存槽、金鑰託管等重型企業套件，與語音錄製、
    媒體燈箱、每身分外觀。
- 測試：`ConvoComposer.test.tsx` 補頭銜 chip（1:1 顯示／無頭銜隱藏／群組隱藏）；
  `ContactListScreen.test.tsx` 補聯絡人列頭銜 chip；行動端 164 測試綠燈、typecheck 通過。
