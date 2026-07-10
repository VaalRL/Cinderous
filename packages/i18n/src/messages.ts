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
  msgStatus_sending: string;
  msgStatus_sent: string;
  msgStatus_delivered: string;
  msgStatus_read: string;
  settings_readReceipts: string;
  settings_readReceiptsHint: string;
  ai_stylePolite: string;
  ai_styleConcise: string;
  ai_styleGrammar: string;
  ai_styleFormal: string;
  ai_styleEnglish: string;
  ai_rewrite: string;
  ai_rewriteHint: string;
  ai_rewriting: string;
  ai_adopt: string;
  ai_cancel: string;
  ai_unavailable: string;
  ai_nonLocalWarn: string;
  settings_ollama: string;
  settings_ollamaEndpoint: string;
  settings_ollamaModel: string;
  settings_ollamaLocalOnly: string;
  insert_open: string;
  insert_codeBlock: string;
  insert_list: string;
  insert_titlePh: string;
  insert_bodyPh: string;
  insert_codePh: string;
  insert_itemPh: string;
  settings_accent: string;
  settings_accentCustom: string;
  settings_accentReset: string;
  settings_accentHint: string;
  settings_aiProvider: string;
  settings_aiProviderOllama: string;
  settings_aiProviderOpenai: string;
  settings_aiApiKey: string;
  settings_aiSaveKey: string;
  ai_localOnlyBlocks: string;
  ai_summarize: string;
  ai_summaryTitle: string;
  ai_summarizing: string;
  ai_summaryOpen: string;
  ai_summaryDisclaimer: string;
  ai_summaryEmpty: string;
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
  convo_showFull: string;
  convo_msgDetail: string;
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
  settings_relayChange: string;
  settings_relayChangeHint: string;
  settings_relayChangeConfirm: string;
  settings_relayChangeApply: string;
  settings_relayChangeCancel: string;
  settings_relayLocked: string;
  settings_relayDrain: string;
  settings_relayDrainDone: string;
  settings_relayDrainDoneConfirm: string;
  settings_security: string;
  settings_passwordOn: string;
  settings_passwordOffHint: string;
  settings_passwordEnable: string;
  settings_passwordChange: string;
  settings_passwordDisable: string;
  settings_passwordDisableApply: string;
  settings_passwordHidden: string;
  settings_passwordForgetWarn: string;
  settings_passwordOld: string;
  settings_passwordNew: string;
  settings_passwordRepeat: string;
  settings_passwordBackupConfirm: string;
  settings_passwordError: string;
  settings_passwordApply: string;
  unlock_title: string;
  unlock_hint: string;
  unlock_password: string;
  unlock_button: string;
  unlock_error: string;
  unlock_forgot: string;
  rescue_title: string;
  rescue_hint: string;
  rescue_secret: string;
  rescue_backupPw: string;
  rescue_newPw: string;
  rescue_newPw2: string;
  rescue_submit: string;
  rescue_busy: string;
  rescue_back: string;
  rescue_error: string;
  settings_backupCode: string;
  settings_backupCodeHint: string;
  settings_backupCodePw: string;
  settings_backupCodePw2: string;
  settings_backupCodeMake: string;
  settings_cloud: string;
  settings_cloudHint: string;
  settings_cloudOff: string;
  settings_cloudBasic: string;
  settings_cloudFull: string;
  settings_cloudOffConfirm: string;
  settings_cloudBackupNow: string;
  pair_title: string;
  pair_offerHint: string;
  pair_expiresIn: string;
  pair_clipboardWarn: string;
  pair_sasHint: string;
  pair_sasMatch: string;
  pair_sasMismatch: string;
  pair_sending: string;
  pair_done: string;
  pair_settingsButton: string;
  pair_settingsHint: string;
  pair_importButton: string;
  pair_importHint: string;
  pair_importCode: string;
  pair_importStart: string;
  pair_importBusy: string;
  pair_importSasHint: string;
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
  msgStatus_sending: "傳送中",
  msgStatus_sent: "已送出",
  msgStatus_delivered: "已送達",
  msgStatus_read: "已讀",
  settings_readReceipts: "已讀回條",
  settings_readReceiptsHint: "開啟後，你讀取訊息會通知對方；關閉則不送、也不顯示對方的已讀（互惠）。",
  ai_stylePolite: "更客氣",
  ai_styleConcise: "更精簡",
  ai_styleGrammar: "修正錯字",
  ai_styleFormal: "更正式",
  ai_styleEnglish: "翻成英文",
  ai_rewrite: "AI 改寫",
  ai_rewriteHint: "自訂改寫指示…（例：讓語氣更輕鬆）",
  ai_rewriting: "改寫中…",
  ai_adopt: "採用",
  ai_cancel: "取消",
  ai_unavailable: "未偵測到 Ollama（請確認已啟動）",
  ai_nonLocalWarn: "⚠️ 非本機端點：文字會離開此裝置",
  settings_ollama: "AI 改寫（本機 Ollama）",
  settings_ollamaEndpoint: "Ollama 端點",
  settings_ollamaModel: "模型名稱",
  settings_ollamaLocalOnly: "僅允許本機（localhost）——關閉才准非本機端點（文字會離開裝置）",
  insert_open: "插入格式",
  insert_codeBlock: "程式碼區塊",
  insert_list: "清單",
  insert_titlePh: "標題",
  insert_bodyPh: "內容",
  insert_codePh: "程式碼",
  insert_itemPh: "項目",
  settings_accent: "主題色",
  settings_accentCustom: "自訂色",
  settings_accentReset: "預設",
  settings_accentHint: "即時套用、只存在本機；深色主題會自動提亮以維持對比。連吉祥物身體也會跟著換色。",
  settings_aiProvider: "AI 服務",
  settings_aiProviderOllama: "本機 Ollama",
  settings_aiProviderOpenai: "OpenAI 相容（線上）",
  settings_aiApiKey: "API 金鑰",
  settings_aiSaveKey: "儲存",
  ai_localOnlyBlocks: "此端點非本機，但「僅本機」開啟中 → 會被擋；要用線上服務請關掉「僅本機」。",
  ai_summarize: "AI 摘要未讀",
  ai_summaryTitle: "未讀摘要",
  ai_summarizing: "摘要中…",
  ai_summaryOpen: "開啟對話",
  ai_summaryDisclaimer: "AI 產生，可能不準確；請以原訊息為準。",
  ai_summaryEmpty: "沒有未讀訊息可摘要。",
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
  convo_showFull: "展開全文",
  convo_msgDetail: "訊息詳情",
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
  settings_relayChange: "更換中繼站",
  settings_relayChangeHint: "更換後應用程式會重新載入；聯絡人會透過加密個人檔自動學到你的新路由。",
  settings_relayChangeConfirm: "確定把此身分的中繼站改為 {url}？",
  settings_relayChangeApply: "套用並重新載入",
  settings_relayChangeCancel: "取消",
  settings_relayLocked: "工作身分的中繼站由組織管理，無法在此更換。",
  settings_relayDrain: "舊站排水中：{url}——{date} 前仍會接收送到舊站的訊息。",
  settings_relayDrainDone: "提前完成排水",
  settings_relayDrainDoneConfirm: "提前完成排水？期限前仍送到舊站的訊息將不再接收。",
  settings_security: "安全（本地密碼）",
  settings_passwordOn: "本地密碼已啟用：私鑰與資料金鑰以密碼包裹保存，不輸入密碼無法解開。",
  settings_passwordOffHint: "共用電腦建議啟用：以密碼衍生金鑰（Argon2id）包裹私鑰與資料金鑰，別人拿到這台電腦也解不開。不防執行中的惡意軟體。",
  settings_passwordEnable: "啟用本地密碼",
  settings_passwordChange: "改密碼",
  settings_passwordDisable: "停用",
  settings_passwordDisableApply: "確認停用",
  settings_passwordHidden: "隱藏此身分（不在切換器顯示；以 🔒 輸入密碼喚回）",
  settings_passwordForgetWarn: "忘記密碼＝這台電腦上的資料永久無法解開，只能憑 nsec 備份重建身分。請先完成備份。",
  settings_passwordOld: "目前密碼",
  settings_passwordNew: "新密碼",
  settings_passwordRepeat: "再輸入一次新密碼",
  settings_passwordBackupConfirm: "我已完成上方「身分備份」的 nsec 備份",
  settings_passwordError: "密碼錯誤或操作失敗",
  settings_passwordApply: "套用",
  unlock_title: "歡迎回來，{name}",
  unlock_hint: "此身分已啟用本地密碼，輸入密碼解鎖。",
  unlock_password: "本地密碼",
  unlock_button: "解鎖",
  unlock_error: "密碼錯誤，請再試一次。",
  unlock_forgot: "忘記密碼？用私鑰或備份碼救援",
  rescue_title: "救援 {name} 的資料",
  rescue_hint: "輸入你的私鑰（nsec）或加密備份碼，設一組新密碼，即可救回這台裝置上的完整資料。忘記舊密碼沒關係——舊密碼無法找回，這裡是設一組全新的。",
  rescue_secret: "私鑰（nsec1…）或備份碼",
  rescue_backupPw: "備份密碼",
  rescue_newPw: "設定新密碼",
  rescue_newPw2: "再輸入一次新密碼",
  rescue_submit: "救援並解鎖",
  rescue_busy: "救援中…",
  rescue_back: "返回",
  rescue_error: "私鑰／備份碼不符，或此身分沒有救援資料。",
  settings_backupCode: "產生加密備份碼",
  settings_backupCodeHint: "備份碼＝密碼加密的私鑰＋你的中繼站網址，印出或存到自選位置。換機時「新增身分→貼上備份碼＋密碼」即可還原。忘記備份密碼＝這份備份失效。",
  settings_backupCodePw: "備份密碼",
  settings_backupCodePw2: "再輸入一次備份密碼",
  settings_backupCodeMake: "產生",
  settings_cloud: "雲端同步（加密快照）",
  settings_cloudHint: "把加密的狀態快照存在你的中繼站：換機時「備份碼＋密碼」即可秒級還原。中繼站只見密文；快照由你的身分金鑰保護（本地密碼只保護這台裝置）。30 天未上線自動過期。",
  settings_cloudOff: "關閉（不上雲）",
  settings_cloudBasic: "基本：聯絡人、群組、封鎖清單、設定",
  settings_cloudFull: "完整：基本＋近期訊息",
  settings_cloudOffConfirm: "關閉雲端同步？中繼站上此裝置的快照將立即刪除，新裝置將無法自動還原。",
  settings_cloudBackupNow: "立即備份",
  pair_title: "配對新裝置",
  pair_offerHint: "在新裝置的登入畫面選「從舊裝置匯入」，掃描或貼上這段配對碼。兩台裝置需同時開著。",
  pair_expiresIn: "{sec} 秒後失效",
  pair_clipboardWarn: "配對碼等同一次性鑰匙：用完請清除剪貼簿。即使被複製，沒有你在本機按下「相符」也拿不到資料。",
  pair_sasHint: "新裝置已連上。請確認新裝置螢幕顯示的數字與下方相同——不同就是有人冒充，請按「不符」。",
  pair_sasMatch: "相符，開始傳送",
  pair_sasMismatch: "不符，中止",
  pair_sending: "傳送中…（完整歷史可能需要一點時間）",
  pair_done: "✅ 已傳送完成。新裝置正在載入。",
  pair_settingsButton: "配對新裝置",
  pair_settingsHint: "把這個身分的完整資料（含全部歷史）直接傳到你的另一台裝置，全程 P2P、不經中繼站。",
  pair_importButton: "從舊裝置匯入",
  pair_importHint: "在舊裝置開啟「設定 → 配對新裝置」，把配對碼貼到這裡。兩台裝置需同時開著。",
  pair_importCode: "配對碼",
  pair_importStart: "連線",
  pair_importBusy: "連線中…",
  pair_importSasHint: "請確認舊裝置上顯示的數字與下方相同，並在舊裝置按「相符」。",
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
  msgStatus_sending: "Sending",
  msgStatus_sent: "Sent",
  msgStatus_delivered: "Delivered",
  msgStatus_read: "Read",
  settings_readReceipts: "Read receipts",
  settings_readReceiptsHint: "When on, others are told when you read their messages; off means you neither send yours nor see theirs (reciprocal).",
  ai_stylePolite: "More polite",
  ai_styleConcise: "More concise",
  ai_styleGrammar: "Fix grammar",
  ai_styleFormal: "More formal",
  ai_styleEnglish: "To English",
  ai_rewrite: "AI rewrite",
  ai_rewriteHint: "Custom rewrite instruction… (e.g. make the tone lighter)",
  ai_rewriting: "Rewriting…",
  ai_adopt: "Use it",
  ai_cancel: "Cancel",
  ai_unavailable: "Ollama not detected (make sure it's running)",
  ai_nonLocalWarn: "⚠️ Non-local endpoint: text will leave this device",
  settings_ollama: "AI rewrite (local Ollama)",
  settings_ollamaEndpoint: "Ollama endpoint",
  settings_ollamaModel: "Model name",
  settings_ollamaLocalOnly: "Local only (localhost) — turn off to allow a non-local endpoint (text leaves this device)",
  insert_open: "Insert formatting",
  insert_codeBlock: "Code block",
  insert_list: "List",
  insert_titlePh: "Title",
  insert_bodyPh: "Body",
  insert_codePh: "code",
  insert_itemPh: "item",
  settings_accent: "Theme color",
  settings_accentCustom: "Custom color",
  settings_accentReset: "Default",
  settings_accentHint: "Applies instantly, stored locally; auto-brightened in dark theme. The mascot's body recolors too.",
  settings_aiProvider: "AI provider",
  settings_aiProviderOllama: "Local Ollama",
  settings_aiProviderOpenai: "OpenAI-compatible (online)",
  settings_aiApiKey: "API key",
  settings_aiSaveKey: "Save",
  ai_localOnlyBlocks: "This endpoint is non-local but 'local only' is on → it will be blocked; turn off 'local only' to use an online provider.",
  ai_summarize: "Summarize unread",
  ai_summaryTitle: "Unread summary",
  ai_summarizing: "Summarizing…",
  ai_summaryOpen: "Open conversation",
  ai_summaryDisclaimer: "AI-generated, may be inaccurate; refer to the original messages.",
  ai_summaryEmpty: "No unread messages to summarize.",
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
  convo_showFull: "Show full message",
  convo_msgDetail: "Message",
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
  settings_relayChange: "Change relay",
  settings_relayChangeHint: "The app reloads after the change; contacts learn your new route automatically via the encrypted profile broadcast.",
  settings_relayChangeConfirm: "Change this identity's relay to {url}?",
  settings_relayChangeApply: "Apply & reload",
  settings_relayChangeCancel: "Cancel",
  settings_relayLocked: "Work identities use the relay managed by your organization; it can't be changed here.",
  settings_relayDrain: "Draining old relay {url} — messages sent there are still received until {date}.",
  settings_relayDrainDone: "Finish draining now",
  settings_relayDrainDoneConfirm: "Finish draining early? Messages still arriving at the old relay will no longer be received.",
  settings_security: "Security (local password)",
  settings_passwordOn: "Local password is on: your private key and data key are wrapped with your password — nothing opens without it.",
  settings_passwordOffHint: "Recommended on shared computers: a password-derived key (Argon2id) wraps your private key and data key, so others with access to this machine can't open them. Does not protect against running malware.",
  settings_passwordEnable: "Enable local password",
  settings_passwordChange: "Change password",
  settings_passwordDisable: "Disable",
  settings_passwordDisableApply: "Confirm disable",
  settings_passwordHidden: "Hide this identity (not shown in the switcher; recall with 🔒 and your password)",
  settings_passwordForgetWarn: "A forgotten password means data on this machine is permanently unreadable; only an nsec backup can rebuild the identity. Back up first.",
  settings_passwordOld: "Current password",
  settings_passwordNew: "New password",
  settings_passwordRepeat: "Repeat new password",
  settings_passwordBackupConfirm: "I have completed the nsec backup above (Identity backup)",
  settings_passwordError: "Wrong password or the operation failed",
  settings_passwordApply: "Apply",
  unlock_title: "Welcome back, {name}",
  unlock_hint: "This identity is protected by a local password. Enter it to unlock.",
  unlock_password: "Local password",
  unlock_button: "Unlock",
  unlock_error: "Wrong password — try again.",
  unlock_forgot: "Forgot password? Recover with your key or backup code",
  rescue_title: "Recover {name}'s data",
  rescue_hint: "Enter your private key (nsec) or encrypted backup code and set a new password to recover all data on this device. Forgetting the old password is fine — it can't be retrieved; you're setting a brand-new one.",
  rescue_secret: "Private key (nsec1…) or backup code",
  rescue_backupPw: "Backup password",
  rescue_newPw: "Set new password",
  rescue_newPw2: "Repeat new password",
  rescue_submit: "Recover & unlock",
  rescue_busy: "Recovering…",
  rescue_back: "Back",
  rescue_error: "Key/backup code doesn't match, or this identity has no rescue data.",
  settings_backupCode: "Create encrypted backup code",
  settings_backupCodeHint: "The backup code is your password-encrypted key plus your relay URL — print it or store it anywhere you choose. To restore on a new device: Add identity → paste the code + password. A forgotten backup password makes this backup unusable.",
  settings_backupCodePw: "Backup password",
  settings_backupCodePw2: "Repeat backup password",
  settings_backupCodeMake: "Create",
  settings_cloud: "Cloud sync (encrypted snapshot)",
  settings_cloudHint: "Stores an encrypted state snapshot on your relay: a new device restores in seconds with your backup code + password. The relay only ever sees ciphertext; the snapshot is protected by your identity key (the local password only protects this device). Expires after 30 days offline.",
  settings_cloudOff: "Off (nothing in the cloud)",
  settings_cloudBasic: "Basic: contacts, groups, block list, settings",
  settings_cloudFull: "Full: basic + recent messages",
  settings_cloudOffConfirm: "Turn off cloud sync? This device's snapshot on the relay is deleted immediately and new devices can no longer restore automatically.",
  settings_cloudBackupNow: "Back up now",
  pair_title: "Pair a new device",
  pair_offerHint: "On the new device's sign-in screen choose “Import from old device”, then scan or paste this pairing code. Both devices must be running.",
  pair_expiresIn: "expires in {sec}s",
  pair_clipboardWarn: "The pairing code is a one-time key — clear your clipboard afterwards. Even if it is copied, nothing is sent until you press “Match” on this device.",
  pair_sasHint: "The new device is connected. Check that the digits on its screen match the ones below — if they differ, someone is impersonating it: press “No match”.",
  pair_sasMatch: "Match — start transfer",
  pair_sasMismatch: "No match — abort",
  pair_sending: "Transferring… (full history may take a moment)",
  pair_done: "✅ Transfer complete. The new device is loading.",
  pair_settingsButton: "Pair a new device",
  pair_settingsHint: "Send this identity's full data (including all history) straight to your other device — peer-to-peer, never via a relay.",
  pair_importButton: "Import from old device",
  pair_importHint: "On the old device open “Settings → Pair a new device” and paste its pairing code here. Both devices must be running.",
  pair_importCode: "Pairing code",
  pair_importStart: "Connect",
  pair_importBusy: "Connecting…",
  pair_importSasHint: "Check that the digits shown on the old device match the ones below, then press “Match” there.",
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
