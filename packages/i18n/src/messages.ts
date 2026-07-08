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
  contact_copy: string;
  contact_copied: string;
  contact_addSelf: string;
  contact_addInvalid: string;
  contact_remove: string;
  contact_block: string;
  contact_unblock: string;
  contact_removeConfirm: string;
  contact_blockConfirm: string;
  group_blocked: string;
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
  convo_react: string;
  convo_unsend: string;
  convo_unsent: string;
  convo_loadEarlier: string;
  convo_timerTitle: string;
  convo_timerOff: string;
  convo_timer1m: string;
  convo_timer1h: string;
  convo_timer1d: string;
  convo_expired: string;
  lang_label: string;
  theme_toggle: string;
  nowPlaying_placeholder: string;
  settings_open: string;
  settings_title: string;
  settings_relayUrl: string;
  settings_relayDemo: string;
  settings_identityBackup: string;
  settings_identityWarning: string;
  settings_revealKey: string;
  settings_hideKey: string;
  settings_copyKey: string;
  settings_copied: string;
  settings_notifications: string;
  settings_notificationsHint: string;
  settings_close: string;
  unread_title: string;
  conn_connecting: string;
  conn_offline: string;
  conn_state_online: string;
  conn_state_connecting: string;
  conn_state_offline: string;
  settings_relayHome: string;
  settings_relayStale: string;
  settings_relayKeep: string;
  settings_relayKeepTitle: string;
  settings_relayClear: string;
  settings_relayClearConfirm: string;
  file_attach: string;
  file_download: string;
  file_sending: string;
  file_dropHint: string;
  file_error: string;
  sticker_title: string;
  sticker_alt: string;
  sticker_recent: string;
  sticker_favorites: string;
  sticker_favToggle: string;
  sticker_empty: string;
  sticker_custom: string;
  sticker_import: string;
  sticker_delete: string;
  sticker_deleteConfirm: string;
  sticker_fork: string;
  sticker_own: string;
  sticker_owned: string;
  sticker_invalid: string;
  sticker_importFail: string;
  editor_title: string;
  editor_new: string;
  editor_fromBase: string;
  editor_label: string;
  editor_color: string;
  editor_width: string;
  editor_undo: string;
  editor_redo: string;
  editor_clear: string;
  editor_save: string;
  editor_cancel: string;
  trigger_set: string;
  trigger_prompt: string;
  trigger_conflict: string;
  trigger_skipped: string;
  trigger_hint: string;
  mention_hint: string;
  mention_you: string;
  thread_title: string;
  thread_empty: string;
  thread_reply: string;
  thread_open: string;
  thread_replies: string;
  members_title: string;
  members_you: string;
  members_remove: string;
  members_add: string;
  trigger_manage: string;
  trigger_empty: string;
  trigger_rename: string;
  trigger_renamePrompt: string;
  trigger_delete: string;
  trigger_deleted: string;
  urlrisk_confirm: string;
  urlrisk_textMismatch: string;
  urlrisk_userinfo: string;
  urlrisk_punycode: string;
  urlrisk_ipHost: string;
  urlrisk_oddPort: string;
  urlrisk_http: string;
  urlrisk_shortener: string;
  urlrisk_unparsable: string;
  settings_privacy: string;
  settings_cleanOnPaste: string;
  voice_record: string;
  voice_stop: string;
  voice_recording: string;
  voice_alt: string;
  album_open: string;
  album_title: string;
  album_empty: string;
  image_alt: string;
  qr_show: string;
  qr_title: string;
  qr_hint: string;
  qr_alt: string;
  call_audio: string;
  call_video: string;
  call_incoming: string;
  call_outgoing: string;
  call_connecting: string;
  call_active: string;
  call_accept: string;
  call_reject: string;
  call_hangup: string;
  call_mute: string;
  call_unmute: string;
  group_create: string;
  group_name: string;
  group_members: string;
  group_confirm: string;
  group_section: string;
  group_membersCount: string;
  group_leave: string;
  group_labelAdd: string;
  group_labelPlaceholder: string;
  group_labelRemove: string;
  group_pin: string;
  group_unpin: string;
  group_filterAll: string;
}

