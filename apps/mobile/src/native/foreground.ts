// 背景連線保活的平台縫（ADR-0272 / ADR-0274）。
//
// 這是**唯一**碰前台服務 API 的地方——UI 只呼叫這裡。
//
// ## 為什麼需要它
//
// 行動端的訊息靠一條到中繼的 WebSocket。App 一進背景，Android 隨時可能回收行程 →
// 連線斷、訊息收不到。**前台服務**（常駐通知）讓行程活著，是 ADR-0272 定的 Android
// 預設路徑：**零第三方**（不需 FCM，因此不把「你何時收到訊息」洩漏給 Google）。
//
// ## 誠實的限界
//
// 服務保證的是「行程活著」。WebView 在背景時 Chromium 仍可能節流 JS 計時器
//（同瀏覽器分頁的背景節流，ADR-0113）——收訊是網路事件、通常不受計時器節流影響，
// 但確切行為依 Android 版本與 OEM 省電策略而異，**必須實機驗收**。
//
// 非 Capacitor 環境（瀏覽器預覽、桌面）一律 no-op 且回報不支援，呼叫端據此不顯示開關。

import { capacitor, isNativeShell } from "./platform.js";

/** 本檔用到的外掛形狀（原生殼判斷共用 `platform.ts`，不在此重複一份）。 */
interface ForegroundPlugin {
  start(o: { title: string; text: string }): Promise<void>;
  stop(): Promise<void>;
}

function cap(): { Plugins?: { Foreground?: ForegroundPlugin } } | undefined {
  return capacitor() as { Plugins?: { Foreground?: ForegroundPlugin } } | undefined;
}

/** 此環境是否支援背景保活（＝Capacitor 原生殼且外掛在）。 */
export function foregroundSupported(): boolean {
  return isNativeShell() && !!cap()?.Plugins?.Foreground;
}

/**
 * 啟動前台服務保住連線；文案由呼叫端帶入（i18n 單一來源，不寫死在原生層）。
 * 不支援的環境回 false；啟動失敗（如 Android 12+ 的背景啟動限制）亦回 false
 * ——**不假裝連線受保護**。
 */
export async function startForeground(title: string, text: string): Promise<boolean> {
  const plugin = cap()?.Plugins?.Foreground;
  if (!foregroundSupported() || !plugin) return false;
  try {
    await plugin.start({ title, text });
    return true;
  } catch {
    return false;
  }
}

/** 停止前台服務（登出或使用者關閉時）。不支援的環境為 no-op。 */
export async function stopForeground(): Promise<void> {
  const plugin = cap()?.Plugins?.Foreground;
  if (!foregroundSupported() || !plugin) return;
  try {
    await plugin.stop();
  } catch {
    /* 停不掉不影響使用；服務最終會隨行程結束 */
  }
}

/** 使用者偏好的儲存鍵（裝置層——常駐通知是這台裝置的體驗，不隨身分）。 */
export const FOREGROUND_KEY = "nb.foreground";

/**
 * 是否啟用背景保活。**Android 預設開**（ADR-0272：零第三方的預設路徑）；
 * 使用者可於設定關閉（常駐通知是有感代價）。非原生環境恆 false。
 */
export function foregroundEnabled(): boolean {
  if (!foregroundSupported()) return false;
  try {
    return localStorage.getItem(FOREGROUND_KEY) !== "0"; // 未設＝開
  } catch {
    return true;
  }
}

export function setForegroundEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(FOREGROUND_KEY);
    else localStorage.setItem(FOREGROUND_KEY, "0");
  } catch {
    /* 忽略 */
  }
}
