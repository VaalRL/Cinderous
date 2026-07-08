# 0063. Phase D 行動端骨架：react-native-web 於此環境開發、重用 core/i18n

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：ROADMAP Phase D；ADR-0053（Tauri 桌面基質——同樣「webview 跑既有前端」的重用精神）
- 觸發：Phase D 行動端要起步，但開發環境無 Android SDK/Xcode/模擬器。

## 背景與問題

行動端（D1–D4）要開始，但沙箱**沒有原生工具鏈**，無法 `cargo`/Xcode/Gradle 建置或跑模擬器。需要一條「此環境就能推進」的路。

## 決策

**新增 `apps/mobile`（Expo/RN 套件），以 `react-native-web` 在瀏覽器開發＋測試 RN UI，並最大化重用既有邏輯層。**

1. **模組邊界：** `apps/mobile` 為獨立 workspace 套件，**依賴 `@cinder/core`（協定/加密/Nostr/WebRTC 全部）與 `@cinder/i18n`（多語系）**——行動端幾乎不重寫邏輯，只重寫 UI 呈現層。
2. **UI 以 RN 元件撰寫**（`View`/`Text`/`StyleSheet`…），經 **`react-native-web`** 在此環境渲染；測試用 `react-dom/server` `renderToStaticMarkup`（與桌面測試同法），vitest 即可驗。實測：`react-native-web` 在此環境安裝與渲染皆成功。
3. **原生打包／端上 LLM 延後：** APK/IPA 與 `llama.rn` 等端上模型推論需真機/模擬器或 **Expo EAS 雲端**——不在此環境；此環境只寫介面與邏輯、跑 web 驗證。
4. **型別暫用最小 ambient shim：** `react-native-web` 未附 tsc 可用型別，先自帶最小宣告；上原生時改真 RN 型別。
5. **可攜性：** 目前直接 `import "react-native-web"`；上原生時加 bundler 別名（`react-native`→`-web`）讓同一份原始碼跨 web/native。

## 理由

- **此環境即可推進 Phase D 一大半**（UI + 邏輯），不必等工具鏈。
- **重用邏輯層**：`@cinder/core`/`@cinder/i18n` 直接接，行動端與桌面共用同一真實來源（SSOT）。
- **與 ADR-0053 一致的重用精神**：桌面用 webview 跑既有前端；行動端用 RN-web 跑同源邏輯。

## 後果

- 正面：行動端 UI/邏輯可在此環境開發＋測試（`ContactListScreen` 起手綠）。
- 負面 / 已知限制：
  - 原生二進位與端上 LLM 推論需工具鏈/EAS（無法在此實測）。
  - RN-web 與原生行為有細微差異（手勢/原生模組），最終仍需真機驗收。
  - ambient shim 型別鬆散，為暫時方案。
- 後續：移植登入/對話畫面、i18n Provider、接 `@cinder/core` 引擎；原生走 EAS 或本機工具鏈。
