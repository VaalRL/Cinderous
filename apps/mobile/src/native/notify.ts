// 行動端通知平台縫（ADR-0116 / ADR-0410）。
//
// 這是**唯一**碰通知平台 API 的地方——UI 只呼叫這裡，不直接碰 `Notification`。
// 行動端跑在 react-native-web（DOM）。瀏覽器預覽沿用 `@cinderous/engine` 的 Web Notification
// 基質——**與桌面的瀏覽器路徑是同一份實作**，不各寫一遍（ADR-0116）。
//
// **Android 殼（Capacitor）裡的 WebView 沒有 Web Notification API**（`Notification` 是
// undefined），所以那裡改走原生 `LocalNotify` 外掛：向系統要 POST_NOTIFICATIONS、用系統
// 本機通知跳訊息（ADR-0410）。一樣不經任何第三方推播。
//
// 移植到真正的 React Native 時只需換掉本檔內部：
//   - `notifier`     → expo-notifications（本機通知）
//   - `onNotifyClick` → Notifications.addNotificationResponseReceivedListener
// 介面與呼叫端皆不變（比照 `native/files.ts`、`native/call-media.tsx`）。
//
// 註：本機通知**只在 App 還活著時有效**。真正的「App 關掉也收得到」需要推播
// （FCM/APNs），那會把「有訊息」這件事洩漏給推播供應商——與 Cinderous 的威脅模型衝突，
// 需另立 ADR 評估（見 ADR-0116 的「不做什麼」）。

import { type Notifier, type NotifyPayload, onWebNotificationClick, webNotifier } from "@cinderous/engine";
import { capacitor, isNativeShell } from "./platform.js";

export type { NotifyPayload };

interface ListenerHandle {
  remove(): Promise<void> | void;
}

/** 原生 LocalNotify 外掛的形狀（`android/.../LocalNotifyPlugin.java`）。 */
interface LocalNotifyPlugin {
  requestPermission(): Promise<{ granted: boolean }>;
  notify(o: NotifyPayload): Promise<void>;
  // Capacitor 版本不同，可能回 Promise，也可能直接回 handle（Pixel 8a 實機就是後者）。
  addListener(ev: "click", cb: (d: { convo?: string }) => void): ListenerHandle | Promise<ListenerHandle>;
}

function plugin(): LocalNotifyPlugin | undefined {
  return (capacitor()?.Plugins as { LocalNotify?: LocalNotifyPlugin } | undefined)?.LocalNotify;
}

/** 是否走原生通知（＝Capacitor 原生殼且 LocalNotify 外掛在）。 */
export function nativeNotifySupported(): boolean {
  return isNativeShell() && !!plugin();
}

const nativeNotifier: Notifier = {
  async ensurePermission() {
    try {
      return (await plugin()!.requestPermission()).granted === true;
    } catch {
      return false;
    }
  },
  async notify(p) {
    try {
      await plugin()!.notify(p);
    } catch {
      /* 忽略通知失敗——通知失敗不該影響收訊 */
    }
  },
};

/**
 * 行動端的通知基質。每次呼叫才選路：Capacitor 全域由原生殼注入，
 * 不在模組載入時就定死。
 */
export const notifier: Notifier = {
  ensurePermission: () => (nativeNotifySupported() ? nativeNotifier : webNotifier).ensurePermission(),
  notify: (p) => (nativeNotifySupported() ? nativeNotifier : webNotifier).notify(p),
};

/** 註冊通知點擊回呼（App 掛載時呼叫一次）；回傳取消註冊函式。 */
export function onNotifyClick(handler: (convo?: string) => void): () => void {
  const offWeb = onWebNotificationClick(handler);
  const p = nativeNotifySupported() ? plugin() : undefined;
  // 監聽失敗只代表點通知不會跳到對話，不能讓整個 App 掛掉。
  const sub: Promise<ListenerHandle | undefined> = p
    ? Promise.resolve()
        .then(() => p.addListener("click", (d) => handler(d.convo)))
        .catch(() => undefined)
    : Promise.resolve(undefined);
  return () => {
    offWeb();
    void sub.then((s) => s?.remove()).catch(() => undefined);
  };
}
