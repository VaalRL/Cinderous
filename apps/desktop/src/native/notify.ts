// 桌面通知服務（ADR-0076）：把「跳通知」抽象成一層可換基質。
//
// - Tauri 執行期：走 tauri-plugin-notification 的原生系統 toast（Windows WinRT toast /
//   macOS UNUserNotification / Linux libnotify），打包後可靠、可帶 App 身分與點擊 action。
// - 瀏覽器/開發：**Web Notification 基質來自 `@cinder/engine`**（ADR-0116）——行動端用的是
//   同一份，不各寫一遍。
//
// 「僅他人訊息＋視窗未聚焦才跳」的判斷仍在 App 端；本服務只負責權限與傳遞。
// 介面為 async——原生外掛的權限查詢/傳遞天生非同步。

import { type Notifier, type NotifyPayload, onWebNotificationClick, webNotifier } from "@cinder/engine";
import { isTauri } from "@tauri-apps/api/core";

export type { Notifier, NotifyPayload };

/** 瀏覽器/開發後備：共用的 Web Notification 基質（ADR-0116）。 */
export const browserNotifier = webNotifier;

/** Tauri：原生系統 toast（tauri-plugin-notification）。外掛以動態載入，避免非 Tauri 環境相依。 */
export const tauriNotifier: Notifier = {
  async ensurePermission() {
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      return granted;
    } catch {
      return false;
    }
  },
  async notify(p) {
    try {
      const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
      if (!(await isPermissionGranted())) return;
      // convo 夾帶於 extra，供點擊時（onAction）讀回對應對話（ADR-0076 N3）。
      sendNotification({ title: p.title, body: p.body, ...(p.convo ? { extra: { convo: p.convo } } : {}) });
    } catch {
      /* 忽略通知失敗 */
    }
  },
};

/** 依執行環境選用通知基質：Tauri → 原生 toast；否則 Web Notification 後備。 */
export function getNotifier(): Notifier {
  return isTauri() ? tauriNotifier : browserNotifier;
}

/**
 * 註冊通知點擊回呼（App 掛載時呼叫一次，ADR-0076 N3）。回傳取消註冊函式。
 * - 瀏覽器：由 `browserNotifier.notify` 設定的 `onclick` 於點擊時呼叫此 handler。
 * - Tauri：接外掛 `onAction`（點擊/動作）→ 先 `focus_window` 叫回視窗，再交 handler 開對話。
 *   註：桌面各 OS 的點擊 action 支援度不一，需於打包版實機確認；通知本身（顯示）不受影響。
 */
export function onNotificationClick(handler: (convo?: string) => void): () => void {
  const offWeb = onWebNotificationClick(handler); // 瀏覽器路徑（共用基質，ADR-0116）
  let unlisten: (() => void) | undefined;
  if (isTauri()) {
    void (async () => {
      try {
        const [{ onAction }, { invoke }] = await Promise.all([
          import("@tauri-apps/plugin-notification"),
          import("@tauri-apps/api/core"),
        ]);
        const listener = await onAction((n) => {
          void invoke("focus_window").catch(() => {});
          handler((n.extra as { convo?: string } | undefined)?.convo);
        });
        unlisten = () => void listener.unregister();
      } catch {
        /* 外掛不支援點擊回呼時略過（通知仍會顯示） */
      }
    })();
  }
  return () => {
    offWeb();
    unlisten?.();
  };
}
