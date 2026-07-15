# 0135. 行動端身分安全 UI：改密碼、加密備份碼、備份碼登入救援

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0067（本地密碼）**、**0070（加密備份碼）**、0073（忘記密碼 nsec 救援）、
  0112（web/mobile Argon2id 包裹 nsec）、0117（行動端「記住我」）、0081（行動端登入）

## 背景與問題

行動端的身分安全**只做了一半**：

1. **改密碼**：`unlockRemembered`／`rememberIdentity` 都在（ADR-0117），但**沒有 UI 能改本地密碼**。
   設一次就改不了——想換密碼只能登出重記。
2. **加密備份碼**：core `backup.ts`（NIP-49 信封，ADR-0070）**早就寫好且測過**，但行動端**沒有產生
   入口**，也**不能用備份碼登入**——換機救援仍得手抄明文 nsec。
3. **救援**：解鎖畫面已有「改用 nsec」逃生口（ADR-0073 的行動端形態），但那條路**只吃 nsec**，
   吃不了 ADR-0070 的備份碼。

三者的**核心邏輯全在共用包且已測**（`backup.ts`、`passlock-web.ts`、`auth.ts`），缺的只是行動端接線。

## 決策

### 1. 改本地密碼（Settings）

`auth.ts` 加 `changeRememberedPassword(remembered, oldPw, newPw)`：以**舊密碼**解開記住的 nsec、
以**新密碼**重新包裹（新鹽、新密文）。舊密碼錯或新密碼空回 `null`——**沒有旁路、不存密碼雜湊**
（同 ADR-0067/0073 原則）。SettingsScreen 加「改密碼」區塊（**僅在有記住身分時**顯示：沒密碼可改就
不出現）；MobileApp 落地新 blob 取代舊的。

### 2. 加密備份碼（產生／登入）

- **產生**：SettingsScreen 加「產生加密備份碼」區塊（**僅在有 relay 時**——信封含 home relay）：輸入
  備份密碼×2 → `makeBackupCode(nsec, relayUrl, pw)` → 顯示可選取的字串＋複製鈕。剪貼簿走新的
  `native/clipboard.ts`（平台能力收 native/，比照 share.ts）。
- **登入／救援**：`auth.ts` 加 `identityFromSecret(secret, name, backupPw?)` 與 `looksLikeBackupCode`：
  以 `isBackupCode` 偵測貼的是 nsec 還是備份碼，是備份碼就需備份密碼、`parseBackupCode` 解出 nsec。
  NsecSignInScreen 的祕密欄**同時吃 nsec 與備份碼**（偵測到備份碼才顯示「備份密碼」欄），一個欄位兩用。

### 3. 救援路徑自動升級

解鎖畫面的「改用 nsec」逃生口（ADR-0073）導到 NsecSignInScreen——因為 §2 讓該畫面也吃備份碼，
**救援自動同時支援 nsec 與備份碼**，無需另闢畫面。

### 4. 純邏輯共用、UI 只接線

所有密碼學（NIP-49、Argon2id）留在 `@cinder/core`，行動端只加薄接線與 UI；錯誤一律回 i18n
MessageKey（`backup_wrong` 等），畫面翻譯。備份碼錯密碼與壞信封**回同一個鍵**（不細分，不給訊號）。

## 理由

- 這三項都是「core 已備、行動端缺 UI」——正解是接線與重用，不是重寫。與 ADR-0133/0134 同一模式。
- 密碼真正參與加密（Argon2id 包裹 nsec、NIP-49 包裹備份）：改密碼＝重新包裹、備份碼錯密碼＝
  解不開，**都不靠比對憑證**——延續 ADR-0067 的「密碼即解密原料」紅線。
- 備份碼密文**使用者自持**（顯示/複製，不上雲、不發佈）——沒有可查詢密文就沒有密碼猜測神諭
  （ADR-0070）。

## 後果

- 正面：
  - 行動端能**改本地密碼**、**產生加密備份碼**、**用備份碼登入/救援**——身分安全補齊到桌面水準。
  - 換機救援體驗從「手抄明文 nsec」升級為「貼備份碼＋密碼」。
  - 測試 +16（auth-security 7：備份碼登入 nsec/正確/錯誤密碼分流、改密碼 round-trip/錯舊密碼/空新密碼；
    clipboard 3；UI SSR 6：改密碼/備份碼/備份密碼欄的顯示分流）。全綠：mobile 99→115。

- 已知限制：
  - 產生的備份碼**沒有 QR**（桌面有；行動端這版只給可複製字串）。QR 產生器目前是桌面專屬
    （`apps/desktop/src/qr.ts`），要行動端也有需先下沉共用——列為後續。
  - 行動端的互動流程（打字產碼、改密碼提交）是 SSR 級測試（顯示分流），非 jsdom 級；核心產碼/改密碼
    邏輯在 `auth-security.test.ts` 與 core 有完整單元測試。同 ADR-0133/0134 的取捨。
  - 行動端救援是「重貼 nsec/備份碼＝同一 pubkey namespace，本機加密資料自然解得開」（DEK 由 nsec 導出）
    ——非桌面 ADR-0073 的雙重包裹 `rescue:` blob；兩者殊途同歸（都靠 nsec 救回本機資料）。
