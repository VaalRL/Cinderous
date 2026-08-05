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
  /** 品牌字樣的 tooltip（ADR-0250）：點擊外連官網。 */
  brand_visitSite: string;
  signIn_title: string;
  signIn_hint: string;
  /** 瀏覽器本地密碼（ADR-0122）：必填——沒有它，重新整理一次身分就沒了。 */
  signIn_password: string;
  signIn_passwordAgain: string;
  signIn_passwordWhy: string;
  signIn_passwordRequired: string;
  signIn_passwordMismatch: string;
  /** 用既有 nsec 登入（ADR-0122）。 */
  signIn_useNsec: string;
  signIn_useNsecHint: string;
  signIn_useNsecButton: string;
  signIn_nsec: string;
  signIn_nsecInvalid: string;
  signIn_relayUsing: string;
  signIn_relayDemo: string;
  signIn_relayProbing: string;
  signIn_relayChange: string;
  signIn_relayHide: string;
  signIn_displayName: string;
  signIn_relayUrl: string;
  signIn_button: string;
  /** ADR-0146：登入名稱命中本機既有身分。 */
  signIn_enterExisting: string;
  signIn_enterExistingHint: string;
  signIn_createHint: string;
  signIn_createButton: string;
  signIn_ambiguousName: string;
  // ── 行動端登入（ADR-0081）：nsec 匯入（A）＋配對匯入（B）──
  mobileSignIn_title: string;
  /** 由「用私鑰登入」返回建立新身分（ADR-0277）。 */
  mobileSignIn_backToCreate: string;
  mobileSignIn_nameLabel: string;
  mobileSignIn_nsecLabel: string;
  mobileSignIn_nsecPlaceholder: string;
  mobileSignIn_derived: string;
  mobileSignIn_button: string;
  mobileSignIn_errName: string;
  mobileSignIn_errNsec: string;
  /** ADR-0146：本機已有同名身分（名稱唯一）。 */
  mobileSignIn_nameTaken: string;
  mobileSignIn_hint: string;
  mobileSignIn_toPair: string;
  mobilePair_title: string;
  mobilePair_codeLabel: string;
  mobilePair_codePlaceholder: string;
  mobilePair_connect: string;
  mobilePair_relayVia: string;
  mobilePair_sasHint: string;
  mobilePair_waiting: string;
  mobilePair_errCode: string;
  mobilePair_errRejected: string;
  mobilePair_errNoIdentity: string;
  mobilePair_toNsec: string;
  // ── 行動端 app 殼：聊天清單＋對話（ADR-0085）──
  mobileChats_title: string;
  mobileChats_empty: string;
  /** 聊天清單搜尋（ADR-0256 階段 4）。 */
  mobileChats_search: string;
  mobileChats_you: string;
  mobileConvo_input: string;
  mobileConvo_send: string;
  mobileConvo_back: string;
  mobileChats_add: string;
  mobileChats_addPlaceholder: string;
  mobileChats_addBtn: string;
  mobileChats_myNpub: string;
  // ── 底部分頁＋設定（ADR-0087）──
  mobileTab_chats: string;
  mobileTab_contacts: string;
  mobileTab_settings: string;
  mobileSettings_appearance: string;
  mobileSettings_theme: string;
  mobileSettings_light: string;
  mobileSettings_dark: string;
  mobileSettings_accent: string;
  mobileSettings_language: string;
  mobileSettings_relay: string;
  mobileSettings_relayDemo: string;
  mobileSettings_logout: string;
  mobileContacts_empty: string;
  // ── 新增身分小視窗（ADR-0045；D 補 i18n）──
  addId_title: string;
  addId_close: string;
  addId_relay: string;
  addId_enterprise: string;
  addId_admin: string;
  addId_import: string;
  addId_error: string;
  /** ADR-0146：本機已有同名身分（名稱唯一）。 */
  addId_nameTaken: string;
  addId_submit: string;
  addId_busy: string;
  /** 新增身分先選類型（ADR-0145）。 */
  addId_modePersonal: string;
  addId_modePersonalHint: string;
  addId_modeOrg: string;
  addId_modeOrgHint: string;
  addId_modeOwner: string;
  addId_modeOwnerHint: string;
  addId_changeMode: string;
  addId_invite: string;
  addId_inviteApplied: string;
  roster_inviteHint: string;
  roster_inviteCopy: string;
  roster_escrow: string;
  signIn_joinEscrow: string;
  settings_offboard: string;
  settings_offboardHint: string;
  offboard_takeover: string;
  offboard_delete: string;
  offboard_takeoverConfirm: string;
  offboard_deleteConfirm: string;
  roster_welcomeLabel: string;
  roster_workHoursLabel: string;
  roster_ttlLabel: string;
  roster_relayFilesLabel: string;
  roster_inviteLabel: string;
  roster_orgName: string;
  roster_membersLabel: string;
  roster_membersHint: string;
  roster_parseError: string;
  roster_needMember: string;
  roster_publishFailed: string;
  roster_published: string;
  roster_publish: string;
  settings_orgRoster: string;
  settings_createCompany: string;
  settings_vaultDesktopOnly: string;
  orgInfo_title: string;
  orgInfo_hours: string;
  orgInfo_muteNote: string;
  orgPolicy_title: string;
  orgPolicy_disabledHead: string;
  orgPolicy_rulesHead: string;
  orgPolicy_files: string;
  orgPolicy_calls: string;
  orgPolicy_stickers: string;
  orgPolicy_cloudBackup: string;
  orgPolicy_forceTurn: string;
  orgPolicy_ttlDays: string;
  orgPolicy_relayFilesMb: string;
  orgPolicy_hint: string;
  settings_orgTitle: string;
  settings_orgTitleHint: string;
  settings_orgTitleUpdated: string;
  convo_offHours: string;
  slot_deposit: string;
  settings_slot: string;
  slot_empty: string;
  slot_retry: string;
  slot_remove: string;
  slot_pending: string;
  slot_sending: string;
  slot_done: string;
  slot_failed: string;
  settings_slotDir: string;
  settings_slotDirHint: string;
  settings_slotDirPick: string;
  settings_slotDirDefault: string;
  signIn_joinHint: string;
  signIn_joinName: string;
  signIn_joinButton: string;
  idbar_addIdentity: string;
  idbar_unlockHidden: string;
  idbar_roster: string;
  idbar_switch: string;
  contact_myId: string;
  contact_addPlaceholder: string;
  contact_add: string;
  contact_copy: string;
  contact_copied: string;
  contact_addSelf: string;
  contact_addInvalid: string;
  contact_remove: string;
  contact_block: string;
  /** 訊息請求（ADR-0121）。 */
  request_section: string;
  request_hint: string;
  request_accept: string;
  request_decline: string;
  request_preview: string;
  request_clearAll: string;
  contact_unblock: string;
  contact_removeConfirm: string;
  contact_blockConfirm: string;
  group_blocked: string;
  status_online: string;
  status_away: string;
  status_busy: string;
  status_offline: string;
  msgStatus_sending: string;
  /** 傳送失敗（外送匣重試耗盡/被拒收，ADR-0095）。 */
  msgStatus_failed: string;
  msgStatus_sent: string;
  msgStatus_delivered: string;
  msgStatus_read: string;
  /** 群組名單制已讀（≤5 人，ADR-0095）：`{names}`。 */
  readBy_list: string;
  /** 群組計數制已讀（6–10 人，ADR-0095）：`{count}`/`{total}`。 */
  readBy_count: string;
  // 算式預覽與右欄計算機（ADR-0097）
  calc_insertExpr: string;
  calc_insertResult: string;
  calc_insertHint: string;
  // 行動端雲端備份與檔案（ADR-0100）
  convo_attach: string;
  /** 拍照直接傳（ADR-0274）。 */
  convo_photo: string;
  /** 背景保活前台服務（ADR-0272/0274，Android）。 */
  fg_title: string;
  fg_text: string;
  settings_foreground: string;
  /** 中繼健檢徽章（ADR-0275）。 */
  relayCheck_ok: string;
  relayCheck_warn: string;
  relayCheck_down: string;
  relayCheck_noAuth: string;
  relayCheck_ephemeral: string;
  relayCheck_expired: string;
  settings_foregroundHint: string;
  // 相簿/原圖（ADR-0102）
  image_originalMissing: string;
  image_relocate: string;
  image_thumbOnly: string;
  /** 圖片分享（ADR-0132）。 */
  share_copyImage: string;
  share_copyPath: string;
  share_copied: string;
  share_share: string;
  share_failed: string;
  settings_readReceipts: string;
  settings_readReceiptsHint: string;
  // 保留上限與導出（ADR-0094）
  settings_retention: string;
  settings_retentionHint: string;
  retention_unlimited: string;
  retention_custom: string;
  settings_storageFull: string;
  settings_export: string;
  settings_exportHint: string;
  export_title: string;
  export_warning: string;
  export_scope: string;
  export_selectAll: string;
  export_format: string;
  export_run: string;
  export_this: string;
  /** 歷史紀錄（ADR-0111）：讀封存的舊訊息。 */
  history_title: string;
  /** 封存搜尋（ADR-0256 階段 3）。 */
  history_search: string;
  history_scanning: string;
  history_searchClear: string;
  history_open: string;
  history_older: string;
  history_loading: string;
  history_empty: string;
  /** 訊息操作（NIP-09 收回 / NIP-25 回應）。 */
  msg_unsent: string;
  msg_unsend: string;
  /** 封鎖。 */
  block: string;
  unblock: string;
  blocked_title: string;
  /** 建立群組（行動端，ADR-0114）；group_name/members/create 沿用桌面既有鍵。 */
  group_new: string;
  group_namePlaceholder: string;
  export_empty: string;
  settings_invisible: string;
  settings_invisibleHint: string;
  /** 前向保密（ADR-0245）。 */
  fs_title: string;
  pair_largeBundleWarn: string;
  group_tooManyMembers: string;
  fs_unaudited: string;
  fs_enableConfirm: string;
  fs_hint: string;
  fs_enable: string;
  fs_enabled: string;
  fs_rotate: string;
  fs_rotateConfirm: string;
  fs_disable: string;
  fs_disableConfirm: string;
  fs_autoRotate: string;
  fs_undecryptable: string;
  settings_groupInvite: string;
  settings_groupInviteHint: string;
  groupInvite_held: string;
  groupFs_summary: string;
  groupFs_known: string;
  groupFs_unknown: string;
  groupFs_lost: string;
  devices_title: string;
  devices_thisOne: string;
  devices_firstSeen: string;
  devices_limit: string;
  devices_new: string;
  devices_source_local: string;
  devices_source_snapshot: string;
  devices_source_pairing: string;
  devices_notInDirectory: string;
  devices_stale: string;
  devices_forget: string;
  devices_forgetConfirm: string;
  devices_conflict: string;
  devices_revUnknown: string;
  devices_revDualTrack: string;
  devices_revActive: string;
  devices_remove: string;
  devices_removeConfirm: string;
  devices_revoked: string;
  devices_conflictLog: string;
  devices_conflictRow: string;
  devices_myCode: string;
  devices_myCodeHint: string;
  devices_authorize: string;
  devices_authorizeHint: string;
  devices_authorizePlaceholder: string;
  devices_authorizeConfirm: string;
  devices_noAuthority: string;
  devices_tierTitle: string;
  devices_tierPlaintext: string;
  devices_tierEncrypted: string;
  devices_tierKeystore: string;
  devices_tierEphemeral: string;
  devices_tierWasPlain: string;
  fs_downgradeWarning: string;
  fs_unsupportedWarning: string;
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
  sidebar_search: string;
  sidebar_empty: string;
  sidebar_labelAdd: string;
  deck_pickChat: string;
  aux_pickChat: string;
  aux_tabInfo: string;
  aux_tabMembers: string;
  aux_tabMedia: string;
  aux_tabThreads: string;
  aux_tabNote: string;
  aux_title: string;
  note_placeholder: string;
  note_hint: string;
  note_placeholderM: string;
  note_hintM: string;
  aux_noMedia: string;
  aux_noThreads: string;
  aux_you: string;
  aux_admin: string;
  aux_replies: string;
  settings_layout: string;
  settings_layoutClassic: string;
  settings_layoutModern: string;
  settings_layoutHint: string;
  deck_auxPlaceholder: string;
  settings_accent: string;
  settings_accentPrimary: string;
  settings_accent2: string;
  settings_accent2Follow: string;
  settings_accentCustom: string;
  settings_accentReset: string;
  /** 無障礙設定（ADR-0253）：高對比＋UI 尺寸＋色覺友善色票。 */
  settings_accentCb: string;
  settings_a11y: string;
  a11y_contrast: string;
  a11y_contrastHint: string;
  a11y_stateOn: string;
  a11y_stateOff: string;
  a11y_uiScale: string;
  a11y_uiScaleHint: string;
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
  convo_p2pDirect: string;
  convo_p2pNone: string;
  convo_p2pDirectHint: string;
  convo_p2pNoneHint: string;
  convo_typing: string;
  /** 本地暱稱（ADR-0148）：私下給聯絡人取的顯示名，點標頭可切換對方廣播名。 */
  alias_set: string;
  alias_edit: string;
  alias_prompt: string;
  alias_placeholder: string;
  alias_showBroadcast: string;
  alias_showAlias: string;
  convo_emojiTitle: string;
  convo_nudge: string;
  convo_nudgeTitle: string;
  convo_composerPlaceholder: string;
  convo_send: string;
  convo_close: string;
  convo_resize: string;
  avatar_change: string;
  avatar_remove: string;
  avatar_fromUrl: string;
  avatar_urlPrompt: string;
  avatar_urlError: string;
  avatar_syncHint: string;
  personalize_quota: string;
  chatbg_title: string;
  chatbg_upload: string;
  chatbg_clear: string;
  convo_react: string;
  convo_unsend: string;
  convo_showFull: string;
  convo_msgDetail: string;
  convo_unsent: string;
  convo_loadEarlier: string;
  /** 對話內搜尋與經典佈局搜尋（ADR-0256）。 */
  convo_search: string;
  convo_searchHint: string;
  convo_searchNone: string;
  convo_searchPrev: string;
  convo_searchNext: string;
  roster_search: string;
  convo_timerTitle: string;
  convo_timerOff: string;
  convo_timer1m: string;
  convo_timer1h: string;
  convo_timer1d: string;
  convo_expired: string;
  lang_label: string;
  theme_toggle: string;
  nowPlaying_placeholder: string;
  /** ♪ 自動偵測切換（ADR-0252，僅桌面 Tauri）。 */
  npAuto_toggle: string;
  npAuto_detecting: string;
  settings_open: string;
  settings_title: string;
  settings_relayUrl: string;
  settings_relayDemo: string;
  settings_identityBackup: string;
  /** 更改顯示名稱（ADR-0144）。 */
  settings_displayName: string;
  settings_nameApply: string;
  settings_nameUpdated: string;
  /** ADR-0146：改名撞到本機另一身分（名稱唯一）。 */
  settings_nameTaken: string;
  settings_identityWarning: string;
  settings_revealKey: string;
  settings_hideKey: string;
  settings_copyKey: string;
  settings_copied: string;
  settings_notifications: string;
  settings_notificationsHint: string;
  settings_notifySound: string;
  settings_notifyChime: string;
  sound_perContact: string;
  sound_useDefault: string;
  sound_preview: string;
  chime_classic: string;
  chime_descend: string;
  chime_triple: string;
  chime_bell: string;
  chime_drop: string;
  chime_knock: string;
  titlebar_minimize: string;
  titlebar_maximize: string;
  titlebar_close: string;
  settings_titlebar: string;
  titlebar_dragHint: string;
  titlebar_autoHide: string;
  titlebarStyle_flat: string;
  titlebarStyle_rounded: string;
  titlebarStyle_mac: string;
  titlebarStyle_compact: string;
  settings_notifyHidePreview: string;
  notify_newMessage: string;
  notify_nudge: string;
  notify_call: string;
  settings_notifyEvents: string;
  notify_event_dm: string;
  notify_event_group: string;
  notify_event_mention: string;
  notify_event_nudge: string;
  notify_event_call: string;
  notify_event_request: string;
  convo_mute: string;
  convo_unmute: string;
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
  settings_security: string;
  settings_passwordOn: string;
  settings_passwordOffHint: string;
  settings_passwordEnable: string;
  settings_passwordChange: string;
  settings_passwordDisable: string;
  settings_passwordDisableApply: string;
  /** 瀏覽器停用密碼＝忘記身分（ADR-0122）。 */
  settings_passwordDisableBrowser: string;
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
  unlock_switch: string;
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
  rescue_resetOk: string;
  settings_backupCode: string;
  settings_backupCodeHint: string;
  settings_backupCodePw: string;
  settings_backupCodePw2: string;
  settings_backupCodeMake: string;
  settings_logout: string;
  settings_logoutHint: string;
  settings_logoutConfirm: string;
  settings_dangerZone: string;
  settings_removeIdentity: string;
  settings_removeIdentityHint: string;
  settings_removeIdentityConfirm: string;
  settings_wipeDeviceHint: string;
  wipe_device: string;
  /** 共享行程（ADR-0263）。 */
  aux_tabCalendar: string;
  /** 日期偵測提示（ADR-0264 階段四）。 */
  date_chipHint: string;
  date_barHint: string;
  cal_new: string;
  /** 行事曆視圖切換與導覽（ADR-0269）。 */
  cal_viewMonth: string;
  cal_viewWeek: string;
  cal_viewDay: string;
  cal_viewList: string;
  cal_today: string;
  cal_prev: string;
  cal_next: string;
  cal_title: string;
  cal_start: string;
  cal_end: string;
  cal_location: string;
  cal_desc: string;
  cal_save: string;
  cal_dismiss: string;
  cal_edit: string;
  cal_cancelEvent: string;
  cal_cancelConfirm: string;
  cal_rsvpYes: string;
  cal_rsvpMaybe: string;
  cal_rsvpNo: string;
  cal_none: string;
  cal_by: string;
  cal_byYou: string;
  /**
   * 行動端專用（ADR-0265）：手機沒有 `datetime-local`，改用相對調整鈕，故多這幾個字串。
   * `cal_durNone` ＝不設結束時間（單點行程）。
   */
  cal_durLabel: string;
  cal_durNone: string;
  cal_dur1h: string;
  cal_dur2h: string;
  cal_durAllDay: string;
  cal_adjHint: string;
  /** 行程提醒（ADR-0266）：本機計時器、零中繼成本。 */
  cal_remindLabel: string;
  cal_remindOff: string;
  cal_remindNow: string;
  cal_remind5m: string;
  cal_remind15m: string;
  cal_remind1h: string;
  cal_remind1d: string;
  cal_remindHint: string;
  cal_reminderBody: string;
  /** NIP-62 清除請求（ADR-0260）。 */
  /** 贊助此節點角落卡（ADR-0089／0262）。 */
  sponsor_title: string;
  sponsor_who: string;
  sponsor_note: string;
  sponsor_dismiss: string;
  vanish_title: string;
  vanish_hint: string;
  vanish_action: string;
  vanish_confirm: string;
  vanish_sent: string;
  wipe_confirmWord: string;
  wipe_confirm: string;
  wipe_mismatch: string;
  /** 行動端改密碼／備份碼（ADR-0135）。 */
  mobilePassword_changed: string;
  /** 多身分（ADR-0138）。 */
  identities_title: string;
  identities_add: string;
  identities_active: string;
  /** 設定分頁（ADR-0142）。 */
  settingsTab_appearance: string;
  settingsTab_identity: string;
  settingsTab_relay: string;
  settingsTab_privacy: string;
  settingsTab_advanced: string;
  /** 關於／版本分頁（ADR-0227）。 */
  settingsTab_about: string;
  settings_aboutVersion: string;
  settings_aboutWhatsNew: string;
  settings_updateAvailable: string;
  settings_updateDownload: string;
  settings_updateCheck: string;
  settings_updateCheckHint: string;
  /** 統一自訂對話框（ADR-0139）。 */
  dialog_titleConfirm: string;
  dialog_titleAlert: string;
  dialog_titlePrompt: string;
  dialog_confirm: string;
  dialog_cancel: string;
  dialog_ok: string;
  /** 隱藏身分解鎖（ADR-0045/0067）。 */
  hiddenId_prompt: string;
  hiddenId_fail: string;
  close_title: string;
  close_message: string;
  close_quit: string;
  close_tray: string;
  backup_copy: string;
  backup_wrong: string;
  settings_cloud: string;
  settings_cloudHint: string;
  /** 系統備份不涵蓋本 App（ADR-0279）：換機請走配對搬家或加密雲端備份。 */
  settings_noSystemBackup: string;
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
  /** 檔案暫時送不出去（無 P2P 直連、站方也無 relay 檔案後備）；ADR-0244。 */
  file_unavailableHint: string;
  file_download: string;
  file_sending: string;
  /** 收檔另存後顯示的前綴（ADR-0093），後接儲存路徑。 */
  file_saved: string;
  /** 檔案位元組落在使用者的另一台裝置、此裝置只收到 metadata（ADR-0093）。 */
  file_onOtherDevice: string;
  /** 已收到位元組但使用者未另存（取消對話框，ADR-0093）。 */
  file_notSaved: string;
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
  emoji_manifestTooLarge: string;
  emoji_tab: string;
  emoji_import: string;
  emoji_shortcodePrompt: string;
  emoji_empty: string;
  emoji_insert: string;
  emoji_hint: string;
  emoji_importPack: string;
  emoji_packImported: string;
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
  slash_hint: string;
  settings_composer: string;
  settings_enterToSend: string;
  settings_enterToSendHint: string;
  mention_hint: string;
  mention_you: string;
  thread_title: string;
  thread_empty: string;
  thread_reply: string;
  thread_open: string;
  /** 串回覆同傳主對話與一鍵複製（ADR-0232）。 */
  thread_alsoMain: string;
  thread_alsoMainBadge: string;
  convo_copy: string;
  convo_copied: string;
  /** 收回確認彈窗與無痕收回（ADR-0234）。 */
  unsend_confirmTitle: string;
  unsend_confirmBody: string;
  unsend_traceless: string;
  unsend_tracelessHint: string;
  thread_replies: string;
  /** 行動端內嵌回覆（ADR-0136）。 */
  reply_label: string;
  reply_cancel: string;
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
  urlrisk_knownMalicious: string;
  urlrisk_unparsable: string;
  /** 威脅情報遮罩與送出端警示（ADR-0231 P3）。 */
  threat_sourceCustom: string;
  threatMask_label: string;
  threatMask_bySource: string;
  threatMask_reveal: string;
  threatSend_confirm: string;
  threatSend_blocked: string;
  settings_threatTitle: string;
  settings_threatEnable: string;
  settings_threatEnableHint: string;
  settings_threatSendWarn: string;
  settings_threatStrict: string;
  settings_threatCustom: string;
  settings_threatCustomApply: string;
  settings_privacy: string;
  settings_cleanOnPaste: string;
  settings_autoAcquireAssets: string;
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
  /** 掃描對方 QR 加好友（ADR-0280）。 */
  qr_scan: string;
  /** 掃描中的提示（對準對方的 QR）。 */
  qr_scanHint: string;
  /** 掃描失敗（權限被拒／無相機）。 */
  qr_scanFailed: string;
  /** 掃到的內容不是有效的 npub。 */
  qr_scanNotNpub: string;
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
  /** 停止/恢復傳送視訊（ADR-0337）。文案刻意不說「關閉相機」——軌道仍開著，相機指示燈可能仍亮。 */
  call_camera_off: string;
  call_camera_on: string;
  /** 通話中升降級（ADR-0338）。文案是「我」的動作——不會替對方開鏡頭。 */
  call_toVideo: string;
  call_toAudio: string;
  /** 對方只送語音時的說明（ADR-0338：媒體型態每方向獨立，UI 要照實說）。 */
  call_remoteAudioOnly: string;
  /** 視訊畫質檔位（ADR-0337）。 */
  call_quality: string;
  call_quality_low: string;
  call_quality_medium: string;
  call_quality_high: string;
  /** 設定頁的預設畫質（ADR-0337）：通話中可隨時改，這裡設的是下一通的起點。 */
  settings_videoQuality: string;
  settings_videoQualityHint: string;
  /** 通話連不通（限制網路、無 TURN 退路）；ADR-0243。 */
  call_failed_unreachable: string;
  /** 通話已連上後中途斷線；ADR-0243。 */
  call_failed_lost: string;
  group_create: string;
  group_name: string;
  group_members: string;
  group_confirm: string;
  group_section: string;
  group_membersCount: string;
  group_leave: string;
  /** 移除成員（僅管理者）。 */
  group_remove: string;
  /** 行動端設定：上線狀態（ADR-0114）。 */
  settings_status: string;
  /** 「記住我」（行動端本地密碼，ADR-0117）。 */
  remember_label: string;
  remember_placeholder: string;
  remember_hint: string;
  remember_forget: string;
  /** 配對搬家——送出端（行動端，ADR-0118）。 */
  pairExport_title: string;
  pairExport_hint: string;
  pairExport_start: string;
  pairExport_offerHint: string;
  pairExport_waiting: string;
  pairExport_sasWarn: string;
  pairExport_sasMatch: string;
  pairExport_sasMismatch: string;
  pairExport_sending: string;
  pairExport_done: string;
  pairExport_reset: string;
  pairExport_needRelay: string;
  pair_sasLabel: string;
  copy: string;
  copied: string;
  group_labelAdd: string;
  group_labelPlaceholder: string;
  group_labelRemove: string;
  group_pin: string;
  group_unpin: string;
  group_filterAll: string;
  sort_label: string;
  sort_byStatus: string;
  sort_byGroup: string;
  sort_byName: string;
  contactGroup_ungrouped: string;
  contactGroup_all: string;
  nav_back: string;
}

