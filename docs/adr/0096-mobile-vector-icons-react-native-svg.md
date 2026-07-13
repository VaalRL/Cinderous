# 0096. 行動端向量圖示：採 react-native-svg＋web 端解析設定（收斂 ADR-0095 的兩項後續）

- 狀態：已接受（已實作）
- 日期：2026-07-13
- 相關文件：ADR-0095（訊息狀態圖示語言）、0080（@cinder/theme 設計 token SSOT）、0085（行動端）

## 背景與問題

ADR-0095 導入「眼睛張合」的狀態圖示語言，幾何放 `@cinder/theme` 供雙端共用。但當時行動端以**內嵌
DOM `<svg>`** 渲染——在 react-native-web 可行，**移植到真正的 React Native 會直接壞掉**（RN 沒有 DOM）。
ADR-0095 把它列為殘餘風險；本 ADR 收斂之，並一併補上行動端的群組已讀 UI。

## 考量的選項

- **A. 維持內嵌 `<svg>`**：零依賴，但行動端只能停在 web preview，RN 移植時必炸。**不採**。
- **B. 以 `View` 原語拼出圖示**（borderRadius/transform）：可攜、零依賴，但眼睛的張合這種曲線造型畫不好，
  視覺品質明顯劣化、且與桌面失去「同一套」。**不採**。
- **C. 採 `react-native-svg`（採用）**：Expo/RN 生態的**事實標準**（Expo 內建），API 與 SVG 幾乎一致；
  react-native-web 也支援。元件原始碼因此完全可攜。

## 決策

1. 行動端圖示改用 `react-native-svg`（`Svg`/`Path`/`Circle`），幾何仍取自 `@cinder/theme`（單一來源不變）。
2. **web 端解析設定**（`apps/mobile/vite.config.ts`）——這是採用 C 的必要配套：
   - `react-native` → `react-native-web`（RNW 標準別名）。
   - `react-native-svg` → **直接指向其 ESM web 實作** `lib/module/ReactNativeSVG.web.js`。
     不這樣做的話，預設會挑 **native** 實作，那條路會 import `react-native/Libraries/...`（Flow 語法），
     web／vitest 環境無法解析（實測：只靠 `.web.*` 副檔名優先、別名、甚至 `deps.inline: true` 都救不回來）。
   - `.web.*` 副檔名優先：讓 web 實作內部的相對匯入（`./elements`、`./web/WebShape`）也落到 web 版。
   - vitest：`server.deps.inline` 以 **regex** 指定（pnpm 巢狀路徑會讓字串比對失效）。
3. 行動端補上群組已讀 UI，與桌面同一套分級（ADR-0095）：≤5 名單制、6–10 計數制、>10 不顯示。

## 理由

- **可攜性是重點**：原始碼維持 `import Svg from "react-native-svg"`；**Metro 自行挑 native 實作**，
  web 端才需要上述別名。也就是說，這些設定只是 web 打包的細節，不污染元件。
- 視覺與桌面完全一致（同一份幾何），不必為行動端另做一套劣化圖示。

## 後果

- 正面：行動端圖示可直接隨 RN/Expo 移植；ADR-0095 的兩項殘餘風險（內嵌 svg、群組已讀未渲染）皆收斂。
- 負面 / 已知殘餘風險：
  - 多一個依賴（`react-native-svg`），並連帶把 `react-native` 拉進 node_modules 作為 peer
    （其 React 19 peer 與本專案 React 18 有告警，但不影響 web preview 的建置與測試——已實測）。
  - web 端多了一段**打包設定的隱性知識**（別名指向 web 實作）。已在 `vite.config.ts` 註記原因，
    避免日後有人「清理」掉別名而讓建置爆炸。
  - 尚未有真正的 RN/Expo 建置可驗證 native 路徑；驗證僅到「web preview 建置 + 全測試通過」。
- 測試：行動端新增 4 項（張開眼有瞳孔／閉眼無瞳孔、名單制列名、計數制 M/N、大群不顯示），
  合計 32 項通過；`pnpm --filter @cinder/mobile build`（真實 vite 建置）通過。
