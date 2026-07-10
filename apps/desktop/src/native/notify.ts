// 桌面通知服務（ADR-0076）：把「跳通知」抽象成一層可換基質。
//
// - Tauri 執行期：走 tauri-plugin-notification 的原生系統 toast（Windows WinRT toast /
//   macOS UNUserNotification / Linux libnotify），打包後可靠、可帶 App 身分與點擊 action。
// - 瀏覽器/開發：Web Notification API 後備，維持既有行為。
//
// 「僅他人訊息＋視窗未聚焦才跳」的判斷仍在 App 端；本服務只負責權限與傳遞。
// 介面為 async——原生外掛的權限查詢/傳遞天生非同步。

import { isTauri } from "@tauri-apps/api/core";

/** 通知點擊回呼（App 掛載時註冊）：叫回視窗後開啟該對話。`convo` 可能未帶（無法對應時略過）。 */
let clickHandler: ((convo?: string) => void) | undefined;

/** 一則通知的內容；`convo` 為對話 pubkey，供點擊回跳（N3）。 */
export interface NotifyPayload {
  title: string;
  body: string;
  convo?: string;
}

/** 通知基質：權限確認 ＋ 送出。 */
export interface Notifier {
  /** 請求/確認通知權限；回是否已授權（拒絕或環境不支援回 false）。 */
  ensurePermission(): Promise<boolean>;
  /** 送出一則通知；權限未授予或環境不支援時靜默略過（不丟例外）。 */
  notify(p: NotifyPayload): Promise<void>;
}

/** 瀏覽器/開發後備：Web Notification API（維持既有行為）。 */
export const browserNotifier: Notifier = {
  async ensurePermission() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      return (await Notification.requestPermission()) === "granted";
    } catch {
      return false;
    }
  },
  async notify(p) {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const n = new Notification(p.title, { body: p.body });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* 忽略 */
        }
        clickHandler?.(p.convo);
      };
    } catch {
      /* 忽略通知失敗 */
    }
  },
};

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
  clickHandler = handler;
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
          clickHandler?.((n.extra as { convo?: string } | undefined)?.convo);
        });
        unlisten = () => void listener.unregister();
      } catch {
        /* 外掛不支援點擊回呼時略過（通知仍會顯示） */
      }
    })();
  }
  return () => {
    clickHandler = undefined;
    unlisten?.();
  };
}
