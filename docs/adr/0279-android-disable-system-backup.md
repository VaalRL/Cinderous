# ADR-0279：Android 預設關閉系統自動備份與裝置間轉移

- 狀態：已接受
- 日期：2026-07-29
- 相關：ADR-0071（加密雲端備份）、ADR-0112（絕不無密碼記住 nsec／靜態加密）、ADR-0118（配對搬家）、ADR-0274（Capacitor 打包）、ADR-0278（發現此問題）

## 脈絡

`AndroidManifest.xml` 的 `android:allowBackup="true"` 是 `cap add android` 產生的**樣板預設值**，
不是誰決定的。它的實際效果是：Android 的自動備份會把 app 私有目錄（含 `localStorage`、
OPFS 封存、SharedPreferences）打包上傳到使用者的 Google Drive。

落地資料本身有加密（ADR-0112：資料金鑰由 nsec 導出；nsec 以 Argon2id 包裹），
所以這不是明文外洩。但立場上仍然不對：

- 專案的預設是**明文與私鑰不離開裝置**。系統備份是一條我們既不控制、也不可見的資料外流路徑。
- 使用者從未被告知、也沒有同意過這件事——它只是樣板的預設值。
- 我們已經有**兩條**自己的搬移路徑，都在自家的加密與同意流程內：
  配對搬家（ADR-0118，P2P 直傳＋SAS 驗證）與加密雲端備份（ADR-0071，使用者明示開啟）。
  系統備份對使用者沒有增益，只是多開一個暴露面。

## 決策

**預設關閉**，且要關得完整：

```xml
<application
    android:allowBackup="false"
    android:dataExtractionRules="@xml/data_extraction_rules"
    …>
```

兩個屬性缺一不可，理由是一個容易漏掉的行為差異：

| 屬性 | 擋掉什麼 | 適用 |
| --- | --- | --- |
| `allowBackup="false"` | 備份到 Google 伺服器 | 所有版本 |
| `dataExtractionRules` 的 `<device-transfer>` | **裝置對裝置轉移**（換新機時的「複製資料」） | API 31+ |

Android 12（API 31）之後，`allowBackup="false"` **只擋雲端備份，管不到 D2D 轉移**。
本專案 `targetSdkVersion` 是 35，這條路徑一定會走到，所以必須另外用
`res/xml/data_extraction_rules.xml` 把 `<cloud-backup>` 與 `<device-transfer>` 兩段都排除。

兩段都排 `root`（app 私有目錄的根，涵蓋 file／database／sharedpref 與 WebView 的存放處）
與 `external`（外部儲存不在 root 底下，需各別排除）。

## 後果

**正面**

- 資料不再被系統搬到我們看不見的地方——無論是雲端備份或換機轉移。
- 與專案既有立場一致：要搬資料就走我們自己的、有加密與明示同意的路徑。

**負面／代價**

- **換新機時系統不會幫忙搬 Cinderous 的資料。** 這是刻意的取捨，但使用者若不知道，
  換機後會發現「什麼都沒了」。故本批一併在設定的備份區塊加上 `settings_noSystemBackup`
  說明（只在原生殼顯示——瀏覽器預覽沒有 Android 系統備份這回事），並指向配對搬家
  與加密雲端備份兩條自有路徑。
- 卸載重裝＝資料全失（本來加密後也還原不了多少，但現在是明確的行為）。

**待辦**

- `cap add android` 若重跑會把 manifest 還原成樣板預設（`allowBackup="true"`）並刪掉
  `data_extraction_rules.xml`——與 ADR-0274 記錄的權限、toolchain、版號同一類問題。
  緩解：`android-backup.test.ts` 直接讀 manifest 與規則檔斷言，被還原時測試會紅。
- 實機驗收：`adb shell bmgr` 或設定→系統→備份中，確認 Cinderous 不在備份清單內。
