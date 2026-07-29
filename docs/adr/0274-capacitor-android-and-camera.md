# 0274. Android 打包採 Capacitor ＋ 對話內「拍照直接傳」

- 狀態：已接受
- 日期：2026-07-29
- 相關文件：ADR-0063（行動端骨架＝react-native-web）、ADR-0100（檔案平台縫）、ADR-0273（送圖去 EXIF）、
  ADR-0227（版號 SSOT）、ADR-0116（通知）、ADR-0101（通話）、ADR-0272（背景推播設計）、
  `docs/research/android-packaging.md`、`docs/research/mobile-camera-capture.md`

## 背景與問題

行動端至今只有 `react-native-web`——**沒有原生 app**，無法安裝、無法上架。兩份研究已收斂：
打包選 **Capacitor**（121 處瀏覽器 API 零改動、WebView 儲存 app-private、官方外掛齊全），
並在做相機功能前先修掉 EXIF 缺口（ADR-0273 已完成）。

## 決策

### 1. Android 打包＝Capacitor

- `apps/mobile/capacitor.config.ts`：`appId="app.cinder.mobile"`（沿用桌面 `app.cinder.desktop`
  的反向網域慣例）、`webDir="dist"`（vite 產物）。
- **刻意不設 `server.url`**：那會讓 App 去載遠端網頁（等於線上 webapp 的殼）；
  我們要的是**離線可用、資產隨版本固定**的原生包。
- `allowMixedContent: false`：自架中繼若用 `ws://` 需使用者自行於系統層放行——
  不為了方便而預設放寬傳輸安全（與桌面立場一致）。
- 建置腳本：`android:sync`（build＋cap sync）／`android:build`（＋gradle assembleDebug）／`android:open`。

### 2. 權限採最小集合

| 權限 | 用途 |
| --- | --- |
| `INTERNET` | 中繼連線 |
| `CAMERA`＋`uses-feature required=false` | 拍照直傳；無相機的裝置仍可安裝 |
| `RECORD_AUDIO`／`MODIFY_AUDIO_SETTINGS` | WebRTC 通話（ADR-0101） |
| `POST_NOTIFICATIONS` | Android 13+ 本機通知執行期權限（ADR-0116） |

**刻意不要相簿讀取權限**：`<input capture>` 與相機外掛都經**系統選擇器**取得單一檔案，
不需要「讀取全部照片」這種寬權限。

### 3. 版號納入既有 SSOT（ADR-0227）

Capacitor 產生的 `android/app/build.gradle` 有自己的 `versionName`／`versionCode`，
不納入 `version-sync` 就**必然漂移**。故：

- `versionName` 加入 targets（字串替換，同其他目標）；
- `versionCode` 另行處理——Play 要求**單調遞增整數**，以
  `major*10000 + minor*100 + patch` **決定性推導**（同一語意版號恆得同一 code，
  不需人工維護、重建不跳號）。CI 既有的 `version:check` 因此自動涵蓋 Android。

### 4. 對話內「拍照直接傳」

- 平台縫 `native/files.ts` 新增 **`takePhoto()`**，以 `<input capture="environment">` 實作
  ——**行動瀏覽器與 Android WebView（含 Capacitor）都直接開相機**，因此**零額外相依**即可運作。
  日後若要在**原生層先縮圖**（省 WebView 記憶體）再改用 `@capacitor/camera`，
  介面與呼叫端不變（沿用本檔既有的「同介面、換內部」模式）。
- **不預先安裝 `@capacitor/camera`**：實作既然走 `<input capture>`，該外掛就是未使用的相依——
  而它（v8）要求 **Java 21 toolchain**，本機的 Java 17 因此建置失敗。用不到的相依不只是體積，
  是**會擋住建置的真實風險**；需要時再裝（YAGNI）。
- 位元組同樣經 `sanitizeImage`（ADR-0273）——**剛拍的照片 GPS 最準，這條路徑尤其不能漏**。
- UI：對話輸入列新增 📷（與 📎 並列），`onSendPhoto` 未提供即不顯示（示範模式／後端不支援送檔）。

## 理由

Capacitor 讓「可安裝的 Android app」在不凍結功能開發的前提下成立（見打包研究的量化比較）。
相機以 `<input capture>` 起步是刻意的：它今天就能在瀏覽器預覽環境驗證、進 WebView 後照樣運作，
把「相機」與「Capacitor 整合」兩件事解耦——任一出問題都不會擋住另一件。權限取最小集合並
明確拒絕相簿讀取，符合專案一貫的最小授權立場。

## 後果

- **正面**：可產出 APK（debug）；相機功能在瀏覽器與 APK 皆可用；版號漂移由 CI 自動擋。
- **負面 / 已知殘餘風險**：
  - **背景收訊仍未解**——ADR-0272 的前台服務／FCM 尚未實作，App 進背景即斷線（下一步）。
  - APK 目前是 **debug 簽章**，未做 release 簽章與 F-Droid／Play 上架設定（後續）。
  - `<input capture>` 拿到的是**全解析度**照片，記憶體壓力由 `sanitizeImage` 的 2048px 重編碼
    緩解，但解碼瞬間仍需完整影像——極低階裝置若 OOM，屆時再裝 `@capacitor/camera`
    走原生層縮圖（介面不變；注意其 v8 需 Java 21，見「不預先安裝」一節）。
  - **Java 21 toolchain（實作時踩到、已解）**：Capacitor 的 android 函式庫硬寫
    `sourceCompatibility JavaVersion.VERSION_21`，但那**不會**讓 Gradle 去找 JDK 21——
    它只是把 `-source 21` 丟給執行 Gradle 的 JVM（本機 JDK 17）→ `invalid source release: 21`。
    解法**不是**要求每位開發者裝 JDK 21，而是：`settings.gradle` 加 foojay toolchain resolver
    ＋`build.gradle` 對**所有子專案**（含第三方模組）明確指定 `JavaLanguageVersion.of(21)`，
    Gradle 便自行把 JDK 21 下載到自己的快取（`~/.gradle/jdks`，不動系統安裝，CI 可重現）。
    註：Capacitor 7.6 與 8 皆已要求 21，降版無法迴避。
  - **`cap add android` 會重生整個 `android/`**：AndroidManifest 權限、`settings.gradle`／
    `build.gradle` 的 toolchain 設定、版號皆會被還原——重新生成後須重跑
    `pnpm version:sync` 並補回上述三處（`cap sync` 則安全，只更新 web 資產與外掛清單）。
  - `android/` 原生專案進版控會增加 repo 體積與升級維護面（Capacitor 慣例做法）。

## 後續行動 / 待辦

1. **前台服務**（ADR-0272 的 Android 預設路徑）：常駐通知＋保住 WebSocket。
2. release 簽章、F-Droid／Play 雙 flavor（F-Droid＝無 FCM，正是 ADR-0272 的 Android 預設）。
3. 實機驗收：相機拍照→傳送→對方收到；EXIF 確實消失（以 exiftool 驗收到的檔案）。
