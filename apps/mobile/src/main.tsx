// 行動端**正式進入點**（ADR-0277）。
//
// 在此之前，`index.html` 直接載入 `preview.tsx`——那是開發用的預覽台：手機外框、
// 「示範／真實 relay」切換鈕、可複製的示範 nsec、以及一段「示範模式：可與機器人小幫手對話」
// 的說明文字。因為 Capacitor 的 `webDir` 就是這份 vite 產物（`dist/`），**Android APK 開起來
// 看到的就是那個預覽台**：使用者被要求先複製一串 nsec、貼進「用私鑰登入」才進得去，
// 而且預設連的是記憶體示範後端（訊息根本不出裝置）。
//
// 這裡把兩者分開：
//  - `index.html` → 本檔：滿版跑真 App、預設連生產錨點、無任何示範字樣。
//  - `preview.html` → `preview.tsx`：開發預覽台保留，但只在 `vite dev` 服務得到，
//    **不列入 build 輸入**，故不會進 `dist/`、也就不會被打進 APK。
import { createRoot } from "react-dom/client";
import { DEFAULT_RELAY } from "./backend.js";
import { MobileApp } from "./MobileApp.js";

const el = document.getElementById("root");
// 預設明亮（ADR-0248：所有版本初次登入一律明亮模式）；使用者在「設定」改的偏好由 App 自行讀回。
if (el) createRoot(el).render(<MobileApp initialTheme="light" relayUrl={DEFAULT_RELAY} />);
