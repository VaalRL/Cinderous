# ADR-0335：Android 出貨必須是 release 簽章——現況是 debug 簽章且 `debuggable`

- 狀態：已採用（**決策已定，執行待 keystore**）
- 日期：2026-08-05
- 關聯：ADR-0277／0279（Android 殼與系統備份）、ADR-0112（明文不落盤）、ADR-0323（裝置金鑰保管）、`docs/SECURITY.md`〈設備竊取者〉

## 1. 起因：使用者回報安裝時顯示「不明」

查證結果——**不是名稱資源的問題**：

```
application-label:'Cinderous'      ← 所有語系都正確
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
application-debuggable
```

`CN=Android Debug` 是 Android SDK 自動產生的**通用 debug keystore**，每一台開發機都是同一把，不代表任何人。安裝確認頁要顯示「這是誰做的」，拿到的是一張沒有身分的憑證 ⇒ 顯示**不明**；解析完成後才用 APK 內的 label 顯示 Cinderous。使用者看到的「先不明、後正常」就是這個順序。

## 2. 🔴 真正嚴重的不是名稱，是 `debuggable=true`

顯示「不明」只是觀感。同一個根因帶來的另一個後果嚴重得多：

**`android:debuggable="true"` 讓任何能接上 adb 的人附著到 App 的行程**——讀記憶體、下中斷點、dump 堆積。

而這個 App 的核心賣點是**明文與私鑰不離開裝置**（ADR-0112）。session 期間 nsec 必然在記憶體裡（儲存層的 DEK 由它導出），FS 的 EK 私鑰也是。⇒ **在已 root 或開啟 USB 偵錯的機器上，這個屬性直接抵銷掉一大部分 at-rest 保護。**

⚠ 這不是本次引入的迴歸——`assembleDebug` 從 Android 首發（v0.0.14）就是這樣，只是**沒有人把它寫下來**。

## 3. 這個缺口先前沒有被記錄

`docs/SECURITY.md` 與 `OPERATOR-TODO` 都記了「**桌面版**尚未程式碼簽章（SmartScreen 警告）」，但 **Android 側完全沒有對應條目**。

v0.0.15 的 release note 只寫了「APK 是 debug 簽章版，首次安裝需允許未知來源」——**那句話說的是安裝不便，不是安全後果**。這是揭露不足。

## 4. 決策

**Android 出貨必須改為 release 簽章**（`assembleRelease` ＋ 專屬 keystore），`debuggable` 隨之為 false。

**但 keystore 由專案維護者產生與保管，本次刻意不產。** 理由不是拖延：

🔴 **一旦用某把 keystore 發布過，之後每一版都必須用同一把。** 換金鑰的 APK **無法覆蓋安裝**——使用者必須先解除安裝，**該裝置上的資料全部消失**（而這個 App 預設純本機、沒有雲端備份的人救不回來）。

⇒ 這把金鑰的備份重要性等同 nsec，值得慎重產生與保管，不該在一次順手的改動裡帶過。

### 4.1 不得發生的事

- **keystore 與密碼不得進版控**（走 `local.properties` 或環境變數，`.gitignore` 已涵蓋前者）。
- **不得為了「先讓它能簽」而用臨時金鑰發布**——那等於提前鎖死一把不打算長期保管的金鑰。

## 5. 在那之前的義務：說實話

既然暫不修，揭露就必須到位。發版說明與 `SECURITY.md` 要寫出**後果**而不只是安裝步驟：

> 這個 APK 是 debug 簽章且**可被偵錯**。任何能接上 adb 的人可以附著到 App 的行程並讀取記憶體，其中包含你的私鑰。請勿在已 root 或長期開啟 USB 偵錯的裝置上，用它處理你真正在意的對話。

⚠ 這句話難看，但**難看的實情勝過好看的假話**——同 ADR-0297 §6 對裝置金鑰等級的處置。

## 6. 買不到什麼

1. **release 簽章不會讓 App 變成「可信」**。它只讓「同一個開發者的後續版本」可驗證，以及讓 `debuggable` 關掉。第一次安裝仍會是未知來源。
2. **不解決 Google Play 的上架問題**（另需帳號、政策審查、隱私標籤）。本 ADR 只處理 sideload 的簽章與偵錯屬性。
3. **不改變桌面版未程式碼簽章的現況**（另一個待辦，需憑證）。
