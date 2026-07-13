import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 行動端 web preview（ADR-0085）：以 react-native-web 在瀏覽器實跑 MobileApp（手機外框示範）。
// 同一份 vite 設定亦供 vitest 使用（test 區塊，環境 node）。
//
// React Native 生態的 **web 端** 解析（ADR-0095）：
//  - `react-native` → `react-native-web`（RNW 標準別名）。
//  - `react-native-svg` → 直接指向其 **ESM web 實作**；否則預設會挑 native 實作，
//    那條路會 import `react-native/Libraries/...`（Flow 語法，web/測試環境無法解析）。
//  - `.web.*` 副檔名優先：讓 web 實作內部的相對匯入（./elements、./web/WebShape）也落到 web 版。
//
// 這只是 **web 打包設定**；真正的 React Native 由 Metro 自行挑 native 實作，故元件原始碼維持
// 可攜的 `import Svg, { Path, Circle } from "react-native-svg"`，不需內嵌 DOM <svg>。
const rnWeb = {
  extensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
  alias: {
    "react-native-svg": "react-native-svg/lib/module/ReactNativeSVG.web.js",
    "react-native": "react-native-web",
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: rnWeb,
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // node_modules 內的 RN 套件必須經 vite 轉換，才吃得到上面的別名與 .web.* 解析。
    server: { deps: { inline: [/react-native-svg/, /react-native-web/] } },
  },
});
