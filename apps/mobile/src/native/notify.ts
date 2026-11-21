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
  /** 只查、不跳對話框（ADR-0426）。舊版 APK 的外掛沒有這個方法。 */
  checkPermission?(): Promise<{ granted: boolean }>;
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

/** 系統目前允不允許發通知（ADR-0426）。`unknown`＝查不到，呼叫端不該據此改顯示。 */
export type NotifyPermission = "granted" | "denied" | "unknown";

/**
 * 查系統通知權限，**不跳對話框**（ADR-0426）：App 回到前景時用來讓開關跟系統設定同步。
 * 原生殼看 `areNotificationsEnabled()`（含使用者在系統設定把通知關掉）；瀏覽器看 `Notification.permission`。
 */
export async function notifyPermission(): Promise<NotifyPermission> {
  if (nativeNotifySupported()) {
    const check = plugin()!.checkPermission;
    if (typeof check !== "function") return "unknown";
    try {
      return (await check.call(plugin())).granted === true ? "granted" : "denied";
    } catch {
      return "unknown";
    }
  }
  const N = (globalThis as { Notification?: { permission?: string } }).Notification;
  if (!N) return "unknown";
  return N.permission === "granted" ? "granted" : N.permission === "denied" ? "denied" : "unknown";
}

/**
 * 使用者「想不想要」通知（ADR-0426）：選過就照選擇；沒選過時，Android 殼預設要（本機通知、不經第三方），
 * 瀏覽器預覽預設不要——瀏覽器只肯在使用者手勢裡要權限，開機自動問會被直接拒絕。
 */
export function initialNotifyWanted(stored: string | null, native: boolean): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return native;
}

/** 開機要不要主動問一次通知權限：只有 Android 殼、而且使用者從沒選過（ADR-0426）。 */
export function shouldAskNotifyOnStart(stored: string | null, native: boolean): boolean {
  return stored === null && native;
}

/**
 * 開關實際顯示與是否送通知（ADR-0426）：想要、而且系統沒有關掉。
 * 系統關掉時不改使用者的偏好——之後在系統設定打開、回到 App 就自動恢復。
 */
export function effectiveNotify(wanted: boolean, perm: NotifyPermission): boolean {
  return wanted && perm !== "denied";
}

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
