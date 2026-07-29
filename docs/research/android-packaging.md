# 研究：Android 打包方案比較（結論：Capacitor）

> 目的：評估把 Cinderous 行動端做成可安裝 Android app 的各種方案。
> 判準：與現有程式碼的落差、能否滿足 ADR-0272（背景推播）的需求、上架管道、長期維護成本。
> 相關：ADR-0063（行動端骨架＝react-native-web）、ADR-0116（通知平台縫）、ADR-0272（背景推播決策）、
> ADR-0101（行動端通話）、`apps/mobile/src/native/`（平台縫）。結論先行。

## 前提：行動端目前**不是**原生 app

`apps/mobile` 只有 `react-native-web`——**沒有** `react-native`／`expo`／`android/`，
build 產物是 `vite build` 的**網頁包**。它今天跑在瀏覽器裡，沒有任何 Android 打包能力。

好消息：`src/native/`（`call-media.tsx`／`notify.ts`／`files.ts`／`share.ts`／`clipboard.ts`／
`avatar.ts`）是**刻意預留的平台縫**，每個檔頭都寫明「移植到真 RN 時只換本檔內部，介面不變」。
所以問題不是「怎麼打包」，而是**「要保留多少瀏覽器平台」**。

## 量化：真 RN 路線的實際落差（2026-07-29 實測）

| 項目 | 數量 | 說明 |
| --- | --- | --- |
| `localStorage` 呼叫點 | **95 處**（行動端 45／engine 50） | **這是最大成本**：`localStorage` 是同步 API，`AsyncStorage` 是非同步——換過去等於改變呼叫形狀（深層重構，非取代字串）。`react-native-mmkv` 是同步 API，可大幅降低此成本但仍需逐處驗證 |
| 瀏覽器全域（`RTCPeerConnection`／`Notification`／`navigator.*`） | 26 處 | 多數已收斂在 `native/` 縫；WebRTC 走 `react-native-webrtc` 的 `registerGlobals()` 可補回（`call-media.tsx` 已寫明作法） |

WebView 路線（Capacitor／Tauri）**這 121 處全部零改動**——因為它們就是在瀏覽器環境裡跑。

## 五個方案

| 方案 | 與現碼落差 | 背景收訊 | 上架 | 評價 |
| --- | --- | --- | --- | --- |
| **① PWA 直接安裝** | 零 | ❌ | 不能上架 | 零成本試水溫 |
| **② TWA** | 極小 | ❌ | ⚠️ Play「minimum functionality」審核風險 | 沒解決核心問題 |
| **③ Capacitor** | 極小（包網頁包） | 🟢 外掛可得 | ✅ Play／F-Droid | **建議** |
| **④ Tauri v2 mobile** | 極小 | 🟡 需自寫 Kotlin | ✅ | 生態年輕，統一工具鏈的好處不如預期 |
| **⑤ 真 RN／Expo** | **大**（見上表 121 處） | 🟢 生態最成熟 | ✅ | 長期方向，非現在 |

## 決定性因素：ADR-0272 的兩項需求

ADR-0272 定了 **Android 預設走前台服務（零第三方）、FCM 推播為 opt-in 省電替代**。
於是打包方案必須同時支援**前台服務**與 **FCM**——這刷掉了 ①②（WebView 純網頁殼兩者皆無）。

剩下 ③④⑤ 都做得到，差別在成本：

- **③ Capacitor**：`@capacitor/push-notifications`（官方，FCM）現成；前台服務有社群外掛，
  或自寫一個小 Kotlin plugin（Capacitor 的 plugin API 簡單）。WebRTC 在 Android WebView
  （Chromium）可用，只需 manifest 權限。**121 處零改動**。
- **④ Tauri v2 mobile**：前台服務與推播都要自己寫 Kotlin，行動端外掛生態明顯較 Capacitor 年輕。
  「與桌面統一工具鏈」的誘因**比表面上弱**——桌面打包的是 `apps/desktop`（另一套 UI），
  Android 要打包的仍是 `apps/mobile`，兩者不共用前端程式碼，只共用 Rust 心智模型。
- **⑤ 真 RN**：外掛生態最成熟，但要先付那 121 處的搬遷成本。

## 上架管道：F-Droid 與本專案天然契合

AGPL 開源、**無專有相依**正是 F-Droid 的硬要求。ADR-0272 的設計恰好讓這件事變簡單：

> **F-Droid flavor ＝不含 FCM，只有前台服務**（正好是 ADR-0272 定的 Android 預設）；
> **Play flavor ＝額外提供 FCM opt-in**。

兩個 flavor 的差異剛好落在一個已經是「可選」的功能上，不需要為了上架而扭曲架構。
（Play 商店則需另外處理前台服務的政策說明。）

## 結論與建議路線

**選 ③ Capacitor。** 理由：

1. **121 處瀏覽器 API 零改動**——這是與 ⑤ 的決定性差距，且行動端功能仍在快速演進（行事曆、
   搜尋才剛上），此時凍結程式碼做大搬遷的時機不對。
2. **ADR-0272 的兩項需求都有現成或低成本解**（官方 FCM 外掛＋小型前台服務 plugin）。
3. **WebView 儲存是 app-private**，不像瀏覽器會被系統清掉——`localStorage` 路徑可安心沿用。
4. 相對 ④，外掛生態成熟太多；相對 ②，不必冒審核風險且真正解決背景收訊。

**分階段：**

1. **短期**：① PWA 已可安裝試用（零成本、先收回饋）。
2. **本階段**：③ Capacitor 產出 APK——先求「可安裝＋前台服務保連線＋本機通知」，
   FCM 依 ADR-0272 為 opt-in 後續接上。F-Droid／Play 雙 flavor。
3. **長期**：⑤ 真 RN 才做原生體驗（相機／相簿／分享深度整合）；屆時 `native/` 縫與
   `react-native-mmkv`（同步 API）是降低那 95 處搬遷成本的關鍵。

**不建議**：② TWA（審核風險＋沒解決背景收訊）、④ Tauri mobile（成本高於 Capacitor，
且「統一工具鏈」的收益因前端不共用而打折）。

> 本文件為**研究記錄、非決策**。啟動 Capacitor 整合時另立 ADR（含 flavor 策略、
> 前台服務的常駐通知文案、權限清單）。
