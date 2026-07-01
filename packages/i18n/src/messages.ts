/** 支援的語系。 */
export type Locale = "en" | "zh-Hant";

export const LOCALES: Locale[] = ["zh-Hant", "en"];

export const DEFAULT_LOCALE: Locale = "zh-Hant";

/** 各語系語言切換器顯示的名稱。 */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-Hant": "繁中",
  en: "EN",
};

/** UI 訊息鍵；`{name}` / `{count}` 等為插值參數。 */
export interface Messages {
  appName: string;
  signIn_title: string;
  signIn_hint: string;
  signIn_hint2: string;
  signIn_displayName: string;
  signIn_relayUrl: string;
  signIn_button: string;
  contact_myId: string;
  contact_addPlaceholder: string;
  contact_add: string;
  status_online: string;
  status_away: string;
  status_busy: string;
  status_offline: string;
  group_online: string;
  group_offline: string;
  status_label: string;
  personalMessage_placeholder: string;
  contact_openHint: string;
  convo_offlineNotice: string;
  convo_typing: string;
  convo_emojiTitle: string;
  convo_nudge: string;
  convo_nudgeTitle: string;
  convo_composerPlaceholder: string;
  convo_send: string;
  convo_close: string;
  lang_label: string;
  theme_toggle: string;
}

const zhHant: Messages = {
  appName: "Nostr Buddy",
  signIn_title: "登入 Nostr Buddy",
  signIn_hint: "去中心化、端到端加密的即時通。輸入顯示名稱即可開始（你的身分是本機生成的 secp256k1 金鑰）。",
  signIn_hint2: "本示範會在記憶體中模擬中繼站與幾位好友，方便你體驗。",
  signIn_displayName: "顯示名稱",
  signIn_relayUrl: "中繼站網址（留空使用示範模式）",
  signIn_button: "登入",
  contact_myId: "我的 ID",
  contact_addPlaceholder: "貼上好友的 npub…",
  contact_add: "加好友",
  status_online: "線上",
  status_away: "離開",
  status_busy: "忙碌",
  status_offline: "顯示為離線",
  status_label: "狀態",
  group_online: "線上 ({count})",
  group_offline: "離線 ({count})",
  personalMessage_placeholder: "輸入個人訊息…",
  contact_openHint: "雙擊開啟對話",
  convo_offlineNotice: "目前離線——訊息將於對方上線時送達",
  convo_typing: "{name} 正在輸入訊息…",
  convo_emojiTitle: "表情",
  convo_nudge: "震動",
  convo_nudgeTitle: "震動對方視窗",
  convo_composerPlaceholder: "輸入訊息…（Enter 送出，Shift+Enter 換行）",
  convo_send: "送出",
  convo_close: "關閉",
  lang_label: "語言",
  theme_toggle: "深色 / 淺色模式",
};

const en: Messages = {
  appName: "Nostr Buddy",
  signIn_title: "Sign in to Nostr Buddy",
  signIn_hint: "A decentralized, end-to-end encrypted messenger. Just enter a display name to start (your identity is a secp256k1 key generated on this device).",
  signIn_hint2: "This demo simulates a relay and a few buddies in memory so you can try it out.",
  signIn_displayName: "Display name",
  signIn_relayUrl: "Relay URL (leave blank for demo mode)",
  signIn_button: "Sign in",
  contact_myId: "My ID",
  contact_addPlaceholder: "Paste a buddy's npub…",
  contact_add: "Add",
  status_online: "Online",
  status_away: "Away",
  status_busy: "Busy",
  status_offline: "Appear offline",
  status_label: "Status",
  group_online: "Online ({count})",
  group_offline: "Offline ({count})",
  personalMessage_placeholder: "Type a personal message…",
  contact_openHint: "Double-click to open a conversation",
  convo_offlineNotice: "Currently offline — your message will be delivered when they come online",
  convo_typing: "{name} is typing…",
  convo_emojiTitle: "Emoticons",
  convo_nudge: "Nudge",
  convo_nudgeTitle: "Nudge their window",
  convo_composerPlaceholder: "Type a message… (Enter to send, Shift+Enter for newline)",
  convo_send: "Send",
  convo_close: "Close",
  lang_label: "Language",
  theme_toggle: "Toggle dark mode",
};

export const catalog: Record<Locale, Messages> = { "zh-Hant": zhHant, en };
