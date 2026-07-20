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

/** 可個別開關通知的事件（ADR-0217）。`mention` 不是獨立事件，而是群訊的加權旗標（見 NotifyPrefs）。 */
export type NotifyEvent = "dm" | "group" | "nudge" | "call" | "request" | "reaction";

/** 各事件是否跳通知的使用者偏好（ADR-0217）。`mention`＝「@我一律通知」（override 群組關）。 */
export interface NotifyPrefs {
  dm: boolean;
  group: boolean;
  mention: boolean;
  nudge: boolean;
  call: boolean;
  request: boolean;
  reaction: boolean;
}

/** 預設：日常事件開、擾民事件（陌生人請求／被回應）預設關。 */
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  dm: true,
  group: true,
  mention: true,
  nudge: true,
  call: true,
  request: false,
  reaction: false,
};

/** shouldNotify 的情境（ADR-0217）。 */
export interface NotifyContext {
  event: NotifyEvent;
  /** 總開關（設定的桌面通知開/關）。 */
  masterOn: boolean;
  /** 視窗/分頁未聚焦（看得到就不用跳）。 */
  windowHidden: boolean;
  /** 企業下班靜音（ADR-0157）。 */
  offHoursMuted: boolean;
  /** 此對話已被使用者靜音（每對話靜音，ADR-0217）。 */
  convoMuted: boolean;
  /** 群訊是否 @我（供 mention override）。 */
  mentionsMe?: boolean;
}

/**
 * 決定桌面/瀏覽器 toast 是否該跳（ADR-0217，純函式、可測）——收斂所有閘門：
 * 總開關 → 視窗未聚焦 → 非下班靜音 → 對話未靜音 → 該事件開關（群訊含 @我 override）。
 * in-app 效果（響鈴、震動、未讀）不歸此函式管。
 */
export function shouldNotify(prefs: NotifyPrefs, ctx: NotifyContext): boolean {
  if (!ctx.masterOn || !ctx.windowHidden || ctx.offHoursMuted || ctx.convoMuted) return false;
  switch (ctx.event) {
    case "dm":
      return prefs.dm;
    case "group":
      return prefs.group || (prefs.mention && !!ctx.mentionsMe);
    case "nudge":
      return prefs.nudge;
    case "call":
      return prefs.call;
    case "request":
      return prefs.request;
    case "reaction":
      return prefs.reaction;
    default:
      return false;
  }
}