const zhHant: Messages = {
  appName: "Cinderous",
  brand_visitSite: "前往官網",
  signIn_title: "登入 Cinderous",
  signIn_hint: "去中心化、端到端加密的即時通。輸入顯示名稱即可開始（你的身分是本機生成的 secp256k1 金鑰）。",
  signIn_password: "本機密碼",
  signIn_passwordAgain: "再輸入一次",
  signIn_passwordWhy:
    "網頁版沒有系統金鑰庫，你的私鑰只存在這個分頁裡。請設一組本機密碼把它加密保存——否則重新整理頁面就會失去這個身分。密碼只留在你的裝置上，忘記無法救回（但可用備份的 nsec 重新登入）。",
  signIn_passwordRequired: "請設定本機密碼（否則重新整理就會失去身分）",
  signIn_passwordMismatch: "兩次輸入的密碼不一致",
  signIn_useNsec: "已經有身分？用 nsec 登入",
  signIn_useNsecHint: "貼上你備份的 nsec（設定 →「身分備份」可複製）。你會回到同一個身分，中繼站上還留著的近期訊息也會回來。\n\n⚠️ 更早的歷史不會——那要從舊裝置搬家，或先開啟多裝置同步。若你曾啟用前向保密，加密到子鑰的訊息也需要那把子鑰，而 nsec 裡不含它。",
  signIn_useNsecButton: "以 nsec 登入",
  signIn_nsec: "nsec 私鑰",
  signIn_nsecInvalid: "無效的 nsec，或它不是這個身分的金鑰",
  signIn_relayUsing: "將連線到 {host}",
  signIn_relayDemo: "尚未連線中繼站",
  signIn_relayProbing: "正在挑選中繼站…",
  signIn_relayChange: "使用其他中繼站",
  signIn_relayHide: "使用預設中繼站",
  signIn_displayName: "顯示名稱",
  signIn_relayUrl: "中繼站網址",
  signIn_button: "登入",
  signIn_enterExisting: "登入既有身分",
  signIn_enterExistingHint: "本機已有這個名稱的身分，將直接登入「{name}」（若有本地密碼會請你解鎖）。",
  signIn_createHint: "這個名稱是新的，將建立新身分（本機生成金鑰）。",
  signIn_createButton: "建立新身分",
  signIn_ambiguousName: "本機有多個同名身分（可能是舊資料），無法自動判斷。請改用「用 nsec 登入」，或稍後在設定裡改名區分。",
  mobileSignIn_title: "登入 Cinderous",
  mobileSignIn_backToCreate: "← 改為建立新身分",
  mobileSignIn_nameLabel: "顯示名稱",
  mobileSignIn_nsecLabel: "私鑰（nsec）",
  mobileSignIn_nsecPlaceholder: "貼上 nsec1…",
  mobileSignIn_derived: "身分",
  mobileSignIn_button: "登入",
  mobileSignIn_errName: "請輸入顯示名稱",
  mobileSignIn_errNsec: "nsec 格式不正確",
  mobileSignIn_nameTaken: "本機已有同名身分，請換一個名稱。",
  mobileSignIn_hint: "去中心化、端到端加密的即時通。輸入顯示名稱即可開始（你的身分是本機生成的金鑰，不需手機號碼或電子郵件）。",
  mobileSignIn_toPair: "改用從舊裝置匯入",
  mobilePair_title: "從舊裝置匯入",
  mobilePair_codeLabel: "配對碼",
  mobilePair_codePlaceholder: "貼上舊裝置顯示的配對碼",
  mobilePair_connect: "連線",
  mobilePair_relayVia: "會合中繼站",
  mobilePair_sasHint: "確認兩台裝置顯示相同數字",
  mobilePair_waiting: "等待舊裝置確認…",
  mobilePair_errCode: "配對碼無效或已過期",
  mobilePair_errRejected: "對方拒絕了配對（顯示的數字不符，可能有安全風險）。請在舊裝置重新產生配對碼再試。",
  mobilePair_errNoIdentity: "配對資料不含身分",
  mobilePair_toNsec: "改用私鑰登入",
  mobileChats_title: "聊天",
  mobileChats_empty: "還沒有對話。加個好友或建立群組就會出現在這裡。",
  mobileChats_search: "搜尋（名稱或訊息）",
  mobileChats_you: "你：",
  mobileConvo_input: "輸入訊息…",
  mobileConvo_send: "送出",
  mobileConvo_back: "返回",
  mobileChats_add: "加好友",
  mobileChats_addPlaceholder: "貼上好友的 npub…",
  mobileChats_addBtn: "加入",
  mobileChats_myNpub: "你的 npub（分享給朋友加你）",
  mobileTab_chats: "聊天",
  mobileTab_contacts: "聯絡人",
  mobileTab_settings: "設定",
  mobileSettings_appearance: "外觀",
  mobileSettings_theme: "主題",
  mobileSettings_light: "淺色",
  mobileSettings_dark: "深色",
  mobileSettings_accent: "主色",
  mobileSettings_language: "語言",
  mobileSettings_relay: "中繼站",
  mobileSettings_relayDemo: "尚未連線中繼站",
  mobileSettings_logout: "登出",
  mobileContacts_empty: "還沒有聯絡人。到聊天分頁按「＋」貼 npub 加好友。",
  addId_title: "新增身分",
  addId_close: "關閉",
  addId_relay: "relay 網址（wss://…）",
  addId_enterprise: "工作身分（鎖定此節點、不漫遊）",
  addId_admin: "管理者 npub（可選，自動同步企業通訊錄）",
  addId_import: "匯入 nsec 或救援登入碼（留空＝產生新身分）",
  addId_error: "救援密碼錯誤或私鑰格式不符",
  addId_nameTaken: "本機已有同名身分，請換一個名稱（登入時以名稱辨識要進哪個身分）。",
  addId_submit: "建立並切換",
  addId_busy: "還原中…",
  addId_modePersonal: "個人身分",
  addId_modePersonalHint: "一般帳號；聯絡人由你自己管理。",
  addId_modeOrg: "企業成員",
  addId_modeOrgHint: "工作身分：訂閱組織管理者發佈的名冊，自動採用通訊錄與政策（可選填管理者 npub）。",
  addId_modeOwner: "企業主（建立組織名冊）",
  addId_modeOwnerHint: "一般身分＋名冊管理權：建立後直接進入組織名冊管理，複製入職邀請碼給員工即可佈建。",
  addId_changeMode: "← 重新選擇類型",
  addId_invite: "貼上入職邀請碼（自動填入中繼站與管理者）",
  addId_inviteApplied: "已套用邀請碼：建立後會自動向管理者提出入職，核准後全公司通訊錄自動同步。",
  roster_inviteHint: "入職邀請碼（含中繼站＋你的身分＋核准權杖）：員工在登入畫面或「企業成員」表單貼上即自動加入",
  roster_inviteCopy: "複製",
  roster_escrow: "建立為公司帳號（雇主持有金鑰備份，供離職接管；員工建立時會明示同意）",
  signIn_joinEscrow: "⚠️ 這是公司帳號：你的登入金鑰會加密託管給雇主（等同公司信箱的管理權），供你離職時由雇主接管或封鎖。個人隱私聯絡請用個人身分。",
  settings_offboard: "離職帳號接管",
  settings_offboardHint: "已從名冊移除（離職）且當初以公司帳號託管金鑰的成員。接管＝以其金鑰在本機登入查看中繼站仍保留的訊息；也可直接刪除託管。",
  offboard_takeover: "接管登入",
  offboard_delete: "刪除託管",
  offboard_takeoverConfirm: "以這位離職員工的金鑰在本機登入、查看其歷史？純本機查看，不會廣播上線（自動隱身）。",
  offboard_deleteConfirm: "刪除這位離職員工的託管金鑰？刪除後將無法再接管其帳號或查看歷史，且無法復原。",
  roster_welcomeLabel: "歡迎詞／基本規範（可選：新成員加入時一次性顯示，並可隨時在設定 → 組織資訊查看）",
  roster_workHoursLabel: "表定上下班時間（可選：下班時間成員端自動靜音公司通知；留空＝不設）",
  roster_ttlLabel: "離線訊息保留天數（可選，1–365；留空＝預設 7 天。需自架 relay 以 MAX_TTL_DAYS 放寬上限，站方上限恆為權威）",
  roster_relayFilesLabel: "檔案經 relay 暫存上限（MB，可選，1–16；留空＝關、維持 P2P。啟用後成員間 ≤ 上限的檔案離線也送得到；需自架 relay 設 MAX_FILE_MB）",
  roster_inviteLabel: "入職邀請碼",
  roster_orgName: "組織名稱",
  roster_membersLabel: "成員",
  roster_membersHint: "每行一位：npub 名稱（管理者已預填；移除成員＝刪掉該行後重新發布）",
  roster_parseError: "無法解析：",
  roster_needMember: "至少需要一位成員",
  roster_publishFailed: "發布失敗",
  roster_published: "名冊已發布並佈建到中繼站。",
  roster_publish: "發布名冊",
  settings_orgRoster: "組織名冊",
  settings_createCompany: "建立公司（企業主）",
  settings_vaultDesktopOnly: "🖥 公司儲存槽「收檔落盤」僅桌面版支援（需檔案系統）。員工可從手機『存入』，但企業主端收檔／歸檔請用桌面版。",
  orgInfo_title: "組織資訊",
  orgInfo_hours: "表定上班時間：{start}–{end}",
  orgInfo_muteNote: "下班時間，來自公司成員與組織群組的通知會自動靜音（未讀照常累計）。",
  orgPolicy_title: "公司政策",
  orgPolicy_disabledHead: "已停用的功能",
  orgPolicy_rulesHead: "生效中的規則",
  orgPolicy_files: "檔案傳輸（含拍照直傳）",
  orgPolicy_calls: "發起語音／視訊通話（仍可接聽）",
  orgPolicy_stickers: "貼圖與自訂 emoji（仍看得到別人送的）",
  orgPolicy_cloudBackup: "加密雲端備份",
  orgPolicy_forceTurn: "通話與檔案只走 TURN 中繼（不揭露內網 IP）",
  orgPolicy_ttlDays: "訊息保留 {days} 天",
  orgPolicy_relayFilesMb: "組織檔案可經中繼暫存，單檔上限 {mb} MB",
  orgPolicy_hint: "以上由貴公司簽章的名冊設定，無法在本機關閉。",
  settings_orgTitle: "頭銜",
  settings_orgTitleHint: "自填頭銜（最多 24 字），會廣播給這個身分的所有聯絡人——工作身分即全組織同事看得到。留空套用＝移除。",
  settings_orgTitleUpdated: "頭銜已更新並廣播。",
  convo_offHours: "目前非上班時間（{start}–{end}）——對方的通知已靜音，可能不會即時看到；訊息照常送達。",
  slot_deposit: "存入公司儲存槽",
  settings_slot: "公司儲存槽",
  slot_empty: "目前沒有排隊中的存放。",
  slot_retry: "重試失敗項",
  slot_remove: "移除",
  slot_pending: "排隊中",
  slot_sending: "傳輸中",
  slot_done: "已存放",
  slot_failed: "失敗",
  settings_slotDir: "儲存槽目錄",
  settings_slotDirHint: "同事存放的檔案會靜默寫入此資料夾（依員工分資料夾＋index.jsonl 索引）。",
  settings_slotDirPick: "選擇資料夾…",
  settings_slotDirDefault: "（未設定：使用應用程式資料夾內的 CinderSlot）",
  signIn_joinHint: "偵測到入職邀請：將在 {host} 建立企業成員身分，並自動向管理者提出入職。",
  signIn_joinName: "你的顯示名稱（同事會看到）",
  signIn_joinButton: "加入組織",
  idbar_addIdentity: "新增身分",
  idbar_unlockHidden: "解鎖隱藏身分",
  idbar_roster: "組織名冊（管理者）",
  idbar_switch: "切換身分",
  contact_myId: "我的 ID",
  contact_addPlaceholder: "貼上好友的 npub…（可附 @wss://中繼）",
  contact_add: "加好友",
  contact_copy: "複製",
  contact_copied: "已複製",
  contact_addSelf: "不能把自己的身分加為好友（會把你的分身連結給中繼站）",
  contact_addInvalid: "無效的 npub",
  contact_remove: "刪除",
  contact_block: "封鎖",
  request_section: "訊息請求",
  request_hint: "這些人不在你的聯絡人裡。接受之前，他們不會跳通知、不能敲你、也看不到你的上線狀態。",
  request_accept: "接受",
  request_decline: "刪除",
  request_preview: "查看訊息（不會通知對方）",
  request_clearAll: "全部刪除",
  contact_unblock: "解除封鎖",
  contact_removeConfirm: "確定要刪除 {name} 並清除對話紀錄嗎？",
  contact_blockConfirm: "確定要封鎖 {name}？將移出清單並忽略其後續訊息。",
  group_blocked: "已封鎖 ({count})",
  status_online: "線上",
  status_away: "離開",
  status_busy: "忙碌",
  status_offline: "顯示為離線（隱身）",
  msgStatus_sending: "傳送中",
  msgStatus_failed: "傳送失敗",
  msgStatus_sent: "已送出",
  msgStatus_delivered: "已送達",
  msgStatus_read: "已讀",
  readBy_list: "已讀：{names}",
  readBy_count: "已讀 {count}/{total}",
  calc_insertExpr: "插入算式與答案",
  calc_insertResult: "只插入答案",
  calc_insertHint: "點一下把「= 答案」加到訊息",
  convo_attach: "傳送檔案",
  convo_photo: "拍照傳送",
  fg_title: "Cinderous",
  fg_text: "保持連線中——訊息才收得到",
  settings_foreground: "背景保持連線",
  relayCheck_ok: "✓ 中繼行為正常",
  relayCheck_warn: "⚠ 這座中繼有隱私疑慮",
  relayCheck_down: "✕ 中繼無回應",
  relayCheck_noAuth: "不要求認證——任何人都能看到你何時收到訊息（訊息內容仍加密）",
  relayCheck_ephemeral: "可能保存了本該即時轉發的暫態事件",
  relayCheck_expired: "不遵守過期設定——你的密文可能被無限期留存",
  settings_foregroundHint:
    "以常駐通知讓連線在背景不中斷，訊息才收得到。不使用任何第三方推播服務——沒有人會知道你何時收到訊息；代價是通知列多一條狀態通知。關閉後，App 進背景可能就收不到訊息。",
  image_originalMissing: "找不到原圖——檔案可能已被移動或刪除。",
  image_relocate: "重新指定位置",
  image_thumbOnly: "此處只能顯示縮圖（瀏覽器無法讀取本機原檔）。",
  share_copyImage: "複製圖片",
  share_copyPath: "複製路徑",
  share_copied: "已複製",
  share_share: "分享",
  share_failed: "此環境不支援",
  settings_readReceipts: "已讀回條",
  settings_readReceiptsHint: "開啟後，你讀取訊息會通知對方；關閉則不送、也不顯示對方的已讀（互惠）。",
  settings_retention: "訊息保留上限",
  settings_retentionHint: "每個對話在快取區保留幾則；更舊的**移到封存**（歷史紀錄仍可讀），不刪除。預設無上限。網頁版空間有限，設個上限可把舊訊息移出 localStorage、紓解配額。",
  retention_unlimited: "無上限",
  retention_custom: "自訂",
  settings_storageFull: "⚠ 本機 localStorage 空間已滿，新訊息可能未保存。設一個保留上限可把舊訊息移進封存、騰出空間，或改用桌面版。",
  settings_export: "導出紀錄",
  settings_exportHint: "把對話紀錄導出成明文檔案（備份/存證）。",
  export_title: "導出對話紀錄",
  export_warning: "⚠ 導出的是明文，離開裝置加密保護。請自行妥善保管，勿外流。",
  export_scope: "範圍",
  export_selectAll: "全選",
  export_format: "格式",
  export_run: "導出",
  export_this: "導出此對話",
  history_title: "歷史紀錄",
  history_search: "搜尋封存的舊訊息…",
  history_scanning: "掃描 {done}/{total} 塊（逐塊解密、不留索引）",
  history_searchClear: "清除",
  history_open: "歷史紀錄（封存的舊訊息）",
  history_older: "載入更早",
  history_loading: "載入中…",
  history_empty: "沒有封存的訊息",
  msg_unsent: "（已收回）",
  msg_unsend: "收回",
  block: "封鎖",
  unblock: "解除",
  blocked_title: "已封鎖",
  group_new: "新群組",
  group_namePlaceholder: "群組名稱（可留空）",
  export_empty: "沒有可導出的對話。",
  settings_invisible: "隱身",
  settings_invisibleHint: "開啟後你對中繼站完全消失——既不廣播自己的在線狀態，也不向中繼查詢聯絡人是否在線。因此你的聯絡人清單不會離開這台裝置（最強的元資料隱私）。代價：你也看不到聯絡人的在線綠點。訊息收發完全正常。",
  fs_title: "前向保密（實驗性）",
  fs_hint: "啟用後，你送出的**訊息內容**（文字、貼圖、自訂 emoji、檔案名稱、共享行程、訊息回應，群組也包含在內）會加密到一把「會過期的加密子鑰」；金鑰每 7 天自動更換，舊金鑰過期後，就算你的身分私鑰被竊，被側錄的舊密文也解不開。**不涵蓋：收回訊息、群組成員變更、已讀回條、正在輸入中／敲一下、語音視訊通話。**本機歷史不受影響、身分不變。",
  group_tooManyMembers: "群組人數上限為 {max} 人（含你自己）。請先減少一些成員再建立。",
  pair_largeBundleWarn: "你的資料量比較大（約 {mb} MB），傳輸會花一些時間。\n\n⚠️ 這個傳輸**不支援中斷後續傳**——如果中途斷線，必須從頭再來一次（含重新掃碼與比對安全碼）。\n\n建議：兩台裝置放在一起、保持螢幕開啟、接上電源，再開始。",
  fs_unaudited: "⚠️ 尚未經外部密碼學審計。這個功能已經寫完並通過我們自己的測試，但還沒有獨立的第三方檢查過它。加密的錯誤不會讓程式壞掉——它只是不保護，而且沒有任何症狀。在審計完成前，請不要把它當成可靠的保障。",
  fs_enableConfirm: "要啟用前向保密（實驗性）嗎？\n\n・這個功能**尚未經外部密碼學審計**。\n・我們自己的測試全過，但那只證明「我們想到的情況都對」，不證明沒有漏洞。\n・請把它當成「有比沒有好」，不要當成可靠的保障。\n・你可以隨時關閉；本機歷史與身分都不受影響。",
  fs_enable: "啟用前向保密",
  fs_enabled: "前向保密已啟用",
  fs_rotate: "立即更換加密金鑰",
  fs_rotateConfirm: "要立即更換加密金鑰嗎？\n\n更換後：\n・還沒學到你新金鑰、或離線中的聯絡人，送到你舊金鑰的在途訊息，過了保留期（約 7 天）可能收不到。\n・你的其他裝置需上線同步新金鑰。\n・你寫下來的備份碼仍可還原身分與本機歷史（不含加密子鑰）。",
  fs_autoRotate: "金鑰每 7 天自動更換一次；下面那顆是「我懷疑現在就被入侵了」時用的。",
  fs_undecryptable: "⚠️ 這台裝置有 {count} 則收到的訊息解不開（最後一次：{when}）。可能是對方用了你已更換掉的舊金鑰，也可能只是損壞的資料——這兩者無法分辨。解不開的訊息不會顯示，也查不出是誰送的。若經常發生，請讓對方更新到最新版並保持上線。",
  settings_groupInvite: "允許任何人把我加進群組",
  settings_groupInviteHint: "關閉（預設）：只有你的聯絡人可以把你加進群組；陌生人的邀請會先進「訊息請求」，你接受那個人之後群組才會出現。開啟：任何知道你 npub 的人都能直接把你拉進群組。封鎖的人永遠擋得住，與此設定無關。",
  groupInvite_held: "{name} 想把你加進「{group}」。在「訊息請求」接受他之後，群組才會出現。",
  groupFs_summary: "本群 {total} 位成員中，{covered} 位的訊息有前向保密。",
  groupFs_known: "加密子鑰已知",
  groupFs_unknown: "未知",
  groupFs_lost: "曾知現無",
  devices_title: "我的裝置",
  devices_thisOne: "這台",
  devices_firstSeen: "首次看到 {when}",
  devices_limit: "⚠️ 這份清單只看得到**會寫入的裝置**（有開雲端備份、或與你配對過的）。任何拿到你身分私鑰的人都能安靜地讀取訊息而不留下痕跡——**看到只有一台，不等於沒有人在讀你的訊息**。",
  devices_new: "⚠️ 偵測到一台你沒見過的裝置（{id}）。如果不是你自己新增的，請立即更換身分金鑰。",
  devices_source_local: "這台裝置",
  devices_source_snapshot: "雲端備份",
  devices_source_pairing: "配對搬家",
  devices_notInDirectory: "⚠ 不在裝置目錄內",
  devices_stale: "（久未出現）",
  devices_forget: "從清單移除",
  devices_forgetConfirm: "要把這台從清單移除嗎？\n\n這只是清掉這台電腦上的一筆紀錄——**不會撤銷任何東西、也不會動到任何金鑰**。\n如果它哪天又出現，它會再次被記錄下來。",
  devices_conflict: "⚠️ 偵測到兩份互相衝突的裝置目錄（版本 {v}）。這代表有人用你的身分私鑰簽了另一份——**你的私鑰可能已經外洩**。本機沒有採用任何一份（選邊等於幫對方決定）。請考慮更換身分金鑰。",
  devices_revUnknown: "裝置目錄還在建立中，請稍候再試移除。",
  devices_revDualTrack: "⚠️ 目前移除裝置**還不會生效**：裝置 {ids} 仍在使用舊的金鑰同步方式，只要它還在，被移除的裝置照樣拿得到新金鑰。請先更新那台裝置。",
  devices_revActive: "移除裝置後，它將無法讀取之後的新訊息（已收到的歷史不受影響）。",
  devices_remove: "移除這台裝置",
  devices_removeConfirm: "要移除這台裝置嗎？\n\n・它將無法讀取**之後**的新訊息。\n・它已經收到的歷史**不受影響**，你救不回來。\n・保留期內（約 7 天）它仍能解開在途的舊訊息——這是為了不讓所有在途訊息一起掉。\n・如果它拿到的是你的身分私鑰而不只是那台裝置，移除**擋不住**——那種情況要換身分金鑰。",
  devices_revoked: "已移除",
  devices_conflictLog: "偵測到的目錄異常",
  devices_conflictRow: "{when}：收到版本 {incoming} 的目錄，但本機已在版本 {mine}（版本倒退）。這只可能來自重放或有人用你的身分私鑰簽了舊版本。本機沒有採用它。",
  devices_myCode: "這台的裝置代碼",
  devices_myCodeHint: "要讓這台加入你的裝置清單，請在**另一台已在清單上的裝置**貼上這串代碼並授權。代碼不是祕密，但請**比對兩邊顯示的字元是否一致**——貼錯就是授權了別人。",
  devices_authorize: "授權裝置",
  devices_authorizeHint: "貼上新裝置顯示的代碼。只有已在清單上的裝置能授權——這是為了讓「拿到你身分私鑰但沒碰到你這台」的人加不進來。",
  devices_authorizePlaceholder: "貼上裝置代碼",
  devices_authorizeConfirm: "要授權這台裝置嗎？\n\n・它將能讀取你之後收到的所有訊息。\n・請先確認代碼與那台裝置螢幕上顯示的**完全一致**。\n・授權後可以隨時移除。",
  devices_noAuthority: "這台裝置還不在清單上，因此不能授權其他裝置。請先在已在清單上的裝置授權這一台。",
  devices_tierTitle: "這台的金鑰保護等級",
  devices_tierPlaintext: "⚠️ **明文存放**。這台的裝置金鑰目前直接存在瀏覽器／App 的本機儲存區，沒有加密。若有人取得這台電腦的磁碟內容（備份、舊機沒清、或惡意程式），他就能拿到這把金鑰——**這種情況下「移除裝置」擋不住他**。真正的保護要等這把金鑰移進作業系統金鑰庫。",
  devices_tierEncrypted: "已加密存放，但**包裹它的那把金鑰是軟體保管的**（瀏覽器或系統代管，沒有你的密碼參與）。所以：想偷金鑰的腳本**偷不走**它——這相對於明文是實質改善；但**完整複製這台的資料**、而且知道怎麼做的人，仍有機會解開。真正擋得住磁碟複製的是安全晶片，這台沒有或不支援。",
  devices_tierKeystore: "存在作業系統金鑰庫（桌面）或裝置安全晶片（Android）。磁碟被複製也解不開；但**這不代表裝置被入侵時也安全**——我們是在需要時把金鑰**取出來用**，不是請晶片代簽，所以以你的身分執行的惡意程式一樣讀得到。",
  devices_tierEphemeral: "⚠️ **這次開機沒能打開金鑰庫**（例如系統的金鑰服務沒啟動）。目前用的是臨時金鑰、沒有存下來——所以**這台不會出現在你的裝置清單裡**，重開又是新的一把。我們刻意不在這種時候偷偷生一把新的長期金鑰把你換掉。修好金鑰庫後重開即可恢復原本的裝置身分。",
  devices_tierWasPlain: "⚠️ 這把金鑰是從舊版的明文儲存**搬進**金鑰庫的。搬進來以後磁碟被複製已經沒用了，但**在那之前備份過磁碟的人可能已經有一份**——刪掉舊副本收不回已經被拿走的東西。若你在意這點，可以移除這台再重新配對，換一把從未明文躺過的金鑰。",
  fs_disable: "停用前向保密",
  fs_disableConfirm: "要停用前向保密嗎？\n\n・之後送出的訊息**不再**有前向保密（回到與一般訊息相同的保護）。\n・已經送出的訊息不受影響。\n・你的聯絡人會收到「已停用」的明確通知——這是必要的，否則他們會以為你還開著。\n・本機歷史、身分、備份碼都不受影響。\n・可以隨時再開啟。",
  fs_downgradeWarning: "⚠️ 這位聯絡人啟用了前向保密，但你這端還沒收到他的目前金鑰——這則訊息暫時以一般方式加密（無前向保密）。可能是對方金鑰尚未同步（稍後會自動更新），若持續出現請留意。",
  fs_unsupportedWarning: "ℹ️ 這位聯絡人使用了你這個版本還不支援的加密機制，因此這則訊息以你們雙方都支援的方式加密。請更新到最新版本。（這不是安全警告——對方並沒有降級。）",
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
  sidebar_search: "搜尋名稱或訊息…",
  sidebar_empty: "沒有符合的聯絡人或群組",
  sidebar_labelAdd: "加標籤",
  deck_pickChat: "從左側雙擊聯絡人或群組開始對話",
  aux_pickChat: "開啟一個對話以檢視輔助資訊",
  aux_tabInfo: "資訊",
  aux_tabMembers: "成員",
  aux_tabMedia: "媒體",
  aux_tabThreads: "對話串",
  aux_tabNote: "便條",
  aux_title: "對話輔助（媒體／對話串／便條／行程）",
  note_placeholder: "便條…（記筆記；最後一行輸入算式如 12*8 會自動算出）",
  note_hint: "私人便條，每個對話一張，只存在這台裝置（不廣播、不上雲）。輸入算式會自動辨識，可插入對話。",
  note_placeholderM: "便條…（記筆記，只存這台裝置）",
  note_hintM: "私人便條，每個對話一張，加密存在這台裝置（不廣播、不上雲）。計算請直接在下方輸入框打算式。",
  aux_noMedia: "此對話尚無圖片",
  aux_noThreads: "此對話尚無對話串",
  aux_you: "你",
  aux_admin: "管理者",
  aux_replies: "{count} 則回覆",
  settings_layout: "版面佈局",
  settings_layoutClassic: "經典（浮動視窗）",
  settings_layoutModern: "三欄整合",
  settings_layoutHint: "經典＝可同時攤開多個對話視窗；三欄＝左聯絡人／中對話／右輔助（開發中，逐步完善）。只存本機。",
  deck_auxPlaceholder: "對話輔助區（建置中）",
  settings_accent: "主題色",
  settings_accentPrimary: "主色（泡泡／按鈕／連結）",
  settings_accent2: "副色（標題列／背景漸層）",
  settings_accent2Follow: "跟隨主色",
  settings_accentCustom: "自訂色",
  settings_accentReset: "預設",
  settings_accentCb: "色覺友善（色盲可辨）",
  settings_a11y: "無障礙",
  a11y_contrast: "高對比模式",
  a11y_contrastHint: "拉高文字與邊框對比（WCAG AA），與深淺主題可並用；未設定時跟隨系統的高對比偏好。",
  a11y_stateOn: "開",
  a11y_stateOff: "關",
  a11y_uiScale: "介面尺寸",
  a11y_uiScaleHint: "整體縮放文字與介面（立即生效、只存這台裝置）。",
  settings_accentHint: "即時套用、只存在本機；深色主題會自動提亮以維持對比。主色連吉祥物身體，副色驅動標題列與頂部漸層（留空＝跟隨主色）。",
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
  convo_p2pDirect: "直連",
  convo_p2pNone: "直連未建立",
  convo_p2pDirectHint: "已與對方建立點對點直連——檔案、通話、輸入中走 P2P（更快、不經中繼）。",
  convo_p2pNoneHint: "尚未建立直連；文字訊息照常送達，但檔案與通話可能無法使用。",
  convo_typing: "{name} 正在輸入訊息…",
  alias_set: "設定暱稱",
  alias_edit: "編輯暱稱",
  alias_prompt: "為「{name}」設定本地暱稱（只有你看得到，不會通知對方；留空即清除）：",
  alias_placeholder: "本地暱稱",
  alias_showBroadcast: "點一下看對方廣播的名稱",
  alias_showAlias: "點一下切回你的暱稱",
  convo_emojiTitle: "表情",
  convo_nudge: "震動",
  convo_nudgeTitle: "震動對方視窗",
  convo_composerPlaceholder: "輸入訊息…（Enter 送出，Shift+Enter 換行）",
  convo_send: "送出",
  convo_close: "關閉",
  convo_resize: "拖曳調整大小",
  avatar_change: "更換頭像",
  avatar_remove: "移除頭像",
  avatar_fromUrl: "從網址設定…",
  avatar_urlPrompt: "輸入圖片網址（會在本機下載並縮圖，網址不會傳給任何聯絡人）",
  avatar_urlError: "無法載入這個網址的圖片（伺服器不允許跨站存取、非圖片或無法連線）。請下載後改用上傳。",
  avatar_syncHint: "會同步給聯絡人",
  personalize_quota: "圖片太大，本機儲存空間不足，請換小一點的圖。",
  chatbg_title: "對話背景",
  chatbg_upload: "上傳圖片",
  chatbg_clear: "清除背景",
  convo_react: "回應",
  convo_unsend: "收回",
  convo_showFull: "展開全文",
  convo_msgDetail: "訊息詳情",
  convo_unsent: "訊息已收回",
  convo_loadEarlier: "載入較早的 {count} 則訊息",
  convo_search: "搜尋訊息",
  convo_searchHint: "搜尋此對話…",
  convo_searchNone: "無符合",
  convo_searchPrev: "上一個（較舊）",
  convo_searchNext: "下一個（較新）",
  roster_search: "搜尋（名稱或訊息）",
  convo_timerTitle: "限時訊息（閱後即焚）",
  convo_timerOff: "限時：關",
  convo_timer1m: "限時：1 分鐘",
  convo_timer1h: "限時：1 小時",
  convo_timer1d: "限時：1 天",
  convo_expired: "訊息已到期",
  lang_label: "語言",
  theme_toggle: "深色 / 淺色模式",
  nowPlaying_placeholder: "正在聽…（分享音樂狀態）",
  npAuto_toggle: "點擊切換：自動偵測正在播放的音樂",
  npAuto_detecting: "偵測中…（沒在播放音樂）",
  settings_open: "設定",
  settings_title: "設定",
  settings_relayUrl: "中繼站",
  settings_relayDemo: "未設定中繼站",
  settings_identityBackup: "身分備份",
  settings_displayName: "顯示名稱",
  settings_nameApply: "更新",
  settings_nameUpdated: "名稱已更新",
  settings_nameTaken: "本機已有同名身分，請換一個名稱。",
  settings_identityWarning: "這是你的私鑰（nsec），等同你的帳號本身。任何人拿到都能冒充你——切勿外流或貼給他人。請離線妥善保存。",
  settings_revealKey: "顯示私鑰（nsec）",
  settings_hideKey: "隱藏私鑰",
  settings_copyKey: "複製",
  settings_copied: "已複製",
  settings_notifications: "桌面通知",
  settings_notificationsHint: "視窗未聚焦時，有新訊息就通知。",
  settings_notifySound: "通知提示音",
  settings_notifyChime: "提示音效",
  sound_perContact: "此聯絡人的通知音效",
  sound_useDefault: "跟隨全域預設",
  sound_preview: "試聽",
  chime_classic: "叮咚（經典）",
  chime_descend: "咚叮（下行）",
  chime_triple: "三連音",
  chime_bell: "鐘聲",
  chime_drop: "水滴",
  chime_knock: "叩叩",
  titlebar_minimize: "最小化",
  titlebar_maximize: "最大化／還原",
  titlebar_close: "關閉",
  settings_titlebar: "視窗外框",
  titlebar_dragHint: "用滑鼠把按鈕拖到標題列左右兩側，即可調整位置與順序。",
  titlebar_autoHide: "平時隱藏整條標題列（滑鼠移到視窗頂端才滑入）",
  titlebarStyle_flat: "扁平",
  titlebarStyle_rounded: "圓角",
  titlebarStyle_mac: "交通燈",
  titlebarStyle_compact: "精簡",
  settings_notifyHidePreview: "隱藏內文預覽（只顯示有新訊息）",
  notify_newMessage: "有新訊息",
  notify_nudge: "敲了你一下",
  notify_call: "來電",
  settings_notifyEvents: "要通知哪些事件",
  notify_event_dm: "私訊",
  notify_event_group: "群組訊息",
  notify_event_mention: "有人 @我（群組關也通知）",
  notify_event_nudge: "敲一敲",
  notify_event_call: "來電",
  notify_event_request: "陌生人訊息請求",
  convo_mute: "靜音此對話",
  convo_unmute: "取消靜音",
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
  settings_security: "安全（本地密碼）",
  settings_passwordOn: "本地密碼已啟用：私鑰與資料金鑰以密碼包裹保存，不輸入密碼無法解開。",
  settings_passwordOffHint: "共用電腦建議啟用：以密碼衍生金鑰（Argon2id）包裹私鑰與資料金鑰，別人拿到這台電腦也解不開。不防執行中的惡意軟體。",
  settings_passwordEnable: "啟用本地密碼",
  settings_passwordChange: "改密碼",
  settings_passwordDisable: "停用",
  settings_passwordDisableApply: "確認停用",
  settings_passwordDisableBrowser:
    "⚠️ 網頁版沒有系統金鑰庫。停用密碼＝**忘記這個身分**：下次開啟必須貼回 nsec 才能進來。請先到「身分備份」複製 nsec。",
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
  unlock_forgot: "忘記密碼？",
  unlock_switch: "用其他身分登入",
  rescue_title: "救援 {name} 的資料",
  rescue_hint: "輸入你的私鑰（nsec）或救援登入碼，設一組新密碼，即可救回這台裝置上的完整資料。忘記舊密碼沒關係——舊密碼無法找回，這裡是設一組全新的。",
  rescue_secret: "私鑰（nsec1…）或救援登入碼",
  rescue_backupPw: "救援密碼",
  rescue_newPw: "設定新密碼",
  rescue_newPw2: "再輸入一次新密碼",
  rescue_submit: "救援並解鎖",
  rescue_busy: "救援中…",
  rescue_back: "返回",
  rescue_error: "私鑰／救援登入碼不符，或此身分沒有救援資料。",
  rescue_resetOk: "密碼已重設成功，但自動解鎖失敗。請重新啟動 App，以新密碼登入。",
  settings_backupCode: "產生救援登入碼",
  settings_backupCodeHint: "救援登入碼＝救援密碼加密的私鑰＋你的中繼站網址，印出或存到自選位置。裝置遺失或重灌時「新增身分→貼上救援登入碼＋救援密碼」即可登入回來。忘記救援密碼＝這份救援登入碼失效。",
  settings_backupCodePw: "救援密碼",
  settings_backupCodePw2: "再輸入一次救援密碼",
  settings_backupCodeMake: "產生",
  settings_logout: "登出",
  settings_logoutHint: "結束目前登入、回到登入畫面。身分與資料仍留在這台裝置，可再次登入（若有本地密碼需再解鎖）。",
  settings_logoutConfirm: "要登出嗎？身分與資料會保留在本機，可再次登入。",
  settings_dangerZone: "危險區域",
  settings_removeIdentity: "移除此身分",
  settings_removeIdentityHint: "從這台裝置刪除目前身分的私鑰與所有本機資料（訊息、聯絡人）。其他身分不受影響。若沒有救援登入碼或備份，此身分將永遠無法登入。",
  settings_removeIdentityConfirm: "確定要從這台裝置移除目前身分？私鑰與所有本機資料會被永久刪除、無法復原。若沒有救援登入碼，將無法再登入此身分。",
  settings_wipeDeviceHint: "刪除這台裝置上「所有」身分的私鑰與全部本機資料，回到全新狀態。此動作無法復原——請先確認你已有救援登入碼。",
  wipe_device: "清空裝置",
  aux_tabCalendar: "行程",
  date_chipHint: "建立行程（不會自動加入）",
  date_barHint: "點擊建立行程；Enter 照常送出訊息",
  cal_new: "新增行程",
  cal_viewMonth: "月",
  cal_viewWeek: "週",
  cal_viewDay: "日",
  cal_viewList: "清單",
  cal_today: "今天",
  cal_prev: "上一個",
  cal_next: "下一個",
  cal_title: "行程名稱",
  cal_start: "開始",
  cal_end: "結束（可選）",
  cal_location: "地點（可選）",
  cal_desc: "備註（可選）",
  cal_save: "送出",
  cal_dismiss: "取消",
  cal_edit: "編輯",
  cal_cancelEvent: "取消行程",
  cal_cancelConfirm: "取消「{title}」？所有參與者的行程都會移除，此動作不可復原。",
  cal_rsvpYes: "參加",
  cal_rsvpMaybe: "也許",
  cal_rsvpNo: "不參加",
  cal_none: "這個對話還沒有行程。",
  cal_by: "由 {name} 發起",
  cal_byYou: "由你發起",
  cal_durLabel: "長度",
  cal_durNone: "不設",
  cal_dur1h: "1 小時",
  cal_dur2h: "2 小時",
  cal_durAllDay: "整天",
  cal_adjHint: "點上下調整時間",
  cal_remindLabel: "提醒",
  cal_remindOff: "關",
  cal_remindNow: "準時",
  cal_remind5m: "5 分前",
  cal_remind15m: "15 分前",
  cal_remind1h: "1 小時前",
  cal_remind1d: "1 天前",
  cal_remindHint: "提醒只在這台裝置上，不會通知其他參與者。",
  cal_reminderBody: "{when} 開始",
  sponsor_title: "贊助此節點",
  sponsor_who: "{relay} 由其營運者自費提供。以下連結由該節點自報，非官方背書。",
  sponsor_note: "完全自願。點擊只會用瀏覽器或錢包開啟外部連結——本 App 不經手金流，也永不自動付款。",
  sponsor_dismiss: "不再顯示",
  vanish_title: "清除我在中繼站上的資料",
  vanish_hint:
    "中繼站暫存的離線留言預設 7 天後自動消失。你也可以現在就要求它們立刻刪除——包含寄給你但你還沒收到的訊息、你的加密雲端備份。**本機的對話不受影響**（那本來就只在你的裝置上）。",
  vanish_action: "要求中繼站清除",
  vanish_confirm:
    "要求所有已連線的中繼站刪除你的資料？還沒收到的離線留言會一併消失且無法救回，你的加密雲端備份也會被刪除（若已開啟）。此動作不可復原。",
  vanish_sent: "已送出清除請求給 {n} 座中繼站。刪除在對方機器上執行，我們無法代它們保證結果。",
  wipe_confirmWord: "CLEAR",
  wipe_confirm: "此動作會永久刪除這台裝置上的所有身分、私鑰與訊息，且無法復原。若你沒有救援登入碼，這些身分將永遠消失。\n\n確定要清空，請輸入 {word}：",
  wipe_mismatch: "輸入不符，已取消清空。",
  mobilePassword_changed: "密碼已更新",
  identities_title: "身分",
  identities_add: "新增身分",
  identities_active: "使用中",
  settingsTab_appearance: "外觀",
  settingsTab_identity: "身分與安全",
  settingsTab_relay: "連線與備份",
  settingsTab_privacy: "隱私與通知",
  settingsTab_advanced: "進階",
  settingsTab_about: "關於",
  settings_aboutVersion: "版本",
  settings_aboutWhatsNew: "本版更新內容",
  settings_updateAvailable: "有新版可更新：{version}",
  settings_updateDownload: "前往下載",
  settings_updateCheck: "自動檢查更新",
  settings_updateCheckHint: "僅查詢版本號、不送任何資料；可關閉。",
  dialog_titleConfirm: "確認",
  dialog_titleAlert: "提示",
  dialog_titlePrompt: "輸入",
  dialog_confirm: "確定",
  dialog_cancel: "取消",
  dialog_ok: "好",
  hiddenId_prompt: "輸入隱藏身分的本地密碼",
  hiddenId_fail: "密碼不符任何隱藏身分",
  close_title: "關閉 Cinderous",
  close_message: "程式會縮到系統匣繼續在背景執行（仍會收到訊息）。要直接結束程式嗎？",
  close_quit: "直接結束",
  close_tray: "縮到系統匣",
  backup_copy: "複製救援登入碼",
  backup_wrong: "救援密碼錯誤或救援登入碼格式不符",
  settings_cloud: "多裝置狀態同步（加密）",
  settings_noSystemBackup:
    "本 App 不參與 Android 系統備份，資料不會被上傳到 Google，換新機時系統也不會自動搬過去。要換裝置請用上面的「搬到新裝置」或加密雲端備份。",
  settings_cloudHint: "把加密的狀態存到你的中繼站，讓你的多台裝置自動同步聯絡人／群組／封鎖（＋近期訊息）。中繼站只見密文；由你的身分私鑰保護（本地密碼只保護這台裝置）。30 天未上線自動過期。",
  settings_cloudOff: "關閉（不同步）",
  settings_cloudBasic: "基本：聯絡人、群組、封鎖清單、設定",
  settings_cloudFull: "完整：基本＋近期訊息",
  settings_cloudOffConfirm: "關閉多裝置狀態同步？中繼站上此裝置的狀態將立即刪除，其他裝置將無法自動同步。",
  settings_cloudBackupNow: "立即同步",
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
  file_unavailableHint: "暫時無法傳檔——尚未與對方建立直連，此中繼也未提供檔案暫存。對方上線並建立直連後即可傳送（文字訊息不受影響）。",
  file_download: "下載",
  file_sending: "傳送中…",
  file_saved: "已儲存於",
  file_onOtherDevice: "檔案在你另一台裝置",
  file_notSaved: "已接收（未儲存）",
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
  emoji_manifestTooLarge: "這則訊息的自訂 emoji 太大，請減少數量或換小一點的圖",
  emoji_tab: "自訂 emoji",
  emoji_import: "匯入 emoji（指定短碼）",
  emoji_shortcodePrompt: "為這顆 emoji 取一個短碼（之後打 :短碼: 使用）",
  emoji_empty: "還沒有自訂 emoji。按＋匯入圖片並指定短碼。",
  emoji_insert: "插入 {code}",
  emoji_hint: "↵/Tab 插入 · ↑↓ 選擇 · Esc 關閉",
  emoji_importPack: "批次匯入（多檔，檔名＝短碼）",
  emoji_packImported: "已匯入 {added} 顆，略過 {skipped} 顆",
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
  slash_hint: "↵/Tab 執行 · ↑↓ 選擇 · Esc 關閉",
  settings_composer: "輸入行為",
  settings_enterToSend: "按 Enter 送出訊息",
  settings_enterToSendHint: "開啟：Enter 送出、Shift+Enter 換行。關閉：Enter 換行、Ctrl/⌘+Enter 送出。",
  mention_hint: "Tab/Enter 選取・↑↓ 選擇・Esc 關閉",
  mention_you: "提及了你",
  thread_title: "討論串",
  thread_empty: "尚無回覆，開始討論吧",
  thread_reply: "回覆討論串…",
  thread_open: "在討論串回覆",
  thread_alsoMain: "同時傳到主對話",
  thread_alsoMainBadge: "同時顯示於主對話的討論串回覆（點擊開啟討論串）",
  convo_copy: "複製文字",
  convo_copied: "已複製",
  unsend_confirmTitle: "收回訊息",
  unsend_confirmBody: "確定要收回這則訊息嗎？雙方都將看不到內容。",
  unsend_traceless: "無痕收回（不留下「訊息已收回」痕跡）",
  unsend_tracelessHint: "勾選後訊息將直接消失；未勾選則保留「訊息已收回」佔位。舊版客戶端仍可能顯示佔位。",
  thread_replies: "{count} 則回覆",
  reply_label: "回覆",
  reply_cancel: "取消回覆",
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
  urlrisk_knownMalicious: "已知惡意網站（威脅情報命中）",
  urlrisk_unparsable: "網址格式異常",
  threat_sourceCustom: "我的封鎖清單",
  threatMask_label: "已封鎖的惡意連結",
  threatMask_bySource: "來源：{sources}",
  threatMask_reveal: "顯示",
  threatSend_confirm: "訊息包含已知惡意連結（{sources}）。仍要送出嗎？",
  threatSend_blocked: "嚴格模式已阻止送出：訊息包含已知惡意連結（{sources}）。",
  settings_threatTitle: "威脅情報防護",
  settings_threatEnable: "封鎖已知惡意連結",
  settings_threatEnableHint: "以開源清單（URLhaus、StevenBlack）於本機比對——網址絕不外送、可自訂、可關閉。",
  settings_threatSendWarn: "送出含惡意連結時警示",
  settings_threatStrict: "嚴格模式（遮罩不可展開、阻止送出）",
  settings_threatCustom: "自訂封鎖網域（每行一個）",
  settings_threatCustomApply: "套用",
  settings_privacy: "隱私",
  settings_cleanOnPaste: "貼上時自動清除網址追蹤參數（含 redirect 拆殼）",
  settings_autoAcquireAssets: "收到別人的自訂 emoji／貼圖時自動收藏進我的庫",
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
  qr_scan: "掃描 QR",
  qr_scanHint: "把對方的 QR 對準框內",
  qr_scanFailed: "開不了相機（可能是未授權相機權限）",
  qr_scanNotNpub: "掃到的內容不是 npub",
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
  call_camera_off: "停止視訊",
  call_camera_on: "恢復視訊",
  call_toVideo: "開啟我的視訊",
  call_toAudio: "改為純語音",
  call_remoteAudioOnly: "對方未開啟視訊",
  call_quality: "畫質",
  call_quality_low: "省流量",
  call_quality_medium: "標準",
  call_quality_high: "高畫質",
  settings_videoQuality: "視訊通話畫質",
  settings_videoQualityHint:
    "省流量約 180 MB/小時、標準約 585 MB/小時、高畫質約 1.4 GB/小時。通話中可隨時調整，這裡設的是下一通的起點。",
  call_failed_unreachable: "通話接不通——限制網路（對稱 NAT／嚴格防火牆）下無法建立直連。可改用 Wi-Fi 或其他網路再撥；文字與檔案不受影響。",
  call_failed_lost: "通話中斷——連線中途斷開（可能網路不穩）。可再撥一次。",
  group_create: "建立群組",
  group_name: "群組名稱",
  group_members: "選擇成員",
  group_confirm: "建立",
  group_section: "群組",
  group_membersCount: "{count} 位成員",
  group_leave: "離開群組",
  group_remove: "移除",
  settings_status: "上線狀態",
  remember_label: "記住我（本地密碼）",
  remember_placeholder: "留空＝不記住",
  remember_hint: "設密碼後，私鑰會以 Argon2id 加密存在這台裝置；沒有密碼就打不開。忘記密碼無法救回——改用 nsec 重新登入即可。",
  remember_forget: "忘記這個身分",
  pairExport_title: "搬到新裝置",
  pairExport_hint: "把這台裝置的全部資料（含私鑰）一次搬到新裝置。全程 P2P 加密，不經中繼儲存。",
  pairExport_start: "開始配對",
  pairExport_offerHint: "把這串配對碼貼到新裝置：",
  pairExport_waiting: "等待新裝置連上…",
  pairExport_sasWarn: "務必與新裝置上顯示的驗證碼逐字比對。不相符代表有人在中間——請立刻拒絕。",
  pairExport_sasMatch: "驗證碼相符，送出資料",
  pairExport_sasMismatch: "不相符，中止",
  pairExport_sending: "傳送中…",
  pairExport_done: "搬家完成",
  pairExport_reset: "重新開始",
  pairExport_needRelay: "需先以真實中繼登入才能搬家",
  pair_sasLabel: "驗證碼（SAS）",
  copy: "複製",
  copied: "已複製",
  group_labelAdd: "＋ 標籤",
  group_labelPlaceholder: "標籤名稱",
  group_labelRemove: "移除標籤 {label}",
  group_pin: "置頂",
  group_unpin: "取消置頂",
  group_filterAll: "全部",
  sort_label: "排序",
  sort_byStatus: "依狀態",
  sort_byGroup: "依分組",
  sort_byName: "依名稱",
  contactGroup_ungrouped: "未分組",
  contactGroup_all: "全部",
  nav_back: "返回",
};