const zhHant: Messages = {
  appName: "Cinder",
  signIn_title: "登入 Cinder",
  signIn_hint: "去中心化、端到端加密的即時通。輸入顯示名稱即可開始（你的身分是本機生成的 secp256k1 金鑰）。",
  signIn_hint2: "本示範會在記憶體中模擬中繼站與幾位好友，方便你體驗。",
  signIn_displayName: "顯示名稱",
  signIn_relayUrl: "中繼站網址（留空使用示範模式）",
  signIn_button: "登入",
  contact_myId: "我的 ID",
  contact_addPlaceholder: "貼上好友的 npub…（可附 @wss://中繼）",
  contact_add: "加好友",
  contact_copy: "複製",
  contact_copied: "已複製",
  contact_addSelf: "不能把自己的身分加為好友（會把你的分身連結給中繼站）",
  contact_addInvalid: "無效的 npub",
  contact_remove: "刪除",
  contact_block: "封鎖",
  contact_unblock: "解除封鎖",
  contact_removeConfirm: "確定要刪除 {name} 並清除對話紀錄嗎？",
  contact_blockConfirm: "確定要封鎖 {name}？將移出清單並忽略其後續訊息。",
  group_blocked: "已封鎖 ({count})",
  status_online: "線上",
  status_away: "離開",
  status_busy: "忙碌",
  status_offline: "顯示為離線（隱身）",
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
  convo_react: "回應",
  convo_unsend: "收回",
  convo_unsent: "訊息已收回",
  convo_loadEarlier: "載入較早的 {count} 則訊息",
  convo_timerTitle: "限時訊息（閱後即焚）",
  convo_timerOff: "限時：關",
  convo_timer1m: "限時：1 分鐘",
  convo_timer1h: "限時：1 小時",
  convo_timer1d: "限時：1 天",
  convo_expired: "訊息已到期",
  lang_label: "語言",
  theme_toggle: "深色 / 淺色模式",
  nowPlaying_placeholder: "正在聽…（分享音樂狀態）",
  settings_open: "設定",
  settings_title: "設定",
  settings_relayUrl: "中繼站",
  settings_relayDemo: "示範模式（記憶體中繼）",
  settings_identityBackup: "身分備份",
  settings_identityWarning: "這是你的私鑰（nsec），等同你的帳號本身。任何人拿到都能冒充你——切勿外流或貼給他人。請離線妥善保存。",
  settings_revealKey: "顯示私鑰（nsec）",
  settings_hideKey: "隱藏私鑰",
  settings_copyKey: "複製",
  settings_copied: "已複製",
  settings_notifications: "桌面通知",
  settings_notificationsHint: "視窗未聚焦時，有新訊息就通知。",
  settings_close: "關閉",
  unread_title: "{count} 則未讀",
  conn_connecting: "連線中…",
  conn_offline: "已斷線，重連中…",
  conn_state_online: "已連線",
  conn_state_connecting: "連線中",
  conn_state_offline: "離線",
  settings_relayHome: "（我的中繼）",
  settings_relayStale: "長期離線，hint 可能過期",
  settings_relayKeep: "保留",
  settings_relayKeepTitle: "確認保留此中繼，暫時隱藏警告",
  settings_relayClear: "清除 hint",
  settings_relayClearConfirm: "清除 {url} 的 relay hint？使用它的聯絡人將改回你的中繼路由。",
  file_attach: "傳送檔案（P2P）",
  file_download: "下載",
  file_sending: "傳送中…",
  file_dropHint: "放開以傳送檔案",
  file_error: "檔案傳輸失敗",
  sticker_title: "貼圖",
  sticker_alt: "貼圖",
  sticker_recent: "最近使用",
  sticker_favorites: "我的最愛",
  sticker_favToggle: "切換最愛",
  sticker_empty: "這裡還沒有貼圖",
  sticker_custom: "自製貼圖",
  sticker_import: "匯入圖片或 SVG",
  sticker_delete: "刪除貼圖",
  sticker_deleteConfirm: "刪除自製貼圖「{name}」？",
  sticker_fork: "複製為自製貼圖",
  sticker_own: "點擊收藏此貼圖",
  sticker_owned: "已收藏",
  sticker_invalid: "（無效貼圖）",
  sticker_importFail: "無法加入貼圖：{reason}",
  editor_title: "貼圖編輯器",
  editor_new: "繪製新貼圖",
  editor_fromBase: "以此貼圖為底繪製",
  editor_label: "貼圖名稱",
  editor_color: "顏色",
  editor_width: "筆刷粗細",
  editor_undo: "復原",
  editor_redo: "重做",
  editor_clear: "清空",
  editor_save: "儲存到自製貼圖",
  editor_cancel: "取消",
  trigger_set: "設定觸發文字",
  trigger_prompt: "「{name}」的觸發文字（可多個，以空白分隔；清空移除）：",
  trigger_conflict: "「{trigger}」已對應其他貼圖，改為對應此貼圖？",
  trigger_skipped: "已略過無效觸發文字：{list}",
  trigger_hint: "Tab 送出・↑↓ 選擇・Esc 關閉",
  mention_hint: "Tab/Enter 選取・↑↓ 選擇・Esc 關閉",
  mention_you: "提及了你",
  thread_title: "討論串",
  thread_empty: "尚無回覆，開始討論吧",
  thread_reply: "回覆討論串…",
  thread_open: "在討論串回覆",
  thread_replies: "{count} 則回覆",
  members_title: "群組成員",
  members_you: "你",
  members_remove: "移除成員",
  members_add: "新增成員",
  trigger_manage: "觸發文字總覽",
  trigger_empty: "還沒有觸發文字——在貼圖上按 ⌨ 設定",
  trigger_rename: "改名",
  trigger_renamePrompt: "新的觸發文字：",
  trigger_delete: "刪除觸發文字",
  trigger_deleted: "貼圖已刪除",
  urlrisk_confirm: "此連結有風險，仍要開啟嗎？\n{url}",
  urlrisk_textMismatch: "顯示文字偽裝成另一個網址",
  urlrisk_userinfo: "網址帶有 @ 混淆（實際網域在 @ 之後）",
  urlrisk_punycode: "國際化網域（可能為同形字仿冒）",
  urlrisk_ipHost: "直接連往 IP 位址",
  urlrisk_oddPort: "非常規連接埠",
  urlrisk_http: "未加密（http）",
  urlrisk_shortener: "短網址，無法預覽真正目的地",
  urlrisk_unparsable: "網址格式異常",
  settings_privacy: "隱私",
  settings_cleanOnPaste: "貼上時自動清除網址追蹤參數（含 redirect 拆殼）",
  voice_record: "錄語音訊息",
  voice_stop: "停止並傳送",
  voice_recording: "錄音中…點擊停止並傳送",
  voice_alt: "語音訊息",
  album_open: "相簿",
  album_title: "相簿（{count}）",
  album_empty: "尚無圖片",
  image_alt: "圖片",
  qr_show: "顯示 QR",
  qr_title: "我的 QR",
  qr_hint: "請好友掃描以加你為好友",
  qr_alt: "我的 npub QR 碼",
  call_audio: "語音通話",
  call_video: "視訊通話",
  call_incoming: "來電中…",
  call_outgoing: "撥號中…",
  call_connecting: "連線中…",
  call_active: "通話中",
  call_accept: "接聽",
  call_reject: "拒接",
  call_hangup: "掛斷",
  call_mute: "靜音",
  call_unmute: "取消靜音",
  group_create: "建立群組",
  group_name: "群組名稱",
  group_members: "選擇成員",
  group_confirm: "建立",
  group_section: "群組",
  group_membersCount: "{count} 位成員",
  group_leave: "離開群組",
  group_labelAdd: "＋ 標籤",
  group_labelPlaceholder: "標籤名稱",
  group_labelRemove: "移除標籤 {label}",
  group_pin: "置頂",
  group_unpin: "取消置頂",
  group_filterAll: "全部",
};

