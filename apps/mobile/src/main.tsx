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
import { openDeviceKey, setDeviceKeyVault, webDeviceKeyVault } from "@cinderous/engine";
import { DEFAULT_RELAY } from "./backend.js";
import { MobileApp } from "./MobileApp.js";
import { androidDeviceKeyVault } from "./native/device-keystore.js";

const el = document.getElementById("root");
// 預設明亮（ADR-0248：所有版本**初次登入**一律明亮模式）——「初次」＝沒存過偏好。
// 使用者在「設定」改過的外觀／語言／主色由 `device-prefs.ts` 讀回（ADR-0333）；
// ⚠ 這行註解在 ADR-0333 之前是**比程式碼樂觀**的：當時三個都沒有讀回機制。
if (el) {
  // ADR-0323：裝置金鑰進 AndroidKeyStore；非原生殼（網頁預覽）退而求其次走瀏覽器保管庫
  // （IndexedDB 內不可匯出的 WebCrypto 金鑰＝`encrypted`）。兩者都不支援才是 null ⇒
  // 不注入、維持明文並如實顯示。
  const vault = androidDeviceKeyVault() ?? webDeviceKeyVault();
  if (vault) setDeviceKeyVault(vault);
  // 🔴 **在 render 之前 await**：後端建構時就要裝置金鑰（它得知道自己是誰才能查裝置目錄），
  // 而 `createBackend` 是同步的。桌面選擇在 buildBackend 內 await 是因為 Linux 的 gnome-keyring
  // 可能彈解鎖框；Android 這把金鑰刻意沒設 `setUserAuthenticationRequired`，不會有提示，
  // 所以擋在這裡不會讓使用者看到空白畫面。
  void openDeviceKey().finally(() => {
    createRoot(el).render(<MobileApp initialTheme="light" relayUrl={DEFAULT_RELAY} />);
  });
}