const en: Messages = {
  appName: "Cinderous",
  brand_visitSite: "Visit website",
  signIn_title: "Sign in to Cinderous",
  signIn_hint: "A decentralized, end-to-end encrypted messenger. Just enter a display name to start (your identity is a secp256k1 key generated on this device).",
  signIn_password: "Local password",
  signIn_passwordAgain: "Repeat password",
  signIn_passwordWhy:
    "The web version has no system keychain — your private key lives only in this tab. Set a local password to keep it encrypted, or you'll lose this identity the moment you refresh the page. The password never leaves your device and cannot be recovered (but you can sign back in with a backed-up nsec).",
  signIn_passwordRequired: "Set a local password (without it, a refresh loses your identity)",
  signIn_passwordMismatch: "The two passwords don't match",
  signIn_useNsec: "Already have an identity? Sign in with nsec",
  signIn_useNsecHint: "Paste your backed-up nsec (copy it from Settings → Identity backup). You'll be back on the same identity, and recent messages still held by the relay will come back too.\n\n⚠️ Older history won't — that needs a transfer from your old device, or multi-device sync turned on first. And if you had forward secrecy on, messages encrypted to a subkey also need that subkey, which the nsec does not contain.",
  signIn_useNsecButton: "Sign in with nsec",
  signIn_nsec: "nsec private key",
  signIn_nsecInvalid: "Invalid nsec, or it isn't the key for this identity",
  signIn_relayUsing: "Will connect to {host}",
  signIn_relayDemo: "Not connected to a relay",
  signIn_relayProbing: "Picking a relay…",
  signIn_relayChange: "Use a different relay",
  signIn_relayHide: "Use the default relay",
  signIn_displayName: "Display name",
  signIn_relayUrl: "Relay URL",
  signIn_button: "Sign in",
  signIn_enterExisting: "Sign in to existing identity",
  signIn_enterExistingHint: "An identity with this name already exists on this device; you'll sign in to \"{name}\" (you'll be asked to unlock if it has a local password).",
  signIn_createHint: "This name is new — a new identity will be created (key generated on your device).",
  signIn_createButton: "Create new identity",
  signIn_ambiguousName: "Multiple identities on this device share this name (likely old data), so it can't be resolved automatically. Use \"Sign in with nsec\" instead, or rename them later in Settings.",
  mobileSignIn_title: "Sign in to Cinderous",
  mobileSignIn_backToCreate: "← Create a new identity instead",
  mobileSignIn_nameLabel: "Display name",
  mobileSignIn_nsecLabel: "Private key (nsec)",
  mobileSignIn_nsecPlaceholder: "Paste nsec1…",
  mobileSignIn_derived: "Identity",
  mobileSignIn_button: "Sign in",
  mobileSignIn_errName: "Enter a display name",
  mobileSignIn_errNsec: "Invalid nsec key",
  mobileSignIn_nameTaken: "An identity with this name already exists on this device; pick another.",
  mobileSignIn_hint: "Decentralized, end-to-end encrypted messaging. Just enter a display name to start — your identity is a key generated on this device; no phone number or email required.",
  mobileSignIn_toPair: "Import from old device instead",
  mobilePair_title: "Import from old device",
  mobilePair_codeLabel: "Pairing code",
  mobilePair_codePlaceholder: "Paste the code shown on your old device",
  mobilePair_connect: "Connect",
  mobilePair_relayVia: "Meet via relay",
  mobilePair_sasHint: "Confirm both devices show the same number",
  mobilePair_waiting: "Waiting for the old device…",
  mobilePair_errCode: "Invalid or expired pairing code",
  mobilePair_errRejected: "The other device rejected the pairing (the numbers didn't match — a possible security risk). Generate a new code on the old device and retry.",
  mobilePair_errNoIdentity: "Pairing data has no identity",
  mobilePair_toNsec: "Use secret key sign-in",
  mobileChats_title: "Chats",
  mobileChats_empty: "No conversations yet. Add a friend or create a group and it'll show up here.",
  mobileChats_search: "Search (name or messages)",
  mobileChats_you: "You: ",
  mobileConvo_input: "Message…",
  mobileConvo_send: "Send",
  mobileConvo_back: "Back",
  mobileChats_add: "Add friend",
  mobileChats_addPlaceholder: "Paste a friend's npub…",
  mobileChats_addBtn: "Add",
  mobileChats_myNpub: "Your npub (share it so friends can add you)",
  mobileTab_chats: "Chats",
  mobileTab_contacts: "Contacts",
  mobileTab_settings: "Settings",
  mobileSettings_appearance: "Appearance",
  mobileSettings_theme: "Theme",
  mobileSettings_light: "Light",
  mobileSettings_dark: "Dark",
  mobileSettings_accent: "Accent",
  mobileSettings_language: "Language",
  mobileSettings_relay: "Relay",
  mobileSettings_relayDemo: "Not connected to a relay",
  mobileSettings_logout: "Log out",
  mobileContacts_empty: "No contacts yet. On the Chats tab tap “+” to add a friend by npub.",
  addId_title: "Add identity",
  addId_close: "Close",
  addId_relay: "Relay URL (wss://…)",
  addId_enterprise: "Work identity (locked to this relay, no roaming)",
  addId_admin: "Admin npub (optional — auto-syncs the org address book)",
  addId_import: "Import nsec or rescue login code (blank = new identity)",
  addId_error: "Wrong rescue password or invalid secret key",
  addId_nameTaken: "An identity with this name already exists on this device; pick another (the name selects which identity to sign in to).",
  addId_submit: "Create & switch",
  addId_busy: "Restoring…",
  addId_modePersonal: "Personal identity",
  addId_modePersonalHint: "A regular account; you manage your own contacts.",
  addId_modeOrg: "Organization member",
  addId_modeOrgHint: "A work identity that subscribes to an org admin's published roster (contacts & policy). Admin npub optional.",
  addId_modeOwner: "Organization owner (create a roster)",
  addId_modeOwnerHint: "A regular identity with roster management: opens the org roster right after creation — copy the invite code for your staff.",
  addId_changeMode: "← Change type",
  addId_invite: "Paste an onboarding invite code (fills relay & admin automatically)",
  addId_inviteApplied: "Invite applied: after creation your join request is sent automatically; once approved the whole org address book syncs.",
  roster_inviteHint: "Onboarding invite code (relay + your identity + approval token): staff paste it at sign-in or in the “Organization member” form to join automatically",
  roster_inviteCopy: "Copy",
  roster_escrow: "Create as a company account (employer holds a key backup for offboarding; the employee consents explicitly on creation)",
  signIn_joinEscrow: "⚠️ This is a company account: your sign-in key is encrypted and escrowed to your employer (like company email admin rights), so they can take it over or revoke it when you leave. Use a personal identity for private contacts.",
  settings_offboard: "Offboarded accounts",
  settings_offboardHint: "Members removed from the roster (offboarded) whose key was escrowed as a company account. Take over = sign in with their key locally to view what the relay still holds; or delete the escrow.",
  offboard_takeover: "Take over",
  offboard_delete: "Delete escrow",
  offboard_takeoverConfirm: "Sign in locally with this offboarded employee's key to view their history? Local viewing only — you won't broadcast as online (auto-invisible).",
  offboard_deleteConfirm: "Delete this offboarded employee's escrowed key? You will no longer be able to take over their account or view their history, and this cannot be undone.",
  roster_welcomeLabel: "Welcome message / ground rules (optional: shown once to new members, always available under Settings → Organization)",
  roster_workHoursLabel: "Scheduled work hours (optional: company notifications auto-mute off-hours on members' devices; leave blank to unset)",
  roster_ttlLabel: "Offline message retention in days (optional, 1–365; blank = default 7. Requires a self-hosted relay with MAX_TTL_DAYS raised — the relay's cap always wins)",
  roster_relayFilesLabel: "Relay file staging limit in MB (optional, 1–16; blank = off, P2P only. Files up to the limit reach offline members; requires MAX_FILE_MB on your self-hosted relay)",
  roster_inviteLabel: "Onboarding invite code",
  roster_orgName: "Organization name",
  roster_membersLabel: "Members",
  roster_membersHint: "One per line: npub name (admin prefilled; remove a member = delete their line and republish)",
  roster_parseError: "Can't parse: ",
  roster_needMember: "At least one member is required",
  roster_publishFailed: "Publish failed",
  roster_published: "Roster published and provisioned to the relay.",
  roster_publish: "Publish roster",
  settings_orgRoster: "Organization roster",
  settings_createCompany: "Create a company (owner)",
  settings_vaultDesktopOnly: "🖥 Receiving vault deposits to disk is desktop-only (needs a filesystem). Employees can deposit from mobile, but owners should receive/file on desktop.",
  orgInfo_title: "Organization",
  orgInfo_hours: "Work hours: {start}–{end}",
  orgInfo_muteNote: "Outside work hours, notifications from company members and org groups are muted automatically (unread still accrues).",
  orgPolicy_title: "Company policy",
  orgPolicy_disabledHead: "Disabled features",
  orgPolicy_rulesHead: "Rules in effect",
  orgPolicy_files: "File transfer (including camera photos)",
  orgPolicy_calls: "Starting voice/video calls (you can still answer)",
  orgPolicy_stickers: "Stickers and custom emoji (you still see ones others send)",
  orgPolicy_cloudBackup: "Encrypted cloud backup",
  orgPolicy_forceTurn: "Calls and files go through a TURN relay only (no local IP exposure)",
  orgPolicy_ttlDays: "Messages are kept for {days} days",
  orgPolicy_relayFilesMb: "Org files may be staged on the relay, up to {mb} MB each",
  orgPolicy_hint: "Set by your company's signed roster; this cannot be turned off locally.",
  settings_orgTitle: "Job title",
  settings_orgTitleHint: "Self-declared title (up to 24 chars), broadcast to all contacts of this identity — on a work identity that means every colleague. Apply empty to remove.",
  settings_orgTitleUpdated: "Title updated and broadcast.",
  convo_offHours: "Outside work hours ({start}–{end}) — their notifications are muted, so they may not see this right away. The message is still delivered.",
  slot_deposit: "Save to company vault",
  settings_slot: "Company vault",
  slot_empty: "Nothing queued for the vault.",
  slot_retry: "Retry failed items",
  slot_remove: "Remove",
  slot_pending: "Queued",
  slot_sending: "Transferring",
  slot_done: "Stored",
  slot_failed: "Failed",
  settings_slotDir: "Vault folder",
  settings_slotDirHint: "Files deposited by staff are silently written here (per-employee folders + an index.jsonl).",
  settings_slotDirPick: "Choose folder…",
  settings_slotDirDefault: "(unset: CinderSlot inside the app data folder)",
  signIn_joinHint: "Onboarding invite detected: an organization member identity will be created on {host} and a join request sent to the admin automatically.",
  signIn_joinName: "Your display name (visible to colleagues)",
  signIn_joinButton: "Join organization",
  idbar_addIdentity: "Add identity",
  idbar_unlockHidden: "Unlock hidden identity",
  idbar_roster: "Org roster (admin)",
  idbar_switch: "Switch identity",
  contact_myId: "My ID",
  contact_addPlaceholder: "Paste a buddy's npub… (optionally @wss://relay)",
  contact_add: "Add",
  contact_copy: "Copy",
  contact_copied: "Copied",
  contact_addSelf: "Can't add your own identity (it would link your personas to the relay)",
  contact_addInvalid: "Invalid npub",
  contact_remove: "Delete",
  contact_block: "Block",
  request_section: "Message requests",
  request_hint: "These people aren't in your contacts. Until you accept, they can't notify you, nudge you, or see when you're online.",
  request_accept: "Accept",
  request_decline: "Delete",
  request_preview: "Read messages (they won't be told)",
  request_clearAll: "Delete all",
  contact_unblock: "Unblock",
  contact_removeConfirm: "Delete {name} and clear the conversation history?",
  contact_blockConfirm: "Block {name}? They'll be removed and their future messages ignored.",
  group_blocked: "Blocked ({count})",
  status_online: "Online",
  status_away: "Away",
  status_busy: "Busy",
  status_offline: "Appear offline",
  msgStatus_sending: "Sending",
  msgStatus_failed: "Failed to send",
  msgStatus_sent: "Sent",
  msgStatus_delivered: "Delivered",
  msgStatus_read: "Read",
  readBy_list: "Read by {names}",
  readBy_count: "Read {count}/{total}",
  calc_insertExpr: "Insert expression and answer",
  calc_insertResult: "Insert answer only",
  calc_insertHint: "Click to append “= answer” to your message",
  convo_attach: "Send a file",
  convo_photo: "Take a photo",
  fg_title: "Cinderous",
  fg_text: "Staying connected so messages arrive",
  settings_foreground: "Stay connected in background",
  relayCheck_ok: "✓ Relay behaves correctly",
  relayCheck_warn: "⚠ Privacy concerns with this relay",
  relayCheck_down: "✕ Relay not responding",
  relayCheck_noAuth:
    "No authentication required — anyone can see when you receive messages (contents stay encrypted)",
  relayCheck_ephemeral: "May be storing ephemeral events that should only be relayed",
  relayCheck_expired: "Ignores expiration — your ciphertext may be kept indefinitely",
  settings_foregroundHint:
    "Keeps the connection alive with an ongoing notification so messages arrive. No third-party push service is used — nobody learns when you receive messages. The cost is one persistent notification. With this off, messages may not arrive while the app is backgrounded.",
  image_originalMissing: "Original not found — the file may have been moved or deleted.",
  image_relocate: "Locate the file",
  image_thumbOnly: "Only the thumbnail can be shown here (browsers can't read local originals).",
  share_copyImage: "Copy image",
  share_copyPath: "Copy path",
  share_copied: "Copied",
  share_share: "Share",
  share_failed: "Not supported here",
  settings_readReceipts: "Read receipts",
  settings_readReceiptsHint: "When on, others are told when you read their messages; off means you neither send yours nor see theirs (reciprocal).",
  settings_retention: "Message retention",
  settings_retentionHint: "How many messages stay in the fast cache per conversation; older ones move to the archive (still readable in History), not deleted. Default is unlimited. On the web, setting a limit moves old messages out of localStorage to ease the quota.",
  retention_unlimited: "Unlimited",
  retention_custom: "Custom",
  settings_storageFull: "⚠ Local storage is full; new messages may not be saved. Consider setting a retention limit, or use the desktop app.",
  settings_export: "Export records",
  settings_exportHint: "Export conversation records to a plaintext file (backup / archive).",
  export_title: "Export conversations",
  export_warning: "⚠ Exports are plaintext, outside the device's encryption. Keep them safe and do not share.",
  export_scope: "Scope",
  export_selectAll: "Select all",
  export_format: "Format",
  export_run: "Export",
  export_this: "Export this conversation",
  history_title: "History",
  history_search: "Search archived messages…",
  history_scanning: "Scanning chunk {done}/{total} (decrypt-and-discard, no index kept)",
  history_searchClear: "Clear",
  history_open: "History (archived messages)",
  history_older: "Load older",
  history_loading: "Loading…",
  history_empty: "No archived messages",
  msg_unsent: "(unsent)",
  msg_unsend: "Unsend",
  block: "Block",
  unblock: "Unblock",
  blocked_title: "Blocked",
  group_new: "New group",
  group_namePlaceholder: "Group name (optional)",
  export_empty: "No conversations to export.",
  settings_invisible: "Invisible",
  settings_invisibleHint: "When on, you vanish from the relay entirely — you neither broadcast your own presence nor ask the relay who's online. So your contact list never leaves this device (the strongest metadata privacy). Trade-off: you can't see contacts' online dots either. Messaging works normally.",
  fs_title: "Forward secrecy (experimental)",
  fs_hint: "Once enabled, the **content you send** — text, stickers, custom emoji, file names, shared events and reactions, in groups too — is encrypted to an expiring subkey; it rotates automatically every 7 days, and once an old key expires, recorded ciphertext stays unreadable even if your identity key is later stolen. **Not covered: unsending, group membership changes, read receipts, typing/nudges, and calls.** Local history and your identity are unaffected.",
  group_tooManyMembers: "Groups are limited to {max} members (including you). Please remove some before creating.",
  pair_largeBundleWarn: "You have a fair amount of data (about {mb} MB), so this will take a while.\n\n⚠️ This transfer **cannot be resumed if it is interrupted** — if the connection drops you have to start over, including scanning the code and comparing the safety number again.\n\nSuggestion: keep both devices together, screens on, and plugged in before you start.",
  fs_unaudited: "⚠️ Not yet externally audited. This feature is complete and passes our own tests, but no independent third party has reviewed it. Crypto bugs don't break anything visibly — they just fail to protect, with no symptoms. Until the audit is done, please don't treat this as a dependable guarantee.",
  fs_enableConfirm: "Enable forward secrecy (experimental)?\n\n・This feature has **not been externally audited**.\n・Our own tests all pass, but that only proves the cases we thought of — it doesn't prove there are no holes.\n・Treat it as \"better than nothing\", not as a dependable guarantee.\n・You can turn it off any time; local history and your identity are unaffected.",
  fs_enable: "Enable forward secrecy",
  fs_enabled: "Forward secrecy is on",
  fs_rotate: "Rotate encryption key now",
  fs_rotateConfirm: "Rotate your encryption key now?\n\nAfter rotating:\n• Contacts who haven't learned your new key yet, or who are offline, may not receive in-flight messages sent to your old key after the retention window (~7 days).\n• Your other devices need to come online to sync the new key.\n• Your written-down backup code still restores your identity and local history (it never contains the encryption subkey).",
  fs_autoRotate: "Your key rotates automatically every 7 days. The button below is for \"I think I'm compromised right now\".",
  fs_undecryptable: "⚠️ This device could not decrypt {count} received message(s) (last: {when}). It may be that the sender used a key you have since rotated away, or the data was simply corrupt — the two cannot be told apart. Undecryptable messages are not shown, and there is no way to tell who sent them. If this keeps happening, ask your contacts to update and stay online.",
  settings_groupInvite: "Let anyone add me to groups",
  settings_groupInviteHint: "Off (default): only your contacts can add you to a group; an invite from a stranger waits in Message requests and the group appears once you accept that person. On: anyone who knows your npub can add you directly. Blocked people are always refused, regardless of this setting.",
  groupInvite_held: "{name} wants to add you to \"{group}\". The group will appear once you accept them in Message requests.",
  groupFs_summary: "{covered} of {total} members receive forward-secret messages.",
  groupFs_known: "Encryption subkey known",
  groupFs_unknown: "Unknown",
  groupFs_lost: "Previously known, now missing",
  devices_title: "My devices",
  devices_thisOne: "this one",
  devices_firstSeen: "first seen {when}",
  devices_limit: "⚠️ This list only shows devices that **write** (ones with cloud backup on, or that you paired with). Anyone holding your identity key can read your messages silently without leaving a trace — **seeing only one device does not mean nobody is reading them**.",
  devices_new: "⚠️ A device you have not seen before appeared ({id}). If you did not add it, rotate your identity key now.",
  devices_source_local: "this device",
  devices_source_snapshot: "cloud backup",
  devices_source_pairing: "device pairing",
  devices_notInDirectory: "⚠ not in device directory",
  devices_stale: "(not seen in a long time)",
  devices_forget: "Remove from list",
  devices_forgetConfirm: "Remove this device from the list?\n\nThis only clears a record on this computer — it **revokes nothing and touches no keys**.\nIf it shows up again, it will simply be recorded again.",
  devices_conflict: "⚠️ Two conflicting device directories were seen (version {v}). Someone signed another one with your identity key — **your key may have leaked**. Neither was adopted (picking a side would decide it for them). Consider rotating your identity key.",
  devices_revUnknown: "The device directory is still being set up; try removing again shortly.",
  devices_revDualTrack: "⚠️ Removing a device will **not take effect yet**: device {ids} still uses the old key-sync path, so a removed device would still receive new keys. Update that device first.",
  devices_revActive: "Once removed, a device can no longer read new messages (history it already has is unaffected).",
  devices_remove: "Remove this device",
  devices_removeConfirm: "Remove this device?\n\n• It will no longer be able to read **new** messages.\n• History it already received is **unaffected** — you cannot claw that back.\n• During the grace window (~7 days) it can still open in-flight older messages; that is deliberate.\n• If what leaked was your identity key rather than just that device, removal does **not** help — rotate your identity key instead.",
  devices_revoked: "removed",
  devices_conflictLog: "Directory anomalies seen",
  devices_conflictRow: "{when}: received a directory at version {incoming} while this device is already at {mine} (rollback). That can only come from a replay or from someone signing an older version with your identity key. It was not adopted.",
  devices_myCode: "This device's code",
  devices_myCodeHint: "To add this device to your list, paste this code on **another device that is already on the list** and authorize it. The code is not a secret, but do **compare the characters on both screens** — pasting the wrong one authorizes someone else.",
  devices_authorize: "Authorize a device",
  devices_authorizeHint: "Paste the code shown by the new device. Only a device already on the list can authorize — that is what keeps out someone who has your identity key but never touched this device.",
  devices_authorizePlaceholder: "Paste device code",
  devices_authorizeConfirm: "Authorize this device?\n\n• It will be able to read every message you receive from now on.\n• Check that the code matches **exactly** what is shown on that device.\n• You can remove it again at any time.",
  devices_noAuthority: "This device is not on the list yet, so it cannot authorize others. Authorize this one from a device that is already on the list.",
  devices_tierTitle: "Key protection on this device",
  devices_tierPlaintext: "⚠️ **Stored in the clear.** This device's key currently sits unencrypted in browser/app local storage. Anyone who obtains this machine's disk contents (a backup, a wiped-but-not-really old machine, malware) gets the key — and in that case **removing the device does not stop them**. Real protection waits on moving this key into the OS keystore.",
  devices_tierEncrypted: "Stored encrypted, but **the key that wraps it is held in software** (by the browser or the system, with no password of yours involved). So: a script trying to steal the key **cannot take it** — a real improvement over plaintext; but someone who copies all of this device's data and knows what they are doing may still open it. What actually stops a disk copy is a secure element, which this device lacks or does not expose.",
  devices_tierKeystore: "Held in the OS keystore (desktop) or the device secure element (Android). A copied disk cannot open it — but this does **not** mean you are safe if the device itself is compromised: we read the key **out** when we need it rather than asking the chip to sign, so malware running as you can read it too.",
  devices_tierEphemeral: "⚠️ **The keystore could not be opened this session** (for example, the system keyring service is not running). A temporary key is in use and nothing was saved — so **this device will not appear in your device list**, and a restart makes another one. We deliberately do not quietly mint a new long-term key here. Fix the keystore and restart to get the original device identity back.",
  devices_tierWasPlain: "⚠️ This key was **migrated in** from an older plaintext store. A copied disk is useless from now on, but **anyone who backed up the disk before the move may already hold a copy** — deleting the old copy cannot take back what was already taken. If that matters to you, remove this device and pair it again to get a key that never sat in plaintext.",
  fs_disable: "Turn off forward secrecy",
  fs_disableConfirm: "Turn off forward secrecy?\n\n• Messages you send from now on will **no longer** have forward secrecy (same protection as ordinary messages).\n• Messages already sent are unaffected.\n• Your contacts will be told explicitly that you turned it off — this is necessary, otherwise they would keep assuming you still have it on.\n• Local history, identity and backup code are unaffected.\n• You can turn it back on at any time.",
  fs_downgradeWarning: "⚠️ This contact has forward secrecy enabled, but you haven't received their current key yet — this message was encrypted the ordinary way (no forward secrecy). Their key may not be synced yet (it'll update automatically); take note if this persists.",
  fs_unsupportedWarning: "ℹ️ This contact uses an encryption scheme your version doesn't support yet, so this message was encrypted with one you both support. Please update to the latest version. (This is not a security warning — they have not downgraded.)",
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
  sidebar_search: "Search name or messages…",
  sidebar_empty: "No matching contacts or groups",
  sidebar_labelAdd: "Add label",
  deck_pickChat: "Double-click a contact or group on the left to start",
  aux_pickChat: "Open a conversation to see its details",
  aux_tabInfo: "Info",
  aux_tabMembers: "Members",
  aux_tabMedia: "Media",
  aux_tabThreads: "Threads",
  aux_tabNote: "Notes",
  aux_title: "Conversation panels (media / threads / notes / plans)",
  note_placeholder: "Notes… (jot anything; type a calc like 12*8 on the last line to evaluate)",
  note_hint: "Private notes, one per conversation, stored only on this device (never broadcast or synced). Calculations are auto-detected and can be inserted.",
  note_placeholderM: "Notes… (jot anything; stored only on this device)",
  note_hintM: "Private notes, one per conversation, encrypted on this device (never broadcast or synced). For calculations, just type an expression in the composer below.",
  aux_noMedia: "No images in this conversation yet",
  aux_noThreads: "No threads in this conversation yet",
  aux_you: "You",
  aux_admin: "Admin",
  aux_replies: "{count} replies",
  settings_layout: "Layout",
  settings_layoutClassic: "Classic (floating windows)",
  settings_layoutModern: "Three-column",
  settings_layoutHint: "Classic = open several chat windows side by side; three-column = contacts / conversation / assistant (in progress). Stored locally.",
  deck_auxPlaceholder: "Conversation assistant (coming soon)",
  settings_accent: "Theme color",
  settings_accentPrimary: "Primary (bubbles / buttons / links)",
  settings_accent2: "Secondary (title bar / background)",
  settings_accent2Follow: "Follow primary",
  settings_accentCustom: "Custom color",
  settings_accentReset: "Default",
  settings_accentCb: "Color-vision friendly (colorblind-safe)",
  settings_a11y: "Accessibility",
  a11y_contrast: "High contrast",
  a11y_contrastHint: "Boost text and border contrast (WCAG AA); combines with light/dark theme. Follows your system's contrast preference until set.",
  a11y_stateOn: "On",
  a11y_stateOff: "Off",
  a11y_uiScale: "UI size",
  a11y_uiScaleHint: "Scale the whole interface (applies instantly; stored on this device only).",
  settings_accentHint: "Applies instantly, stored locally; auto-brightened in dark theme. Primary recolors the mascot too; secondary drives the title bar and background gradient (blank = follow primary).",
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
  convo_p2pDirect: "Direct",
  convo_p2pNone: "No direct link",
  convo_p2pDirectHint: "Direct peer-to-peer link established — files, calls and typing go P2P (faster, no relay).",
  convo_p2pNoneHint: "No direct link yet; text messages arrive normally, but files and calls may be unavailable.",
  convo_typing: "{name} is typing…",
  alias_set: "Set nickname",
  alias_edit: "Edit nickname",
  alias_prompt: "Set a local nickname for \"{name}\" (only you see it; they aren't notified; empty to clear):",
  alias_placeholder: "Local nickname",
  alias_showBroadcast: "Click to see the name they broadcast",
  alias_showAlias: "Click to switch back to your nickname",
  convo_emojiTitle: "Emoticons",
  convo_nudge: "Nudge",
  convo_nudgeTitle: "Nudge their window",
  convo_composerPlaceholder: "Type a message… (Enter to send, Shift+Enter for newline)",
  convo_send: "Send",
  convo_close: "Close",
  convo_resize: "Drag to resize",
  avatar_change: "Change avatar",
  avatar_remove: "Remove avatar",
  avatar_fromUrl: "Set from URL…",
  avatar_urlPrompt: "Image URL (downloaded and resized locally — the URL is never sent to your contacts)",
  avatar_urlError: "Could not load an image from that URL (cross-origin blocked, not an image, or offline). Download it and upload instead.",
  avatar_syncHint: "Synced to your contacts",
  personalize_quota: "Image too large for local storage — please pick a smaller one.",
  chatbg_title: "Chat background",
  chatbg_upload: "Upload image",
  chatbg_clear: "Clear background",
  convo_react: "React",
  convo_unsend: "Unsend",
  convo_showFull: "Show full message",
  convo_msgDetail: "Message",
  convo_unsent: "Message unsent",
  convo_loadEarlier: "Load {count} earlier messages",
  convo_search: "Search messages",
  convo_searchHint: "Search this conversation…",
  convo_searchNone: "No matches",
  convo_searchPrev: "Previous (older)",
  convo_searchNext: "Next (newer)",
  roster_search: "Search (name or messages)",
  convo_timerTitle: "Disappearing message",
  convo_timerOff: "Timer: off",
  convo_timer1m: "Timer: 1 min",
  convo_timer1h: "Timer: 1 hour",
  convo_timer1d: "Timer: 1 day",
  convo_expired: "Message expired",
  lang_label: "Language",
  theme_toggle: "Toggle dark mode",
  nowPlaying_placeholder: "Now playing… (share your music)",
  npAuto_toggle: "Click to toggle: auto-detect playing music",
  npAuto_detecting: "Detecting… (nothing playing)",
  settings_open: "Settings",
  settings_title: "Settings",
  settings_relayUrl: "Relay",
  settings_relayDemo: "No relay set",
  settings_identityBackup: "Identity backup",
  settings_displayName: "Display name",
  settings_nameApply: "Update",
  settings_nameUpdated: "Name updated",
  settings_nameTaken: "An identity with this name already exists on this device; pick another.",
  settings_identityWarning: "This is your secret key (nsec) — it IS your account. Anyone who gets it can impersonate you. Never share or paste it anywhere; keep it safe offline.",
  settings_revealKey: "Reveal secret key (nsec)",
  settings_hideKey: "Hide secret key",
  settings_copyKey: "Copy",
  settings_copied: "Copied",
  settings_notifications: "Desktop notifications",
  settings_notificationsHint: "Notify on new messages when the window isn't focused.",
  settings_notifySound: "Notification sound",
  settings_notifyChime: "Sound effect",
  sound_perContact: "Notification sound for this contact",
  sound_useDefault: "Follow global default",
  sound_preview: "Preview",
  chime_classic: "Ding-dong (classic)",
  chime_descend: "Dong-ding (descending)",
  chime_triple: "Triple tone",
  chime_bell: "Bell",
  chime_drop: "Water drop",
  chime_knock: "Knock knock",
  titlebar_minimize: "Minimize",
  titlebar_maximize: "Maximize / restore",
  titlebar_close: "Close",
  settings_titlebar: "Window frame",
  titlebar_dragHint: "Drag the buttons to either side of the title bar to arrange position and order.",
  titlebar_autoHide: "Hide the whole title bar until the mouse reaches the top edge",
  titlebarStyle_flat: "Flat",
  titlebarStyle_rounded: "Rounded",
  titlebarStyle_mac: "Traffic lights",
  titlebarStyle_compact: "Compact",
  settings_notifyHidePreview: "Hide message preview (show only \"New message\")",
  notify_newMessage: "New message",
  notify_nudge: "Nudged you",
  notify_call: "Incoming call",
  settings_notifyEvents: "Which events to notify",
  notify_event_dm: "Direct messages",
  notify_event_group: "Group messages",
  notify_event_mention: "When @mentioned (even if group off)",
  notify_event_nudge: "Nudge",
  notify_event_call: "Incoming call",
  notify_event_request: "Stranger message requests",
  convo_mute: "Mute this conversation",
  convo_unmute: "Unmute",
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
  settings_security: "Security (local password)",
  settings_passwordOn: "Local password is on: your private key and data key are wrapped with your password — nothing opens without it.",
  settings_passwordOffHint: "Recommended on shared computers: a password-derived key (Argon2id) wraps your private key and data key, so others with access to this machine can't open them. Does not protect against running malware.",
  settings_passwordEnable: "Enable local password",
  settings_passwordChange: "Change password",
  settings_passwordDisable: "Disable",
  settings_passwordDisableApply: "Confirm disable",
  settings_passwordDisableBrowser:
    "⚠️ The web version has no system keychain. Disabling the password means forgetting this identity: next time you'll have to paste your nsec back in. Copy it from Identity backup first.",
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
  unlock_forgot: "Forgot password?",
  unlock_switch: "Sign in as someone else",
  rescue_title: "Recover {name}'s data",
  rescue_hint: "Enter your private key (nsec) or rescue login code and set a new password to recover all data on this device. Forgetting the old password is fine — it can't be retrieved; you're setting a brand-new one.",
  rescue_secret: "Private key (nsec1…) or rescue login code",
  rescue_backupPw: "Rescue password",
  rescue_newPw: "Set new password",
  rescue_newPw2: "Repeat new password",
  rescue_submit: "Recover & unlock",
  rescue_busy: "Recovering…",
  rescue_back: "Back",
  rescue_error: "Key/rescue login code doesn't match, or this identity has no rescue data.",
  rescue_resetOk: "Password was reset, but auto-unlock failed. Restart the app and sign in with the new password.",
  settings_backupCode: "Create rescue login code",
  settings_backupCodeHint: "The rescue login code is your rescue-password-encrypted key plus your relay URL — print it or store it anywhere you choose. If you lose or wipe the device: Add identity → paste the code + rescue password to log back in. A forgotten rescue password makes this code unusable.",
  settings_backupCodePw: "Rescue password",
  settings_backupCodePw2: "Repeat rescue password",
  settings_backupCodeMake: "Create",
  settings_logout: "Log out",
  settings_logoutHint: "End the current session and return to the sign-in screen. Your identity and data stay on this device — you can sign back in (unlock again if a local password is set).",
  settings_logoutConfirm: "Log out? Your identity and data stay on this device and you can sign back in.",
  settings_dangerZone: "Danger zone",
  settings_removeIdentity: "Remove this identity",
  settings_removeIdentityHint: "Delete the current identity's private key and all its local data (messages, contacts) from this device. Other identities are unaffected. Without a rescue login code or backup, this identity can never sign in again.",
  settings_removeIdentityConfirm: "Remove the current identity from this device? Its private key and all local data will be permanently deleted and cannot be recovered. Without a rescue login code you won't be able to sign in to this identity again.",
  settings_wipeDeviceHint: "Delete the private keys and all local data of EVERY identity on this device, returning it to a fresh state. This cannot be undone — make sure you have a rescue login code first.",
  wipe_device: "Wipe device",
  aux_tabCalendar: "Plans",
  date_chipHint: "Create a plan (nothing is added automatically)",
  date_barHint: "Click to create a plan \u2014 Enter still sends the message",
  cal_new: "New plan",
  cal_viewMonth: "Month",
  cal_viewWeek: "Week",
  cal_viewDay: "Day",
  cal_viewList: "List",
  cal_today: "Today",
  cal_prev: "Previous",
  cal_next: "Next",
  cal_title: "What's the plan?",
  cal_start: "Starts",
  cal_end: "Ends (optional)",
  cal_location: "Location (optional)",
  cal_desc: "Notes (optional)",
  cal_save: "Send",
  cal_dismiss: "Cancel",
  cal_edit: "Edit",
  cal_cancelEvent: "Cancel plan",
  cal_cancelConfirm: "Cancel \u201c{title}\u201d? It will be removed for everyone, and this cannot be undone.",
  cal_rsvpYes: "Going",
  cal_rsvpMaybe: "Maybe",
  cal_rsvpNo: "Can't make it",
  cal_none: "No plans in this conversation yet.",
  cal_by: "Organized by {name}",
  cal_byYou: "Organized by you",
  cal_durLabel: "Length",
  cal_durNone: "None",
  cal_dur1h: "1 hour",
  cal_dur2h: "2 hours",
  cal_durAllDay: "All day",
  cal_adjHint: "Tap ↑↓ to adjust",
  cal_remindLabel: "Remind",
  cal_remindOff: "Off",
  cal_remindNow: "On time",
  cal_remind5m: "5 min before",
  cal_remind15m: "15 min before",
  cal_remind1h: "1 hour before",
  cal_remind1d: "1 day before",
  cal_remindHint: "Reminders live on this device only \u2014 no one else is notified.",
  cal_reminderBody: "Starts {when}",
  sponsor_title: "Support this node",
  sponsor_who: "{relay} is run at its operator\u2019s own expense. The links below are self-reported by that node, not an official endorsement.",
  sponsor_note: "Entirely optional. Clicking only opens an external link in your browser or wallet \u2014 this app never handles money and never pays automatically.",
  sponsor_dismiss: "Don\u2019t show again",
  vanish_title: "Erase my data on relays",
  vanish_hint:
    "Offline messages held by relays expire after 7 days by default. You can also ask them to delete everything now — including messages sent to you that you have not received yet, and your encrypted cloud backup. **Your local conversations are unaffected** (they only ever lived on your device).",
  vanish_action: "Request erasure",
  vanish_confirm:
    "Ask every connected relay to delete your data? Undelivered offline messages will be gone for good, and your encrypted cloud backup will be deleted (if enabled). This cannot be undone.",
  vanish_sent: "Erasure request sent to {n} relay(s). Deletion happens on their machines — we cannot guarantee the outcome on their behalf.",
  wipe_confirmWord: "CLEAR",
  wipe_confirm: "This permanently deletes every identity, private key and message on this device and cannot be undone. Without a rescue login code, these identities are gone forever.\n\nType {word} to confirm:",
  wipe_mismatch: "Text didn't match — wipe cancelled.",
  mobilePassword_changed: "Password updated",
  identities_title: "Identities",
  identities_add: "Add identity",
  identities_active: "Active",
  settingsTab_appearance: "Appearance",
  settingsTab_identity: "Identity & Security",
  settingsTab_relay: "Connection & Backup",
  settingsTab_privacy: "Privacy & Notifications",
  settingsTab_advanced: "Advanced",
  settingsTab_about: "About",
  settings_aboutVersion: "Version",
  settings_aboutWhatsNew: "What's new",
  settings_updateAvailable: "Update available: {version}",
  settings_updateDownload: "Download",
  settings_updateCheck: "Check for updates automatically",
  settings_updateCheckHint: "Only checks the version number; sends no data. Can be disabled.",
  dialog_titleConfirm: "Confirm",
  dialog_titleAlert: "Notice",
  dialog_titlePrompt: "Enter",
  dialog_confirm: "OK",
  dialog_cancel: "Cancel",
  dialog_ok: "OK",
  hiddenId_prompt: "Enter the hidden identity's local password",
  hiddenId_fail: "Password doesn't match any hidden identity",
  close_title: "Close Cinderous",
  close_message: "The app will keep running in the tray (still receiving messages). Quit the app entirely?",
  close_quit: "Quit",
  close_tray: "Minimize to tray",
  backup_copy: "Copy rescue login code",
  backup_wrong: "Wrong rescue password or malformed rescue login code",
  settings_cloud: "Multi-device state sync (encrypted)",
  settings_noSystemBackup:
    "This app opts out of Android system backup: your data is never uploaded to Google, and it won't be carried over automatically when you switch phones. To move devices, use \"Move to a new device\" above or encrypted cloud backup.",
  settings_cloudHint: "Stores your encrypted state on your relay so your devices auto-sync contacts / groups / block list (+ recent messages). The relay only ever sees ciphertext; it's protected by your identity key (the local password only protects this device). Expires after 30 days offline.",
  settings_cloudOff: "Off (no sync)",
  settings_cloudBasic: "Basic: contacts, groups, block list, settings",
  settings_cloudFull: "Full: basic + recent messages",
  settings_cloudOffConfirm: "Turn off multi-device state sync? This device's state on the relay is deleted immediately and your other devices can no longer auto-sync.",
  settings_cloudBackupNow: "Sync now",
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
  file_unavailableHint:
    "Can't send a file right now — no direct link to this contact yet, and this relay offers no file store. Once they're online and a direct link is established you can send (text messages are unaffected).",
  file_download: "Download",
  file_sending: "Sending…",
  file_saved: "Saved to",
  file_onOtherDevice: "File is on your other device",
  file_notSaved: "Received (not saved)",
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
  emoji_manifestTooLarge: "This message's custom emoji are too large — use fewer or smaller images",
  emoji_tab: "Custom emoji",
  emoji_import: "Import emoji (set shortcode)",
  emoji_shortcodePrompt: "Name a shortcode for this emoji (type :code: to use it)",
  emoji_empty: "No custom emoji yet. Tap + to import an image and set a shortcode.",
  emoji_insert: "Insert {code}",
  emoji_hint: "↵/Tab insert · ↑↓ choose · Esc close",
  emoji_importPack: "Batch import (many files, filename = shortcode)",
  emoji_packImported: "Imported {added}, skipped {skipped}",
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
  slash_hint: "↵/Tab run · ↑↓ choose · Esc close",
  settings_composer: "Typing",
  settings_enterToSend: "Press Enter to send",
  settings_enterToSendHint: "On: Enter sends, Shift+Enter adds a line. Off: Enter adds a line, Ctrl/⌘+Enter sends.",
  mention_hint: "Tab/Enter to pick · ↑↓ select · Esc dismiss",
  mention_you: "mentioned you",
  thread_title: "Thread",
  thread_empty: "No replies yet — start the discussion",
  thread_reply: "Reply in thread…",
  thread_open: "Reply in thread",
  thread_alsoMain: "Also send to the main conversation",
  thread_alsoMainBadge: "Thread reply also shown in the main conversation (click to open thread)",
  convo_copy: "Copy text",
  convo_copied: "Copied",
  unsend_confirmTitle: "Unsend message",
  unsend_confirmBody: "Unsend this message? Neither side will see its content.",
  unsend_traceless: "Traceless unsend (leave no “message unsent” placeholder)",
  unsend_tracelessHint: "When checked the message disappears entirely; otherwise a placeholder remains. Older clients may still show a placeholder.",
  thread_replies: "{count} replies",
  reply_label: "Reply",
  reply_cancel: "Cancel reply",
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
  urlrisk_knownMalicious: "Known malicious site (threat-intel match)",
  urlrisk_unparsable: "Malformed URL",
  threat_sourceCustom: "My blocklist",
  threatMask_label: "Blocked malicious link",
  threatMask_bySource: "source: {sources}",
  threatMask_reveal: "Reveal",
  threatSend_confirm: "This message contains a known-malicious link ({sources}). Send anyway?",
  threatSend_blocked: "Strict mode blocked sending: this message contains a known-malicious link ({sources}).",
  settings_threatTitle: "Threat protection",
  settings_threatEnable: "Block known-malicious links",
  settings_threatEnableHint: "Matched locally against open-source lists (URLhaus, StevenBlack) — URLs never leave this device; customizable; can be turned off.",
  settings_threatSendWarn: "Warn when sending a flagged link",
  settings_threatStrict: "Strict mode (no reveal, block sending)",
  settings_threatCustom: "Custom blocked domains (one per line)",
  settings_threatCustomApply: "Apply",
  settings_privacy: "Privacy",
  settings_cleanOnPaste: "Strip tracking parameters from pasted links (incl. redirect unwrapping)",
  settings_autoAcquireAssets: "Auto-save others' custom emoji / stickers to my library",
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
  qr_scan: "Scan QR",
  qr_scanHint: "Point the camera at their QR code",
  qr_scanFailed: "Couldn't open the camera (camera permission may be denied)",
  qr_scanNotNpub: "That QR isn't an npub",
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
  call_camera_off: "Stop video",
  call_camera_on: "Resume video",
  call_toVideo: "Turn on my video",
  call_toAudio: "Switch to voice only",
  call_remoteAudioOnly: "They aren't sending video",
  call_quality: "Quality",
  call_quality_low: "Data saver",
  call_quality_medium: "Standard",
  call_quality_high: "High",
  settings_videoQuality: "Video call quality",
  settings_videoQualityHint:
    "Data saver uses about 180 MB/hour, Standard about 585 MB/hour, High about 1.4 GB/hour. You can change this during a call; this sets the starting point for the next one.",
  call_failed_unreachable:
    "Call couldn't connect — a restricted network (symmetric NAT / strict firewall) blocked a direct link. Try Wi-Fi or another network; text and files are unaffected.",
  call_failed_lost: "Call dropped — the connection was lost mid-call (network may be unstable). You can call again.",
  group_create: "New group",
  group_name: "Group name",
  group_members: "Select members",
  group_confirm: "Create",
  group_section: "Groups",
  group_membersCount: "{count} members",
  group_leave: "Leave group",
  group_remove: "Remove",
  settings_status: "Status",
  remember_label: "Remember me (local password)",
  remember_placeholder: "Leave blank to not remember",
  remember_hint: "With a password, your key is stored on this device encrypted with Argon2id. No password, no access. Forgotten passwords cannot be recovered — just sign in with your nsec again.",
  remember_forget: "Forget this identity",
  pairExport_title: "Move to new device",
  pairExport_hint: "Move everything on this device (including your key) to a new one. End-to-end encrypted over P2P; nothing is stored on the relay.",
  pairExport_start: "Start pairing",
  pairExport_offerHint: "Paste this pairing code on the new device:",
  pairExport_waiting: "Waiting for the new device…",
  pairExport_sasWarn: "Compare this code character by character with the new device. If they differ, someone is in the middle — reject immediately.",
  pairExport_sasMatch: "Codes match, send data",
  pairExport_sasMismatch: "Do not match, abort",
  pairExport_sending: "Sending…",
  pairExport_done: "Move complete",
  pairExport_reset: "Start over",
  pairExport_needRelay: "Sign in with a real relay first",
  pair_sasLabel: "Verification code (SAS)",
  copy: "Copy",
  copied: "Copied",
  group_labelAdd: "＋ Label",
  group_labelPlaceholder: "Label name",
  group_labelRemove: "Remove label {label}",
  group_pin: "Pin",
  group_unpin: "Unpin",
  group_filterAll: "All",
  sort_label: "Sort",
  sort_byStatus: "By status",
  sort_byGroup: "By group",
  sort_byName: "By name",
  contactGroup_ungrouped: "Ungrouped",
  contactGroup_all: "All",
  nav_back: "Back",
};

export const catalog: Record<Locale, Messages> = { "zh-Hant": zhHant, en };
