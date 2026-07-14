// 通知（ADR-0076 / 0116）：**平台無關**的 Web Notification 基質 ＋ 內文組裝。
//
// 桌面（Tauri）另有原生 toast（`apps/desktop/src/native/notify.ts`）；但**瀏覽器路徑與行動端
// 用的是同一套 Web Notification API**——這裡是它的單一來源，兩端不各寫一份。
//
// 「何時該跳」（僅他人訊息、且視窗未聚焦）的判斷仍在各 App 的 `onMessage`；本模組只負責
// 權限、傳遞與**內文組裝**。

/** 一則通知的內容；`convo` 為對話鍵（聯絡人 pubkey 或群組 id），供點擊回跳。 */
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

/** 通知點擊回呼（App 掛載時註冊）：叫回視窗後開啟該對話。 */
let clickHandler: ((convo?: string) => void) | undefined;

/** 註冊 Web 通知的點擊回呼；回傳取消註冊函式。 */
export function onWebNotificationClick(handler: (convo?: string) => void): () => void {
  clickHandler = handler;
  return () => {
    clickHandler = undefined;
  };
}

/** Web Notification API 基質（瀏覽器與行動端 RN-web 共用）。 */
export const webNotifier: Notifier = {
  async ensurePermission() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    // 已拒絕就別再問——重複請求會被瀏覽器忽略，還會讓使用者以為壞掉了。
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
      /* 忽略通知失敗——通知失敗不該影響收訊 */
    }
  },
};

/**
 * 組裝一則訊息通知（**純函式**，ADR-0076）。
 *
 * `hidePreview`＝**隱私開關**：通知會出現在鎖定畫面／通知中心，等於把明文推到裝置的
 * 「非加密表面」。開啟時只說「有新訊息」，**絕不放內容**。
 *
 * 群訊在內文前綴發送者名（否則群組裡誰說的都分不出來）。
 */
export function notificationFor(opts: {
  /** 對話鍵（聯絡人 pubkey 或群組 id），供點擊回跳。 */
  convo: string;
  /** 標題＝對話顯示名（群組名或聯絡人名）。 */
  convoName: string;
  text: string;
  /** 群訊的發送者顯示名；1:1 省略。 */
  senderName?: string;
  hidePreview: boolean;
  /** 隱藏預覽時的提示語（i18n）。 */
  newMessageLabel: string;
}): NotifyPayload {
  const body = opts.hidePreview
    ? opts.newMessageLabel
    : opts.senderName
      ? `${opts.senderName}: ${opts.text}`
      : opts.text;
  return { title: opts.convoName, body, convo: opts.convo };
}