const en: Messages = {
  appName: "Cinder",
  signIn_title: "Sign in to Cinder",
  signIn_hint: "A decentralized, end-to-end encrypted messenger. Just enter a display name to start (your identity is a secp256k1 key generated on this device).",
  signIn_hint2: "This demo simulates a relay and a few buddies in memory so you can try it out.",
  signIn_displayName: "Display name",
  signIn_relayUrl: "Relay URL (leave blank for demo mode)",
  signIn_button: "Sign in",
  contact_myId: "My ID",
  contact_addPlaceholder: "Paste a buddy's npub… (optionally @wss://relay)",
  contact_add: "Add",
  contact_copy: "Copy",
  contact_copied: "Copied",
  contact_addSelf: "Can't add your own identity (it would link your personas to the relay)",
  contact_addInvalid: "Invalid npub",
  contact_remove: "Delete",
  contact_block: "Block",
  contact_unblock: "Unblock",
  contact_removeConfirm: "Delete {name} and clear the conversation history?",
  contact_blockConfirm: "Block {name}? They'll be removed and their future messages ignored.",
  group_blocked: "Blocked ({count})",
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
  convo_react: "React",
  convo_unsend: "Unsend",
  convo_unsent: "Message unsent",
  convo_loadEarlier: "Load {count} earlier messages",
  convo_timerTitle: "Disappearing message",
  convo_timerOff: "Timer: off",
  convo_timer1m: "Timer: 1 min",
  convo_timer1h: "Timer: 1 hour",
  convo_timer1d: "Timer: 1 day",
  convo_expired: "Message expired",
  lang_label: "Language",
  theme_toggle: "Toggle dark mode",
  nowPlaying_placeholder: "Now playing… (share your music)",
  settings_open: "Settings",
  settings_title: "Settings",
  settings_relayUrl: "Relay",
  settings_relayDemo: "Demo mode (in-memory relay)",
  settings_identityBackup: "Identity backup",
  settings_identityWarning: "This is your secret key (nsec) — it IS your account. Anyone who gets it can impersonate you. Never share or paste it anywhere; keep it safe offline.",
  settings_revealKey: "Reveal secret key (nsec)",
  settings_hideKey: "Hide secret key",
  settings_copyKey: "Copy",
  settings_copied: "Copied",
  settings_notifications: "Desktop notifications",
  settings_notificationsHint: "Notify on new messages when the window isn't focused.",
  settings_close: "Close",
  unread_title: "{count} unread",
  conn_connecting: "Connecting…",
  conn_offline: "Disconnected — reconnecting…",
  conn_state_online: "Connected",
  conn_state_connecting: "Connecting",
  conn_state_offline: "Offline",
  settings_relayHome: " (my relay)",
  settings_relayStale: "offline for a while — hint may be stale",
  settings_relayKeep: "Keep",
  settings_relayKeepTitle: "Keep this relay and dismiss the warning for now",
  settings_relayClear: "Clear hint",
  settings_relayClearConfirm: "Clear the relay hint for {url}? Contacts using it will fall back to your relay.",
  file_attach: "Send a file (P2P)",
  file_download: "Download",
  file_sending: "Sending…",
  file_dropHint: "Drop to send",
  file_error: "File transfer failed",
  sticker_title: "Stickers",
  sticker_alt: "sticker",
  sticker_recent: "Recent",
  sticker_favorites: "Favorites",
  sticker_favToggle: "Toggle favorite",
  sticker_empty: "Nothing here yet",
  sticker_custom: "My stickers",
  sticker_import: "Import image or SVG",
  sticker_delete: "Delete sticker",
  sticker_deleteConfirm: "Delete custom sticker \"{name}\"?",
  sticker_fork: "Copy to my stickers",
  sticker_own: "Click to save this sticker",
  sticker_owned: "Saved",
  sticker_invalid: "(invalid sticker)",
  sticker_importFail: "Could not add sticker: {reason}",
  editor_title: "Sticker editor",
  editor_new: "Draw a new sticker",
  editor_fromBase: "Draw on this sticker",
  editor_label: "Sticker name",
  editor_color: "Color",
  editor_width: "Brush size",
  editor_undo: "Undo",
  editor_redo: "Redo",
  editor_clear: "Clear",
  editor_save: "Save to my stickers",
  editor_cancel: "Cancel",
  trigger_set: "Set trigger text",
  trigger_prompt: "Trigger text for \"{name}\" (multiple allowed, space-separated; empty to remove):",
  trigger_conflict: "\"{trigger}\" is mapped to another sticker. Remap it to this one?",
  trigger_skipped: "Skipped invalid triggers: {list}",
  trigger_hint: "Tab to send · ↑↓ select · Esc dismiss",
  mention_hint: "Tab/Enter to pick · ↑↓ select · Esc dismiss",
  mention_you: "mentioned you",
  thread_title: "Thread",
  thread_empty: "No replies yet — start the discussion",
  thread_reply: "Reply in thread…",
  thread_open: "Reply in thread",
  thread_replies: "{count} replies",
  members_title: "Group members",
  members_you: "you",
  members_remove: "Remove member",
  members_add: "Add member",
  trigger_manage: "Trigger overview",
  trigger_empty: "No triggers yet — press ⌨ on a sticker to add one",
  trigger_rename: "Rename",
  trigger_renamePrompt: "New trigger text:",
  trigger_delete: "Delete trigger",
  trigger_deleted: "sticker deleted",
  urlrisk_confirm: "This link looks risky. Open anyway?\n{url}",
  urlrisk_textMismatch: "Link text impersonates a different address",
  urlrisk_userinfo: "URL contains @ trick (real domain comes after @)",
  urlrisk_punycode: "Internationalized domain (possible lookalike)",
  urlrisk_ipHost: "Points directly to an IP address",
  urlrisk_oddPort: "Unusual port",
  urlrisk_http: "Unencrypted (http)",
  urlrisk_shortener: "URL shortener — destination hidden",
  urlrisk_unparsable: "Malformed URL",
  settings_privacy: "Privacy",
  settings_cleanOnPaste: "Strip tracking parameters from pasted links (incl. redirect unwrapping)",
  voice_record: "Record voice message",
  voice_stop: "Stop & send",
  voice_recording: "Recording… click to stop & send",
  voice_alt: "Voice message",
  album_open: "Album",
  album_title: "Album ({count})",
  album_empty: "No images yet",
  image_alt: "Image",
  qr_show: "Show QR",
  qr_title: "My QR",
  qr_hint: "Have a friend scan this to add you",
  qr_alt: "My npub QR code",
  call_audio: "Voice call",
  call_video: "Video call",
  call_incoming: "Incoming call…",
  call_outgoing: "Calling…",
  call_connecting: "Connecting…",
  call_active: "In call",
  call_accept: "Accept",
  call_reject: "Decline",
  call_hangup: "Hang up",
  call_mute: "Mute",
  call_unmute: "Unmute",
  group_create: "New group",
  group_name: "Group name",
  group_members: "Select members",
  group_confirm: "Create",
  group_section: "Groups",
  group_membersCount: "{count} members",
  group_leave: "Leave group",
  group_labelAdd: "＋ Label",
  group_labelPlaceholder: "Label name",
  group_labelRemove: "Remove label {label}",
  group_pin: "Pin",
  group_unpin: "Unpin",
  group_filterAll: "All",
};

export const catalog: Record<Locale, Messages> = { "zh-Hant": zhHant, en };
