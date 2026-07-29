// Capacitor 打包設定（ADR-0274）：把 `apps/mobile` 的 vite 網頁包裝進 Android WebView。
//
// 為何是 Capacitor 而非真 RN／Tauri mobile，見 `docs/research/android-packaging.md`
// （關鍵：121 處瀏覽器 API 零改動；WebView 儲存是 app-private 不會被系統清）。
//
// - `appId` 沿用桌面的反向網域慣例（桌面 `app.cinder.desktop`／ADR-0191 保留小寫內部識別字）。
// - `webDir` 指向 vite 產物；`pnpm build` 後跑 `npx cap sync` 才會更新 APK 內容。
// - **不設 `server.url`**：那會讓 App 載入遠端網頁（等於線上 webapp 的殼），
//   我們要的是離線可用、資產隨版本固定的原生包。
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.cinder.mobile",
  appName: "Cinderous",
  webDir: "dist",
  android: {
    // 允許 http 明文流量預設關閉——自架中繼若用 ws:// 需使用者自行於系統層放行，
    // 與桌面的立場一致（不為了方便預設放寬傳輸安全）。
    allowMixedContent: false,
  },
};

export default config;
