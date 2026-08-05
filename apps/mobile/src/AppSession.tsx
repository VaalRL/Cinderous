// 一個身分的 App（ADR-0332 階段 2b）。
//
// 這個檔案就是原本的 `MobileApp` 本體，**一行邏輯都沒改**——階段 2b 的第一步只做「搬家」，
// 讓「一個身分的 session」有一個自己的元件邊界。控制流反轉（登入改由掛載驅動）與
// `key={pubkey}`（ADR-0332 §1 的 2c）都還沒做。
//
// 🔴 **為什麼要有這個邊界**：per-identity 的 state 全在 `useIdentitySession()` 裡（ADR-0331），
// 而 React 只有在**元件重掛**時才會給結構性重設。重掛需要一個可以掛 `key` 的元件——
// 就是它。`MobileApp` 從此只剩外殼。
//
// ⚠ 三支守衛（perIdentityState／asyncEpoch／refScope）掃的檔案已隨之改為本檔，
// 由 `test/app-session-path.ts` 統一指定——**搬家不能讓守衛掃到空氣**。

// 行動端 app 殼與導覽（ADR-0085/0086/0087）：登入→底部分頁（聊天／聯絡人／設定）→點擊開對話（push）。
// 接 @cinderous/engine 的 ChatBackend（示範或真實 relay，見 backend.ts）；主題/主色/語言由本殼掌管，
// 設定分頁即時切換。正式版把後端換成注入 RelayChatBackend＋原生安全儲存即可（同一套 UI）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppStorage, ChatBackend, ChatMessage, CloudSyncMode, ConnectionState, Contact, Group, OrgInfo, OrgPolicy, PairBundleOrg, Status } from "@cinderous/engine";
import {
  applyPairBundle,
  exportExtension,
  exportMime,
  adoptCloudSyncMode,
  type ExportFormat,
  exportRecords,
  clearStorageNamespace,
  getDeviceId,
  loadProfiles,
  saveProfiles,
  LocalStorage,
  openOpfsArchive,
  type PairBundle,
  shouldMuteOrgNotification,
} from "@cinderous/engine";
import { deriveStorageKey, generateSecretKey, GROUP_MEMBERS_MAX, groupSizeExceeded, makeBackupCode, newInviteToken, nsecDecode, nsecEncode, type OrgInvite } from "@cinderous/core";
import {
  contactLabel,
  createPairingOffer,
  notificationFor,
  runPairSource,
  runPairTarget,
  webRtcPairTransport,
  webSocketConnector,
} from "@cinderous/engine";
import { notifier, onNotifyClick } from "./native/notify.js";
import type { BlockedContact, CalendarEventInput, ContactRequest, RsvpStatus, StoredCalendarEvent } from "@cinderous/engine";
import type { CallMedia, CallState, VideoQuality } from "@cinderous/core";
import { makeThumbnail, pickFile, saveFile, takePhoto } from "./native/files.js";
import {
  foregroundEnabled,
  foregroundSupported,
  setForegroundEnabled,
  startForeground,
  stopForeground,
} from "./native/foreground.js";
import { hasCallSupport } from "./native/call-media.js";
import { CallScreen } from "./screens/CallScreen.js";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import type { ChatBg, Theme } from "@cinderous/theme";
import { getChatBg, removeChatBg, setChatBg } from "./personalize.js";
import { StyleSheet, Text, View } from "react-native-web";
import { changeRememberedPassword, identityFromNsec, type MobileIdentity, unlockRemembered } from "./auth.js";
import {
  activeProfile,
  getRemembered,
  isOwnIdentity,
  cloudSyncOf,
  inviteToOrg,
  loadIdentities,
  saveCloudSyncFor,
  nameTaken,
  profileOrg,
  resolveIdRelay,
  type ProfilesState,
  putRemembered,
  rememberInProfile,
  removeIdentity,
  renameIdentity,
  switchActive,
  visibleProfiles,
} from "./identities.js";
import { createBackend } from "./backend.js";
import { makeEpochGuard } from "./identity-epoch.js";
import { useIdentitySession } from "./use-identity-session.js";
import { loadPresence, savePresence } from "./presence.js";
import { loadNote, saveNote } from "./note-store.js";
import { completeSlot, enqueueSlot, type MobileSlotItem, nextPending, removeSlot as removeSlotItem, retryFailed, setSlotStatus } from "./slot-queue.js";
import { type EscrowEntry, loadEscrow, offboardedEntries, removeEscrow, saveEscrow, upsertEscrow } from "./org-escrow.js";
import { chatList } from "./chat-list.js";
import { BottomTabs, type Tab } from "./screens/BottomTabs.js";
import { ChatsListScreen } from "./screens/ChatsListScreen.js";
import { ContactListScreen, type MobileContact } from "./screens/ContactListScreen.js";
import { UnlockScreen } from "./screens/UnlockScreen.js";
import { ConversationScreen } from "./screens/ConversationScreen.js";
import { HistoryScreen } from "./screens/HistoryScreen.js";
import { NsecSignInScreen } from "./screens/NsecSignInScreen.js";
import { PairExportScreen, type PairPhase } from "./screens/PairExportScreen.js";
import { PairImportScreen } from "./screens/PairImportScreen.js";
import { RosterAdminScreen } from "./screens/RosterAdminScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";

type Screen =
  | "signin"
  | "unlock"
  | "switch"
  | "addIdentity"
  | "pair"
  | "pairExport"
  | "main"
  | "conversation"
  | "history"
  | "roster";

/** 開始一個 session 的選項（ADR-0332 2b：由外殼持有，供掛載時接線）。 */
export interface SessionOpts {
  bundle?: PairBundle;
  joinInvite?: OrgInvite;
  overrideOrg?: PairBundleOrg;
  overrideRelay?: string;
  forceInvisible?: boolean;
  /** 接線完成後落在哪個畫面；預設 `main`（建立公司走 `roster`）。 */
  landOn?: Screen;
}

/** 外殼記下的作用中 session。 */
export interface ActiveSession {
  identity: MobileIdentity;
  opts: SessionOpts;
}

const STATUS_KEY: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

const shell = StyleSheet.create({ root: { flex: 1 } });
// 連線狀態細條（ADR-0034／0169）：固定色（琥珀＝連線中、紅＝離線），兩主題皆清楚可辨。
const bannerStyles = StyleSheet.create({
  connecting: { paddingVertical: 4, paddingHorizontal: 12, backgroundColor: "#b45309" },
  offline: { paddingVertical: 4, paddingHorizontal: 12, backgroundColor: "#b91c1c" },
  text: { color: "#fff", fontSize: 12, fontWeight: "700", textAlign: "center" },
});

// 加密雲端備份（ADR-0071）：**每身分一份**（ADR-0327，與桌面同語意）——
// 它決定「這個身分的資料要不要離開裝置」，裝置層語意會讓工作身分的選擇黏到個人身分上。
// 值存在 profiles 登錄檔（`identities.ts`），此處不再有鍵。
/** 通知設定（ADR-0116）：開關與「隱藏預覽」。 */
const NOTIFY_KEY = "nb.notify";
const NOTIFY_HIDE_KEY = "nb.notifyHidePreview";
// 「記住我」（ADR-0117）＋多身分（ADR-0138）：每身分一份 Argon2id 包裹的 nsec，登錄見
// identities.ts。**絕不明文存 nsec**（ADR-0112 紅線）。
// 已讀回條（ADR-0058）：opt-in＋互惠——關閉則不送、也不顯示對方的已讀（故 tick 最多到已送達）。
const READ_RECEIPTS_KEY = "nb.readReceipts";
function readReadReceipts(): boolean {
  try {
    return localStorage.getItem(READ_RECEIPTS_KEY) === "1";
  } catch {
    return false;
  }
}

// 每對話保留上限（ADR-0094）：裝置本地、不同步；0＝無上限（預設）。
const RETENTION_KEY = "nb.retentionCap";
function readRetentionCap(): number {
  try {
    return Math.max(0, parseInt(localStorage.getItem(RETENTION_KEY) ?? "0", 10) || 0);
  } catch {
    return 0;
  }
}

/** 導出文字檔（明文，ADR-0094）：RN-web 以瀏覽器下載。 */
function downloadText(name: string, mime: string, text: string): void {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    /* 忽略（無 DOM 環境） */
  }
}

export function AppSession({
  relayUrl = null,
  profiles,
  onProfiles: setProfiles,
  theme,
  onTheme: setTheme,
  locale,
  onLocale: setLocale,
  accent,
  onAccent: setAccent,
  videoQuality,
  onVideoQuality: setVideoQuality,
  active,
  onEnter,
  onLeave,
}: {
  /** 真實中繼站網址（wss://…）；null＝示範後端（ADR-0086）。 */
  relayUrl?: string | null;
  /** 身分登錄（ADR-0138）。**住在外殼**——它必須比任何一個 session 活得久（ADR-0332 2b）。 */
  profiles: ProfilesState;
  onProfiles: (next: ProfilesState) => void;
  /** 外觀與語言是**這台裝置**的偏好，切身分不重設 ⇒ 同樣住在外殼。 */
  theme: Theme;
  onTheme: (t: Theme) => void;
  locale: Locale;
  onLocale: (l: Locale) => void;
  accent: string | null;
  onAccent: (a: string | null) => void;
  /** 視訊通話畫質（ADR-0337）：同樣是這台裝置的偏好，住在外殼。 */
  videoQuality: VideoQuality;
  onVideoQuality: (q: VideoQuality) => void;
  /** 外殼記下的「作用中身分」；`null`＝尚未登入（顯示登入／解鎖畫面）。 */
  active: ActiveSession | null;
  /** 開始一個 session。畫面只做這件事，真正的接線由下方 effect 負責（ADR-0332 2b）。 */
  onEnter: (identity: MobileIdentity, opts?: SessionOpts) => void;
  /** 結束 session（軟登出，ADR-0201）。 */
  onLeave: () => void;
}): JSX.Element {
  /** 身分登錄（多身分，ADR-0138）：開機載入（含舊單一身分遷移）。 */
  /** 作用中身分的登錄項；其密碼包裹 blob 供解鎖／改密碼。 */
  const activeReg = activeProfile(profiles);
  const remembered = activeReg ? getRemembered(activeReg.pubkey) : null;
  const [screen, setScreen] = useState<Screen>(() =>
    // ADR-0332 2b：有作用中身分就直接落在它要去的畫面（2c 掛 key 後，這就是「掛載即定位」）。
    active ? (active.opts.landOn ?? "main") : activeProfile(profiles) ? "unlock" : "signin",
  );
  /** 切換身分時，待解鎖的目標 pubkey（ADR-0138）。 */
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chats");
  /**
   * 這個身分的全部 session state（ADR-0332 階段 2a）：7 個功能簇聚合成一個物件。
   * 階段 2c 會把它掛上 `key={pubkey}` ——屆時要重掛的就是這一個呼叫。
   */
  const session = useIdentitySession();
  const { self, roster, threads, cal, org, settings, call } = session;
  // 解構讀取端：欄位擁有權在 hook，但**讀取點超過一百處**，改名只會製造無意義的 diff。
  // 寫入一律經 hook（守衛會檢查簇內 setter 不得殘留在本檔）。
  const { contacts, groups, blocked, requests } = roster;
  const { convos, unread, archived, reactions, unsent, purged, activeId, typingFrom } = threads;
  /** 通知（ADR-0116）：預設關（需使用者明確授權）。 */
  // 背景保活開關（ADR-0272/0274）：Android 預設開；非原生殼恆 false（設定不顯示）。
  const [fgOn, setFgOn] = useState(foregroundEnabled);
  const [notify, setNotifyState] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) === "1";
    } catch {
      return false;
    }
  });
  /** 隱藏預覽（ADR-0076）：通知只說「有新訊息」，不把明文推到鎖定畫面。 */
  const [notifyHide, setNotifyHideState] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 對話背景（ADR-0134，本地個人化）：開對話時載入該對話的偏好，換對話時更新。
  const [chatBg, setChatBgState] = useState<ChatBg | null>(null);
  const [retentionCap, setRetentionCapState] = useState<number>(() => readRetentionCap());
  const [readReceipts, setReadReceiptsState] = useState<boolean>(() => readReadReceipts());
  // 通話（ADR-0101）：媒體全程 P2P，不經中繼。
  /**
   * 身分世代（ADR-0329）：`signInWith` 每次 +1。
   * 已發出、還沒回來的非同步工作在落地前比對——世代變了就丟掉（見 `identity-epoch.ts`）。
   */
  const epochRef = useRef(makeEpochGuard());
  const backendRef = useRef<ChatBackend | null>(null);
  const storeRef = useRef<AppStorage | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // 通知內容需最新的聯絡人/群組/語言與子設定；onMessage 的閉包依 [backend]，故以 ref 取現值
  //（與桌面同一個坑，ADR-0076）。
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const notifyHideRef = useRef(notifyHide);
  notifyHideRef.current = notifyHide;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // 組織資訊（ADR-0157）：下班靜音判定用（工時＋成員）。由 onOrgInfo 直接設，切身分清空。
  const orgInfoRef = useRef<OrgInfo | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  // 視訊畫質（ADR-0337）：render 期鏡像，供 `signInWith` 建後端時取當前值（prop 會變，閉包會 stale）。
  const videoQualityRef = useRef(videoQuality);
  videoQualityRef.current = videoQuality;

  useEffect(() => () => backendRef.current?.stop(), []);

  const themeProps = { locale, theme, accent } as const;

  /**
   * 忘記／登出作用中身分（ADR-0138）：從登錄移除該身分＋刪其密文，改指剩餘者。
   * 還有其他身分 → 進解鎖畫面解下一個；沒有了 → 回登入。
   */
  const forgetActive = (): void => {
    const target = activeProfile(profiles);
    const next = target ? removeIdentity(profiles, target.pubkey) : profiles;
    setProfiles(next);
    setScreen(activeProfile(next) ? "unlock" : "signin");
  };

  const handleSignIn = (identity: MobileIdentity, password?: string): void => {
    // 「記住我」：以 Argon2id 密碼包裹 nsec 落地並登錄成一個身分（ADR-0117／0138）。無密碼＝不記住
    // （轉瞬 session，不進切換器）。
    if (password) {
      const res = rememberInProfile(profiles, identity, password, relayUrl ?? "");
      if (res) setProfiles(res.state);
    }
    onEnter(identity);
  };

  /**
   * 邀請碼入職（ADR-0156／0176）：貼碼 → **生成全新企業成員身分**（不是拿現有 nsec 轉），設顯示名，
   * 鎖定公司座、帶入職權杖（開機自動向管理者提出入職）；公司帳號（escrow）則入職時把私鑰託管給
   * 雇主（貼碼畫面已明示同意）。有密碼＝記住此身分（跨重啟持久，ADR-0174）。
   */
  const joinOrg = (invite: OrgInvite, name: string, password?: string): void => {
    const r = identityFromNsec(nsecEncode(generateSecretKey()), name);
    if (!r.ok) return; // 名稱空白等（貼碼畫面已擋，這裡防禦）
    if (password) {
      const res = rememberInProfile(profiles, r.identity, password, invite.relayUrl, inviteToOrg(invite));
      if (res) setProfiles(res.state);
    }
    onEnter(r.identity, { joinInvite: invite });
  };

  /**
   * 建立公司（ADR-0155／0178，企業主）：生成全新一般身分＋`orgOwner` 標記＋核准權杖 → 進「組織
   * 名冊」畫面設組織名/成員/公司設定並**首次發布**，並複製邀請碼給員工。企業主後端語意同個人
   * （漫遊/搬家全開），只是多了名冊管理權。有密碼＝記住（跨重啟持久，ADR-0174）。
   */
  const createCompany = (name: string, password?: string): void => {
    const r = identityFromNsec(nsecEncode(generateSecretKey()), name);
    if (!r.ok) return;
    const org: PairBundleOrg = { orgOwner: true, orgInviteToken: newInviteToken() };
    if (password) {
      const res = rememberInProfile(profiles, r.identity, password, relayUrl ?? "", org);
      if (res) setProfiles(res.state);
    }
    // overrideOrg：profiles 尚未 commit，直接帶。`landOn`：建完公司直接進名冊管理
    // （2b 之前是「signInWith 設 main、下一行覆寫」；控制流反轉後那個覆寫時機不存在了）。
    onEnter(r.identity, { overrideOrg: org, landOn: "roster" });
  };

  /**
   * 離職接管（ADR-0163／0179，企業主）：以託管私鑰在本機登入該離職員工身分，指向其公司座**查看
   * 中繼站仍保留的歷史**。純查看：立即設隱身（離職員工不應顯示在線、不再廣播/入職）。
   */
  const takeoverOffboarded = (entry: EscrowEntry): void => {
    if (!confirmAction("offboard_takeoverConfirm")) return; // ADR-0180 審查建議：接管前確認
    const r = identityFromNsec(entry.nsec, `離職·${entry.name}`);
    if (!r.ok) return;
    // ADR-0180 審查修正：forceInvisible 讓後端**建構即隱身**——首拍 beat() 就靜默，離職身分不會被
    // 廣播上線（先前是 start 後才 setInvisible，第一拍已洩漏）。overrideRelay 指向該員工公司座。
    onEnter(r.identity, { overrideRelay: entry.relayUrl, forceInvisible: true });
  };
  /** 刪除一筆託管（ADR-0163）：企業主決定不再保留該離職員工的金鑰備份。重新加密落盤。 */
  const deleteEscrow = (pubkey: string): void => {
    if (!self.pubkey || !self.nsec) return;
    if (!confirmAction("offboard_deleteConfirm")) return; // ADR-0180 審查建議：刪除不可逆，先確認
    const sk = nsecDecode(self.nsec);
    org.updateEscrow((list) => {
      const next = removeEscrow(list, pubkey);
      saveEscrow(self.pubkey, sk, next);
      return next;
    });
  };

  // ── 多身分切換（ADR-0138）─────────────────────────────────────────────────
  /** 點切換器裡的某身分：同一個＝忽略；不同＝進切換解鎖畫面解該身分的密碼。 */
  const beginSwitch = (pubkey: string): void => {
    if (pubkey === self.pubkey) return; // 已是作用中
    setPendingSwitch(pubkey);
    setScreen("switch");
  };
  /** 解開待切換身分的密碼 → 換作用中並啟動其後端。密碼錯回 false（畫面不前進）。 */
  const doSwitch = (password: string): boolean => {
    if (!pendingSwitch) return false;
    const rem = getRemembered(pendingSwitch);
    if (!rem) return false;
    const r = unlockRemembered(rem, password);
    if (!r.ok) return false;
    setProfiles(switchActive(profiles, pendingSwitch));
    setPendingSwitch(null);
    setScreen("main");
    setTab("chats");
    threads.close();
    onEnter(r.identity); // 換命名空間＝資料天然隔離（ADR-0138）
    return true;
  };
  const pendingProfile = pendingSwitch ? profiles.profiles.find((p) => p.pubkey === pendingSwitch) : undefined;

  // 配對搬家匯入（新機／ADR-0125）：套用全量捆包（身分＋聯絡人＋歷史＋群組）而非只還原身分。
  // 過去這裡只 `onSignIn(identity)` → 換手機後聯絡人與訊息全部不見，只搬了個空身分。
  const importFromOldDevice = (bundle: PairBundle, identity: MobileIdentity, password?: string): void => {
    if (bundle.cloudSync) changeCloudSync(bundle.cloudSync); // 接續舊機的備份習慣（ADR-0071）
    // ADR-0174：有密碼＝記住此裝置（連同企業身分精華 bundle.org 寫進登錄）→ 跨重啟解鎖即以企業身分
    // 啟動；空＝這次是暫時 session（沿用既有行為，重啟需重新配對）。remember 用真 nsec，須在
    // signInWith 抹掉 store 的 nsec **之前**（remembered blob 與 store 是分開的兩份）。
    if (password) {
      const res = rememberInProfile(profiles, identity, password, bundle.relayUrl, bundle.org);
      if (res) setProfiles(res.state);
    }
    onEnter(identity, { bundle }); // ADR-0180 審查修正：bundle.relayUrl 現由 idRelay 鏈解析（連對公司座）
  };

  /**
   * 開始這個身分的 session（ADR-0332 2b）。
   *
   * 🔴 **不再由畫面直接呼叫**——畫面只呼叫 `onEnter()`，由外殼記下「作用中身分」，
   * 再由下方的 effect 觸發這裡。控制流因此從**命令式**變成**由掛載/切換驅動**，
   * 而那正是 2c 掛上 `key` 後能拿到結構性重設的原因（先有乾淨 state，才有後端灌入）。
   */
  const signInWith = (identity: MobileIdentity, opts: SessionOpts = {}): void => {
    const { bundle, joinInvite, overrideOrg, overrideRelay, forceInvisible } = opts;
    // ADR-0329：**先**進新世代，再做任何事——已發出的非同步工作從這一刻起一律作廢。
    epochRef.current.bump();
    backendRef.current?.stop();
    // ADR-0176／0180：企業成員鎖公司座——接管 overrideRelay ＞ 入職邀請 relay ＞ **配對捆包 relay**
    //（審查修正：先前漏掉→配對進來的企業身分連錯 relay、收不到名冊）＞ 已記住登錄 relay ＞ 全域。
    // 註：`prof` 在剛 remember/switch 的同一輪為 stale（setProfiles 未 commit），故企業精華與 relay
    // 都以顯式來源（bundle/joinInvite/overrideOrg/overrideRelay）優先，不依賴 prof。
    const prof = profiles.profiles.find((p) => p.pubkey === identity.pubkey);
    // ADR-0327：雲端備份是**這個身分**的選擇 ⇒ 切身分必須重讀（讀持久化檔，`prof` 這一輪可能 stale）。
    const idCloudSync = cloudSyncOf(identity.pubkey); // 見下方 settings.reset（ADR-0331）
    const idRelay = resolveIdRelay({
      overrideRelay,
      inviteRelay: joinInvite?.relayUrl,
      bundleRelay: bundle?.relayUrl,
      profileRelay: prof?.relayUrl,
      fallback: relayUrl,
    });
    // ADR-0094：真實 relay 用外部持有的儲存（供保留上限/導出）；示範模式無持久化。
    // ADR-0112：靜態加密——資料金鑰由 nsec 導出。行動端**從不持久化 nsec**（每次輸入），
    // 所以金鑰不在磁碟上 → localStorage/OPFS 上的訊息**真的**解不開。
    const sk = nsecDecode(identity.nsec);
    const store = idRelay ? new LocalStorage(identity.pubkey, readRetentionCap(), sk) : null;
    // 配對搬家（ADR-0125）：把捆包的聯絡人/訊息/群組灌進**加密** store（DEK 由 nsec 導出），
    // **必須在建後端之前**——`backend.start()` 會回放 store 裡的聯絡人與 1:1 歷史（見 relay-backend）。
    // 然後把 identity 的 nsec 抹掉：`applyPairBundle` 會 `saveIdentity(含 nsec)`，但行動端**絕不
    // 明文存 nsec**（ADR-0112 紅線；DEK 由 nsec 導出＝循環，加密它沒有意義）。與桌面瀏覽器同一招。
    if (store && bundle) {
      applyPairBundle(store, bundle);
      store.saveIdentity({ nsec: "", name: identity.name });
    }
    storeRef.current = store;
    // ADR-0111：封存走 OPFS（webview 沒有檔案系統；OPFS 的配額與 localStorage 是不同的池子）。
    // 非同步掛上——掛上前不會裁切熱區，故安全；不支援 OPFS 時不掛（熱區無上限，資料完好）。
    // 封存塊以同一把金鑰加密（ADR-0112）。
    if (store) {
      void openOpfsArchive(identity.pubkey, store.storageKey()).then((a) => a && store.attachArchive?.(a));
    }
    // ADR-0164／0168：本機記住的上次手動狀態＋自訂文字，上線即還原（隱身另有攔截，不經此）。
    const pref = loadPresence(identity.pubkey);
    // ADR-0100：帶上錨點/簽章清單（backend.ts 內）與加密雲端備份模式。
    // 企業身分精華：入職當下取邀請碼（ADR-0176）；配對取捆包 org（0173）；重啟解鎖取**已記住的
    // 登錄 Profile**（0174，跨重啟持久）。皆無＝一般身分。
    // ADR-0178：建立公司當下取 overrideOrg（新企業主，profiles 尚未 commit）；否則入職/配對/登錄。
    const orgSeed = overrideOrg ?? (joinInvite ? inviteToOrg(joinInvite) : (bundle?.org ?? profileOrg(prof)));
    const backend = createBackend(identity, idRelay, {
      store: store ?? undefined,
      cloudSync: idCloudSync,
      ...(pref ? { initialStatus: pref.status, initialStatusMessage: pref.statusMessage } : {}),
      // ADR-0180 審查修正：接管離職身分＝建構即隱身，首拍 beat() 就靜默（不把離職身分廣播上線）。
      ...(forceInvisible ? { initialInvisible: true } : {}),
      // ADR-0173：企業身分 → 後端唯讀採用公司名冊（同事/allowlist/政策/組織資訊）。
      ...(orgSeed ? { org: orgSeed } : {}),
    });
    backendRef.current = backend;
    // 背景保活（ADR-0272 Android 預設路徑）：有連線可保了才啟動；非原生環境為 no-op。
    if (foregroundEnabled()) {
      void startForeground(translate(localeRef.current, "fg_title"), translate(localeRef.current, "fg_text"));
    }
    // ADR-0331：企業這一簇一次播種——歸零＋換成**這個身分**的公司精華／頭銜／託管清單。
    org.reset({
      org: orgSeed,
      title: backend.selfTitle?.() ?? "", // ADR-0170：還原已廣播的頭銜（供設定頁預填）
      escrow: orgSeed?.orgOwner ? loadEscrow(identity.pubkey, sk) : [], // ADR-0179
    });
    slotBusyRef.current = false;
    // ADR-0169 審查修正：換身分清掉殘留的狀態文字廣播計時器（typing 由 threads.reset() 涵蓋）。
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current); // ADR-0171：別把上個身分待送的狀態文字帶過來
    orgInfoRef.current = null; // ADR-0157/0175：清上個身分的組織資訊（下次 onOrgInfo 重設）
    pairDecision.current = null; // ADR-0330：上個身分那場配對的 SAS 回呼不該還接在這裡
    // ADR-0331：「我自己」一次播種——身分本體＋本機記住的上次手動狀態（ADR-0164）。
    // 隱身每次登入統一重設（切身分/登出對稱）；接管離職身分以 forceInvisible 覆寫（ADR-0180）。
    self.reset({
      pubkey: identity.pubkey,
      name: identity.name,
      npub: identity.npub,
      nsec: identity.nsec,
      status: pref?.status ?? "online",
      statusMessage: pref?.statusMessage ?? "",
      invisible: !!forceInvisible,
    });
    // ── per-identity 重設區（P4／ADR-0294 §2）───────────────────────────────
    // 換身分是**就地切換**（桌面走 `location.reload()`＝結構性保證，行動端沒有那個保證），
    // 所以每一個 per-identity state 都必須在這裡歸零。手寫清單會漏——ADR-0294 §2 抓到
    // `archived`／`purged`／`calDraft` 三個漏網，其中 `archived` 是歷史入口的閘門：
    // 兩個身分若共用同一個 pubkey 鍵，切過去就會看到**上個身分的幽靈歷史入口**。
    //
    // `MobileApp.perIdentityState.test.ts` 現在會擋住下一個漏網：任何新 state 都必須先被
    // 分類（per-identity 或裝置層），per-identity 的還必須在 `signInWith` 內被指派。
    // ADR-0332 2c：名冊／行程／對話那三簇的「歸零」已由 `key` 重掛承擔——這裡曾經有三行呼叫，
    // 刪掉它們正是這一階段的目的：**把「記得重設」換成「不可能忘記」**。
    // 通話狀態（ADR-0101）：`backendRef.current?.stop()` 停了後端，但 React 這邊仍留著
    // 「通話中」的畫面與串流參照 ⇒ 切身分後會看到上個身分的通話 UI。
    // ADR-0331：身分層開關一次重讀——這一簇**沒有「歸零成空」這個選項**，
    // 每個值都要換成新身分的（開過 FS 的身分切回來得顯示「已啟用」，ADR-0327 那類錯）。
    const log = backend.fsFailures?.();
    settings.reset({
      fsEnabled: backend.fsEnabled?.() ?? false, // ADR-0245／0306：存在該身分的 StoredFsState
      fsFailures: { count: log?.maybeEkLoss ?? 0, lastAt: log?.lastEkLossAt ?? 0 }, // ADR-0316
      groupInviteAnyone: backend.groupInviteFromAnyone?.() ?? false, // ADR-0317
      devices: backend.devices?.() ?? [], // ADR-0321
      cloudSync: idCloudSync, // ADR-0327：讀這個身分的登錄項
    });
    // ── per-identity 重設區 迄 ─────────────────────────────────────────────
    backend.start({
      onContacts: roster.setContacts,
      onGroups: roster.setGroups,
      onCalendar: cal.setEvents,
      // 行程提醒（ADR-0266）：**刻意不看 `document.hidden`**——訊息通知的「正在看就別打擾」
      // 在這裡是錯的：你正盯著這個 App，不代表你知道十分鐘後有會。只受總開關管。
      onCalendarReminder: (e) => {
        if (!notifyRef.current) return;
        void notifier.notify({
          title: e.title,
          body: translate(localeRef.current, "cal_reminderBody", {
            when: new Date(e.start * 1000).toLocaleString(localeRef.current, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          }),
          ...(e.groupId ?? e.contact ? { convo: (e.groupId ?? e.contact) as string } : {}),
        });
      },
      onHistory: (pk, msgs) => threads.setConvos((c) => ({ ...c, [pk]: msgs })),
      onMessage: (pk, m) => {
        threads.setConvos((c) => {
          const cur = c[pk] ?? [];
          if (cur.some((x) => x.id === m.id)) return c;
          return { ...c, [pk]: [...cur, m] };
        });
        // 未讀由後端從儲存推導（ADR-0108）；正在看這個對話 → 立刻推進已讀水位（不留紅點）。
        const viewing = screenRef.current === "conversation" && activeIdRef.current === pk;
        if (!m.outgoing && viewing) backend.clearUnread?.(pk);
        // 通知（ADR-0116）：**只在他人訊息、且 App 在背景**時跳——正在看就別打擾。
        // 訊息請求（ADR-0121）**一律不跳通知**：讓陌生人能推播到你的鎖定畫面，那就是騷擾。
        const isRequest = requestsRef.current.some((r) => r.pubkey === pk);
        // 下班自動靜音（ADR-0157／0175）：非工時且來源為組織（企業同事 1:1／組織群組）→ 不彈通知
        //（未讀照常）。與桌面共用 shouldMuteOrgNotification；minutesOfDay 取當地時間。
        const grp = groupsRef.current.find((g) => g.id === pk);
        const now = new Date();
        const muted = shouldMuteOrgNotification(
          orgInfoRef.current,
          { ...(grp ? { orgGroup: !!grp.org } : { senderContact: pk }) },
          now.getHours() * 60 + now.getMinutes(),
        );
        if (!m.outgoing && !viewing && !isRequest && !muted && notifyRef.current && typeof document !== "undefined" && document.hidden) {
          const group = groupsRef.current.find((g) => g.id === pk);
          const nameOf = (k: string): string =>
            groupsRef.current.find((g) => g.id === k)?.name ??
            contactsRef.current.find((c) => c.pubkey === k)?.name ??
            `${k.slice(0, 8)}…`;
          void notifier.notify(
            notificationFor({
              convo: pk,
              convoName: nameOf(pk),
              text: m.file ? `📎 ${m.file.name}` : m.text,
              // 群訊前綴發送者名（否則群裡誰說的都分不出來）。
              ...(group && m.sender ? { senderName: nameOf(m.sender) } : {}),
              hidePreview: notifyHideRef.current,
              newMessageLabel: translate(localeRef.current, "notify_newMessage"),
            }),
          );
        }
      },
      // 未讀（ADR-0108）：重新載入後徽章仍在（過去是記憶體計數器，重載歸零）。
      onUnread: threads.setUnread,
      onReaction: (messageId, emoji) =>
        threads.setReactions((prev) => {
          const cur = prev[messageId] ?? [];
          if (cur.includes(emoji)) return prev;
          return { ...prev, [messageId]: [...cur, emoji] };
        }),
      onUnsend: (messageId, traceless) =>
        (traceless ? threads.setPurged : threads.setUnsent)((prev) => {
          if (prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.add(messageId);
          return next;
        }),
      onBlocked: roster.setBlocked,
      onRequests: roster.setRequests, // ADR-0121
      // 送出狀態（ADR-0095）：與桌面同一套（傳送中/失敗/已送出/已送達/已讀）→ 氣泡旁圖示。
      onMessageStatus: (pk, messageId, status) =>
        threads.setConvos((c) => {
          const cur = c[pk];
          if (!cur) return c;
          let changed = false;
          const next = cur.map((m) => {
            if (m.id !== messageId || m.status === status) return m;
            changed = true;
            return { ...m, status };
          });
          return changed ? { ...c, [pk]: next } : c;
        }),
      // 群組每成員回條（ADR-0095）：小群才有；先接進狀態供之後渲染「誰已讀／M/N」。
      onMessageReceipts: (groupId, messageId, receipts) =>
        threads.setConvos((c) => {
          const cur = c[groupId];
          if (!cur) return c;
          return { ...c, [groupId]: cur.map((m) => (m.id === messageId ? { ...m, receipts } : m)) };
        }),
      // 收到檔案位元組（ADR-0093）：另存到裝置，App 不保管本體；訊息本身由 backend 建好。
      onFileBytes: (pk, messageId, file) => {
        // 圖片縮圖（ADR-0102）：跨 session 存活，重載後圖片仍是圖片。
        void makeThumbnail(file.bytes, file.mime).then((thumb) => {
          if (thumb) backend.setFileThumb?.(pk, messageId, thumb);
        });
        const url = saveFile(file.name, file.mime, file.bytes);
        threads.setConvos((c) => {
          const cur = c[pk];
          if (!cur) return c;
          return {
            ...c,
            [pk]: cur.map((m) =>
              m.id === messageId && m.file
                ? { ...m, file: { ...m.file, sent: file.bytes.length, ...(url ? { url } : {}) } }
                : m,
            ),
          };
        });
      },
      // 縮圖產生完成（ADR-0102）：即時打進 UI。
      onFileThumb: (pk, messageId, thumb) =>
        threads.setConvos((c) => {
          const cur = c[pk];
          if (!cur) return c;
          return {
            ...c,
            [pk]: cur.map((m) => (m.id === messageId && m.file ? { ...m, file: { ...m.file, thumb } } : m)),
          };
        }),
      // ADR-0071：還原時採用快照傳播的備份模式（**僅本機從未設定時**）。
      // 🔴 ADR-0327 順帶修正：舊寫法是 `readCloudSync() === "off"`——裝置層那把鑰匙分不出
      // 「從未設定」與「明確關閉」，所以**明確關掉的人會被另一台的快照重新打開**。
      // 改成身分層之後兩者可分，直接用引擎既有的 `adoptCloudSyncMode`（它的註解本來就寫著
      // 「不覆蓋使用者較新的手動選擇（含明確設 off）」）。
      onCloudSyncMode: (mode) => {
        const pk = identity.pubkey;
        const before = loadProfiles();
        const after = adoptCloudSyncMode(before, pk, mode);
        if (after === before) return; // 已設定過 → 不動
        saveProfiles(after);
        settings.setCloudSync(mode);
      },
      // 入職金鑰託管到達（ADR-0163／0179，企業主端）：把員工公司帳號私鑰**加密**落盤（以企業主自己
      // 的 sk 導出金鑰），供日後離職接管。權杖已驗、nsec 已對回員工 pubkey（引擎端把關）。
      onOrgEscrow: (e) => {
        const entry: EscrowEntry = { pubkey: e.pubkey, name: e.name, nsec: e.nsec, relayUrl: e.relayUrl, at: Date.now() };
        org.updateEscrow((list) => {
          const next = upsertEscrow(list, entry);
          saveEscrow(identity.pubkey, sk, next); // 加密：密文離開企業主 nsec 就解不開（ADR-0112 不破）
          return next;
        });
      },
      // 企業政策（ADR-0048 §2 的 UI 閘門層；行動端接線＝ADR-0311）：引擎採用簽章名冊時送來。
      onPolicy: org.setPolicy,
      // ADR-0173：後端採用公司名冊（企業身分）→ **實際會員身分確認**（比捆包旗標更穩健的設閘訊號）。
      // 同事/allowlist 由引擎的 onContacts 與保留天數（引擎內部）自動帶入。
      // ADR-0157（行動端 ADR-0175 補齊）：存工時＋成員供下班靜音；歡迎詞變更時顯示一次。
      onOrgInfo: (info) => {
        org.markEnterprise();
        orgInfoRef.current = info;
        if (
          info.welcome &&
          typeof window !== "undefined" &&
          typeof window.alert === "function" &&
          typeof localStorage !== "undefined"
        ) {
          // keyed by 身分＋公司，內容變更才彈（不重複打擾）。用 identity.pubkey（此閉包內可靠）。
          const key = `nb.orgWelcome.${identity.pubkey}`;
          try {
            if (localStorage.getItem(key) !== info.welcome) {
              localStorage.setItem(key, info.welcome);
              window.alert(`${info.org}\n\n${info.welcome}`);
            }
          } catch {
            /* 配額/不可用時忽略 */
          }
        }
      },
      ...call.handlers, // 通話狀態與串流（ADR-0101／0331）
      // 對方正在輸入（ADR-0120；行動端於 ADR-0169 補齊）：記下來源，對話副標顯示「正在輸入…」。
      onTyping: (pk) => threads.markTyping(pk), // ADR-0120／0331：計時器與逾時都在對話簇內
      // 與中繼站連線狀態（ADR-0034；行動端於 ADR-0169 補齊）：非 online 時頂端顯示細條。
      onConnection: (state) => self.setConnection(state),
      // 敲一下（ADR-0114）：收到就震動（行動端於 ADR-0168 補齊）。裝置不支援 Vibration API
      // （多數桌面瀏覽器、iOS Safari）時靜默略過——不是錯誤，只是沒有觸覺回饋。
      onNudge: () => {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate([120, 60, 120]);
        }
      },
      // ADR-0245：前向保密降級警告——對已釘選 FS 的聯絡人送訊卻無其 EK，該則退回靜態。
      // **不得靜默**：在該對話留下提示。行動端先前完全沒接這兩個 handler，等於啟用 FS 後
      // 降級是無聲的——那比「行動端沒有 FS」更糟，故與設定開關同一批補上（ADR-0306）。
      onFsDowngrade: (peer) => pushFsNotice(peer, "fs_downgradeWarning"),
      // ADR-0306 D3.3c：對方宣告了我們不支援的機制＝**對方升級了**，不是降級。
      // 刻意用另一句文案——把「你該更新」顯示成「對方可能被攻擊」就是說謊（ADR-0302 §4）。
      // 該紅線由 packages/i18n 的文案測試鎖住，兩端共用同一份。
      onFsUnsupported: (peer) => pushFsNotice(peer, "fs_unsupportedWarning"),
      // ADR-0316：有訊息解不開。**沒有 peer 可用**——NIP-59 外層作者是一次性臨時金鑰，
      // 解不開就不知道是誰送的 ⇒ 不能 pushFsNotice（那會是編造的歸屬），只更新全域計數。
      // ADR-0334：別台的快照把開關翻掉了 → 設定頁要跟著動（否則顯示與實際不一致）。
      onFsEnabled: (v) => settings.setFsEnabled(v),
      onFsUndecryptable: (log) =>
        settings.setFsFailures({ count: log.maybeEkLoss, lastAt: log.lastEkLossAt ?? Date.now() }),
      // ADR-0321：裝置清單變動 → 更新設定頁；首見一台沒看過的 → 顯著提示。
      onDevices: (list) => settings.setDevices(list),
      // ADR-0322 S1：兩份互相衝突的目錄＝有人用你的 nsec 簽了另一份。不自動選邊，只告知。
      onDeviceDirectoryConflict: (_mine, v) => {
        void notifier.notify({
          title: translate(localeRef.current, "devices_title"),
          body: translate(localeRef.current, "devices_conflict", { v: String(v) }),
        });
      },
      onNewDevice: (id) => {
        // 行動端沒有 alert 對話框的統一入口；用與 FS 警告同一條路（notifier）顯著提示。
        void notifier.notify({
          title: translate(localeRef.current, "devices_title"),
          body: translate(localeRef.current, "devices_new", { id: id.slice(0, 8) }),
        });
      },
    });
    backend.setReadReceipts?.(readReceipts); // ADR-0058：互惠開關（關＝不送也不顯示對方已讀）
    backend.setVideoQuality?.(videoQualityRef.current); // ADR-0337：沿用這台裝置上次選的畫質
    setTab("chats");
    setScreen(opts.landOn ?? "main");
  };

  /**
   * 接線的觸發點（ADR-0332 2b）：作用中身分一變就重新接線。
   *
   * 🔴 **這就是控制流反轉之後的登入**。2c 在外殼掛上 `key` 之後，`active` 變動同時意味著
   * 本元件重掛 ⇒ 這個 effect 變成「掛載時執行一次」，而所有 session state 在那一刻**天生是乾淨的**
   * ——那正是 ADR-0331 §1 否決 `useIdentityState` 時說的、React 生命週期免費給的順序保證。
   */
  useEffect(() => {
    if (active) signInWith(active.identity, active.opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟著 active 走；signInWith 讀的是當下的閉包
  }, [active]);

  const openConvo = (id: string): void => {
    threads.open(id);
    setChatBgState(getChatBg(id)); // 載入該對話的背景偏好（ADR-0134）
    setScreen("conversation");
    // ADR-0111：查這個對話有沒有封存（決定要不要顯示「歷史紀錄」入口）。非同步、不擋畫面。
    const arch = storeRef.current?.archiveOf?.();
    if (arch) {
      const still = epochRef.current.mark(); // ADR-0329：切了身分就丟掉——這是上個身分的封存
      void arch.chunkCount(id).then((n) => {
        if (!still()) return;
        threads.setArchived((a) => (a[id] === n ? a : { ...a, [id]: n }));
      });
    }
    // 開對話＝真的看到了：推進本機已讀水位（ADR-0108，一律持久化）＋送已讀回條（ADR-0058 Tier 3，
    // 僅在回條開啟時）。未讀徽章由後端的 onUnread 推回，UI 不再自行歸零。
    backendRef.current?.markRead?.(id);
  };
  const back = (): void => {
    setScreen("main");
    threads.close();
  };
  /** 從歷史紀錄退回該對話（不是回主畫面）。 */
  const backToConvo = (): void => setScreen("conversation");
  const logout = (): void => {
    onLeave(); // ADR-0332 2b：先讓外殼放掉作用中身分（2c 之後這一步就是「卸載這個 session」）
    backendRef.current?.stop();
    backendRef.current = null;
    void stopForeground(); // ADR-0272：沒有連線要保了，撤掉常駐通知
    // ADR-0332 2c：`onLeave()` 讓 key 變成 `none` ⇒ 本元件重掛 ⇒ **所有 session state 與 ref
    // 都隨著卸載消失**（含 nsec、typing 計時器、狀態文字廣播計時器）。這裡只留真正的副作用：
    // 停後端、撤常駐通知。曾經在這裡的 `threads.reset()`／`self.clear()`／`clearTimeout` 已刪。
    setTab("chats");
    // 軟登出（ADR-0201）：只結束 session、保留身分於本機——有記住的身分回解鎖、否則回登入。
    // 破壞性的「移除此身分」＝forgetActive（另由設定的移除入口負責，ADR-0138 不變）。
    setScreen(activeProfile(profiles) ? "unlock" : "signin");
  };
  // 通知點擊（ADR-0116）：開啟該對話。掛載一次即可。
  useEffect(() => onNotifyClick((convo) => convo && openConvo(convo)), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 目前開啟的對話是不是群組。 */
  const isGroup = (id: string): boolean => groups.some((g) => g.id === id);

  const send = (text: string, mentions?: string[], replyTo?: string, ttlSeconds?: number): void => {
    if (!activeId) return;
    const b = backendRef.current;
    // **群組必須走 sendGroupMessage**：`groupId` 是 16 bytes hex（32 字元），**不是** pubkey。
    // 過去這裡一律呼叫 `sendMessage(activeId)`，而群組會出現在手機的聊天清單裡
    // → 點進群組送訊直接拋錯（`second arg must be public key`），訊息送不出去。
    // `mentions`＝@提及公鑰（ADR-0050／0133）；`replyTo`＝對話串根 id（ADR-0051／0136）；
    // 兩者皆隨 Gift Wrap 加密，中繼看不到社交圖譜/串結構。
    // `ttlSeconds`＝限時訊息（ADR-0057，1:1 才有）；群組扇出不帶 ttl（介面無此參數）。
    if (isGroup(activeId)) b?.sendGroupMessage?.(activeId, text, mentions, replyTo);
    else b?.sendMessage(activeId, text, ttlSeconds, mentions, replyTo);
  };
  /** 通知對方「正在輸入」（ADR-0120）：1:1 才送（群組不送 typing）。節流在對話畫面內。 */
  const sendTyping = (): void => {
    if (activeId && !isGroup(activeId)) backendRef.current?.sendTyping(activeId);
  };
  /** 破壞性/重要操作的二次確認：無 window.confirm（如 SSR）時照做，有則需使用者確認。回 true＝可繼續。 */
  const confirmAction = (key: MessageKey): boolean => {
    if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
    return window.confirm(translate(locale, key));
  };
  /**
   * 同上，但**取不到 confirm 就不做**（fail-closed）。
   *
   * `confirmAction` 的 fail-open 對「移除身分」那類操作可以接受（使用者已經在按了），
   * 但用在「啟用未經審計的加密功能」上，fail-open 等於**揭露被跳過**——
   * 而那句揭露是 ADR-0306 D1 的**驗收條件**，不是提示。安全操作的失敗方向應朝安全側。
   */
  const confirmRequired = (key: MessageKey): boolean => {
    if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
    return window.confirm(translate(locale, key));
  };
  /** 在某對話插入一則本機提示訊息（不上網、不落 relay），供 FS 相關警告使用。 */
  const pushFsNotice = (peer: string, key: MessageKey): void => {
    const msg: ChatMessage = {
      id: `fsn-${key}-${peer}-${Date.now()}`,
      outgoing: false,
      text: translate(localeRef.current, key),
      at: Date.now(),
    };
    threads.setConvos((c) => ({ ...c, [peer]: [...(c[peer] ?? []), msg] }));
  };
  /**
   * 移除此身分（ADR-0202，破壞性）：刪私鑰 blob、登錄，**以及該身分的本機資料**。
   *
   * 🔴 最後那項原本沒做：只呼叫 `forgetActive()`（＝刪 nsec blob ＋登錄），
   * `nb.<pubkey>.*` 整批留在 localStorage——與 ADR-0202 的決策
   * 「唯一能徹底移除身分的方式是**刪本機資料**」不符（桌面 `wipeIdentityLocal` 有做，行動端沒有）。
   * 而留著的不只是佔空間：`fsState` 以 `deriveStorageKey(nsec)` 加密，該導出是**決定性的**
   * ⇒ 同一把 nsec 再輸入一次就解得開，於是**一批本該被 grace 政策刪掉的 EK 私鑰被凍結保留**，
   * 在「nsec 日後外洩」這個 FS 正要防的情境下是實質削弱。
   */
  const removeActiveIdentity = (): void => {
    if (!confirmAction("settings_removeIdentityConfirm")) return;
    const target = activeProfile(profiles)?.pubkey;
    backendRef.current?.stop();
    backendRef.current = null;
    if (target) clearStorageNamespace(target);
    forgetActive();
  };
  /**
   * 移除某台裝置（ADR-0322 S3；ADR-0323 補上行動端入口）。
   *
   * 🔴 用 `confirmRequired`（fail-closed）而非 `confirmAction`：那段確認文案講的是**這個按鈕買不到什麼**
   * ——歷史救不回、保留期內仍讀得到、身分私鑰外洩時完全擋不住。跳過它就等於默許誤解，
   * 同 ADR-0306 D1 對「未經審計」揭露的處置。
   */
  const removeDeviceById = (id: string): void => {
    const pk = backendRef.current?.deviceDirectory?.()?.devices.find((d) => d.id === id)?.pk;
    if (!pk) return;
    if (!confirmRequired("devices_removeConfirm")) return;
    backendRef.current?.removeDevice?.(pk);
    settings.setDevices(backendRef.current?.devices?.() ?? []);
  };
  /**
   * 忘掉一筆觀測（ADR-0324）：只清本機紀錄。
   *
   * 用 `confirmAction`（fail-open）而非 `confirmRequired`——這個動作**不撤銷任何東西、不動金鑰**，
   * 確認文案只是說明它做得少，跳過它不會讓人誤以為自己更安全（與移除裝置的方向相反）。
   */
  const forgetDeviceById = (id: string): void => {
    if (!confirmAction("devices_forgetConfirm")) return;
    backendRef.current?.forgetDevice?.(id);
    settings.setDevices(backendRef.current?.devices?.() ?? []);
  };
  /** 清空裝置（ADR-0202，破壞性、不可逆）：刪所有身分＋所有本機資料，回全新狀態。輸入片語才執行。 */
  const wipeDevice = (): void => {
    const word = translate(locale, "wipe_confirmWord");
    if (typeof window !== "undefined" && typeof window.prompt === "function") {
      const typed = window.prompt(translate(locale, "wipe_confirm", { word }));
      if (typed === null) return;
      if (typed.trim().toUpperCase() !== word.toUpperCase()) {
        window.alert?.(translate(locale, "wipe_mismatch"));
        return;
      }
    } else if (!confirmAction("settings_wipeDeviceHint")) {
      return;
    }
    backendRef.current?.stop();
    backendRef.current = null;
    try {
      localStorage.clear();
    } catch {
      /* 略 */
    }
    setProfiles({ profiles: [], active: null });
    setScreen("signin");
  };
  /** 移除聯絡人（ADR-0121，非封鎖）：清掉該對話（含封存）。正在看就退回主畫面。 */
  const removeContact = (pubkey: string): void => {
    if (!confirmAction("contact_removeConfirm")) return;
    backendRef.current?.removeContact?.(pubkey);
    if (activeId === pubkey) back();
  };
  // 對話背景（ADR-0134）：純本地，寫 localStorage ＋ 即時反映到畫面（不廣播、不進雲端）。
  const applyChatBg = (bg: ChatBg): void => {
    if (!activeId) return;
    setChatBg(activeId, bg);
    setChatBgState(bg);
  };
  const clearChatBg = (): void => {
    if (!activeId) return;
    removeChatBg(activeId);
    setChatBgState(null);
  };
  // 改本地密碼（ADR-0135）：舊密碼解開記住的 nsec、新密碼重新包裹、落地到該身分的 blob（ADR-0138）。
  const changePassword = (oldPw: string, newPw: string): boolean => {
    if (!remembered) return false;
    const next = changeRememberedPassword(remembered, oldPw, newPw);
    if (!next) return false;
    if (!putRemembered(next)) return false;
    setProfiles({ ...profiles }); // 觸發重繪，讓 remembered 重新由 blob 導出
    return true;
  };
  // 設定/移除自己的廣播頭像（ADR-0154）：引擎落地＋加密廣播；回 false＝格式拒收。
  const changeAvatar = (uri: string | undefined): boolean => backendRef.current?.setSelfAvatar?.(uri) ?? false;
  // 更改顯示名稱（ADR-0144）：後端落地本機＋廣播給聯絡人（ADR-0061）；更新 self 與登錄/記住的 blob。
  const renameSelf = (name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === self.name) return true; // 空白或未變動：no-op，非錯誤
    // ADR-0146：改名不得撞到本機另一個可見身分（排除自己）——維持名稱唯一。
    if (nameTaken(profiles, trimmed, self.pubkey)) return false;
    backendRef.current?.setSelfName?.(trimmed);
    self.setName(trimmed);
    setProfiles(renameIdentity(profiles, self.pubkey, trimmed));
    return true;
  };
  const addContact = (npub: string): void => {
    const trimmed = npub.trim();
    // ADR-0055：不得把**自己的任何身分**加成聯絡人（跨身分交友是社交圖譜洩漏）。後端只擋作用中身分；
    // 多身分下（ADR-0138）連其他已註冊身分也一起擋（isOwnIdentity）。
    if (isOwnIdentity(profiles, trimmed)) return; // 自己的身分——靜默拒絕
    backendRef.current?.addContact?.(trimmed);
  };
  /** 對某訊息送 emoji 回應（NIP-25）。群組回應同樣以 rumor.id 為鍵（ADR-0107）。 */
  const react = (messageId: string, emoji: string): void => {
    if (activeId) backendRef.current?.sendReaction?.(activeId, messageId, emoji);
  };
  /** 收回自己送出的訊息（NIP-09）；`traceless`＝無痕收回（ADR-0234）。 */
  const unsend = (messageId: string, traceless?: boolean): void => {
    if (activeId) backendRef.current?.unsendMessage?.(activeId, messageId, traceless);
  };
  /** 封鎖／解除封鎖。封鎖會一併移出聯絡人並清掉該對話（含封存，ADR-0111）。 */
  const block = (pubkey: string): void => {
    backendRef.current?.blockContact?.(pubkey);
    if (activeId === pubkey) back(); // 正在看的對話被封鎖 → 退回主畫面
  };
  const unblock = (pubkey: string): void => backendRef.current?.unblockContact?.(pubkey);
  /**
   * 建立群組（ADR-0114）。群組**無共用金鑰**（ADR-0027）：對每位其他成員各包一個 Gift Wrap
   * 扇出——所以「成員清單」就是收件人清單。建立者自動是管理者。
   */
  // 人數上限（ADR-0303 A3）：引擎端會直接 return，UI 若不擋就變成「按了沒反應」。
  // 兩層都留：這裡是告知，引擎那道是防繞過，責任不同不算重複。
  const createGroup = (name: string, memberPubkeys: string[]): void => {
    if (groupSizeExceeded(memberPubkeys.length + 1)) {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(translate(localeRef.current, "group_tooManyMembers", { max: GROUP_MEMBERS_MAX }));
      }
      return;
    }
    backendRef.current?.createGroup?.(name, memberPubkeys);
  };
  // ── 配對搬家：送出端（ADR-0118）────────────────────────────────────────
  const [pairPhase, setPairPhase] = useState<PairPhase>({ kind: "idle" });
  /** SAS 裁示的 resolve（使用者按下「相符/不符」時呼叫）。 */
  const pairDecision = useRef<((ok: boolean) => void) | null>(null);

  /**
   * 開始配對（舊機／資料持有方）。
   *
   * **必須顯式傳入 identity**（ADR-0118）：行動端**從不持久化 nsec**（ADR-0112 紅線），
   * 所以 `storage.loadIdentity()` 是 null——不傳的話捆包會缺身分，新機收到才爆。
   */
  const startPairExport = (): void => {
    const store = storeRef.current;
    const nsec = backendRef.current?.selfNsec;
    if (!store || !relayUrl || !nsec) {
      setPairPhase({ kind: "error", message: translate(locale, "pairExport_needRelay") });
      return;
    }
    const { offer, key } = createPairingOffer(relayUrl);
    setPairPhase({ kind: "offer", code: offer.code, expiresAt: offer.expiresAt });
    void runPairSource({
      key,
      storage: store,
      identity: { nsec, name: self.name },
      // ADR-0322 S5：配對成功 ⇒ 新機隨 DONE 回傳裝置公鑰 ⇒ 直接授權它進裝置目錄。
      // 這一步在 SAS 人工比對之後，故授權憑證是「這場已確認過的配對」＝當期短期狀態
      // （ADR-0303 §4.4 的承重點），不是 nsec 這種長期祕密。
      onTargetDevice: (devicePk) => backendRef.current?.authorizeDevice?.(devicePk),
      profile: { relayUrl, ...(settings.cloudSync !== "off" ? { cloudSync: settings.cloudSync } : {}) },
      transport: webRtcPairTransport(webSocketConnector),
      // 資料量大時先告知「不支援續傳、斷了要整份重來」（ADR-0072／0305 §7）。
      // 位置在連線之前，使用者才來得及選時機（接電源、兩台放一起）。
      confirmLargeBundle: (mb) =>
        Promise.resolve(
          typeof window === "undefined" || typeof window.confirm !== "function"
            ? true // 沒有 confirm 就照舊進行——這只是提示，不是安全閘門（對比 confirmRequired）
            : window.confirm(translate(localeRef.current, "pair_largeBundleWarn", { mb })),
        ),
      // SAS 是這個流程的安全核心：**必須是使用者的明確裁示**，不能自動通過。
      confirmSas: (sas) =>
        new Promise<boolean>((resolve) => {
          setPairPhase({ kind: "sas", sas });
          pairDecision.current = (ok) => {
            pairDecision.current = null;
            setPairPhase(ok ? { kind: "sending" } : { kind: "idle" });
            resolve(ok);
          };
        }),
    }).then(
      (sent) => {
        if (sent) setPairPhase({ kind: "done" });
      },
      (e: Error) => setPairPhase({ kind: "error", message: e.message || "配對失敗" }),
    );
  };

  /** 敲一下（ADR-0114）：過去行動端只能收、不能發。 */
  const nudge = (): void => {
    if (activeId && !isGroup(activeId)) backendRef.current?.sendNudge(activeId);
  };
  const slotBusyRef = useRef(false);
  const changeOrgTitle = (title: string): void => {
    const trimmed = title.trim();
    org.setTitle(trimmed);
    backendRef.current?.setSelfTitle?.(trimmed || undefined); // 空＝移除（廣播移除記號）
  };
  const persistPresence = (status: Status, message: string): void => {
    if (self.pubkey) savePresence(self.pubkey, { status, statusMessage: message }); // ADR-0164：本機記住手動狀態
  };
  // ADR-0171：狀態文字廣播節流計時器。引擎 setStatus 是**同步廣播**（catch-up 語意依賴，不改），
  // 逐字打字若逐字 setStatus 會逐字打中繼/P2P、且把打到一半的文字廣播出去 → 在此 UI 層合併。
  const statusBcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeStatus = (v: Status): void => {
    self.setStatus(v);
    // 離散狀態變更＝立即廣播；併入任何待送的文字（清掉節流計時器，避免隨後又用舊狀態重播）。
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
    backendRef.current?.setStatus(v, self.statusMessage);
    persistPresence(v, self.statusMessage);
  };
  /** 改自訂狀態文字（ADR-0142／0168／0171）：本機即時記住；廣播停手 ~600ms 才送出一次（合併逐字）。 */
  const changeStatusMessage = (msg: string): void => {
    self.setStatusMessage(msg);
    persistPresence(self.status, msg); // 本機即時記住（localStorage 廉價、不節流→打到一半關 App 也不丟）
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
    statusBcTimer.current = setTimeout(() => backendRef.current?.setStatus(self.status, msg), 600);
  };
  /** 改「正在聽」（ADR-0142／0168）：隨心跳廣播；易失、不落地。 */
  const changeNowPlaying = (text: string): void => {
    const t = text.trim();
    self.setNowPlaying(t);
    backendRef.current?.setNowPlaying(t);
  };
  // ADR-0171 審查修正：卸載時清掉待觸發的狀態文字廣播計時器（typing 的計時器已隨對話簇搬走）。
  useEffect(() => () => {
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
  }, []);
  // 公司儲存槽背景傳輸（ADR-0161／0177，員工端）：企業主在線且佇列有待傳 → 逐一 P2P 送出。
  // 位元組已在佇列項（行動端 web 無路徑可重讀），故不需 async 讀檔（與桌面差異）。
  useEffect(() => {
    const admin = org.admin;
    const b = backendRef.current;
    if (!admin || !b?.depositFile || slotBusyRef.current) return;
    // 企業主必須在線（P2P 直送，不經中繼儲存）。admin 由名冊採用後成為聯絡人（ADR-0173）。
    if (!contacts.some((c) => c.pubkey === admin && c.status !== "offline")) return;
    const item = nextPending(org.slots);
    if (!item) return;
    slotBusyRef.current = true;
    org.updateSlots((q) => setSlotStatus(q, item.id, "sending"));
    try {
      b.depositFile(admin, { name: item.name, mime: item.mime, bytes: item.bytes }, item.origin);
      org.updateSlots((q) => completeSlot(q, item.id)); // 已交 P2P：標 done 並釋放位元組（ADR-0180）
    } catch {
      org.updateSlots((q) => setSlotStatus(q, item.id, "failed"));
    } finally {
      slotBusyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, org.slots, org.admin]);
  /**
   * 通知開關（ADR-0116）。**權限必須在使用者手勢裡請求**——瀏覽器會拒絕非手勢的
   * `Notification.requestPermission()`。使用者拒絕授權 → 開關不打開（不假裝成功）。
   */
  const setNotify = async (v: boolean): Promise<void> => {
    if (v && !(await notifier.ensurePermission())) return; // 拒絕授權 → 維持關閉
    setNotifyState(v);
    try {
      localStorage.setItem(NOTIFY_KEY, v ? "1" : "0");
    } catch {
      /* 忽略 */
    }
  };
  const setNotifyHide = (v: boolean): void => {
    setNotifyHideState(v);
    try {
      localStorage.setItem(NOTIFY_HIDE_KEY, v ? "1" : "0");
    } catch {
      /* 忽略 */
    }
  };

  const toggleInvisible = (v: boolean): void => {
    self.setInvisible(v);
    backendRef.current?.setInvisible?.(v);
  };
  // 送出檔案（ADR-0093/0100）：選檔 → P2P 位元組＋中繼 metadata；訊息由 backend 建立。
  const sendFileFromPicker = (): void => {
    const b = backendRef.current;
    const pk = activeIdRef.current;
    if (!b?.sendFile || !pk) return;
    const still = epochRef.current.mark(); // ADR-0329：挑檔/拍照期間切了身分 ⇒ 不要用舊後端送出
    void pickFile().then(async (f) => {
      if (!f || !still()) return;
      const thumb = await makeThumbnail(f.bytes, f.mime); // ADR-0102：只存本機、不外送
      // 行動端目前用 DOM <input>（無完整路徑）→ 不帶 savedPath；真 RN 的 document picker 會給 URI（ADR-0103）。
      b.sendFile?.(pk, f, thumb ? { thumb } : {});
    });
  };
  /** 拍照直接傳（ADR-0274）：開相機 → 清 EXIF（ADR-0273，在平台縫內） → 走與選檔同一條送出路徑。 */
  const sendPhotoFromCamera = (): void => {
    const b = backendRef.current;
    const pk = activeIdRef.current;
    if (!b?.sendFile || !pk) return;
    const still = epochRef.current.mark(); // ADR-0329：挑檔/拍照期間切了身分 ⇒ 不要用舊後端送出
    void takePhoto().then(async (f) => {
      if (!f || !still()) return;
      const thumb = await makeThumbnail(f.bytes, f.mime); // ADR-0102：只存本機、不外送
      b.sendFile?.(pk, f, thumb ? { thumb } : {});
    });
  };
  /**
   * 存入公司儲存槽（ADR-0161／0177，員工端）：**主動**挑一個檔 → 入 session 佇列（不是監控）。
   * 企業主上線由背景效果逐一 P2P 送出；企業主端靜默落盤（ADR-0161，不跳通知）。`origin`＝來源
   * 對話顯示名（供企業主端歸檔標註）。
   */
  const depositToSlot = (origin: string): void => {
    const still = epochRef.current.mark(); // ADR-0329：挑檔期間切了身分 ⇒ 這個檔不屬於新身分
    void pickFile().then((f) => {
      if (!f || !still()) return;
      org.updateSlots((q) =>
        enqueueSlot(q, { name: f.name, size: f.bytes.length, mime: f.mime, origin, bytes: f.bytes, queuedAt: Date.now() }),
      );
    });
  };
  /** 佇列管理（ADR-0180 審查修正）：重試全部失敗項；移除單項（含已完成／失敗，釋放記憶體）。 */
  const retrySlots = (): void => org.updateSlots((q) => retryFailed(q));
  const removeSlot = (id: string): void => org.updateSlots((q) => removeSlotItem(q, id));

  // 通話（ADR-0101）：發起／接聽／拒接／掛斷。
  const startCall = (media: CallMedia): void => {
    const pk = activeIdRef.current;
    if (pk) backendRef.current?.startCall?.(pk, media);
  };

  // 加密雲端備份（ADR-0071）：關閉時必須立即 purge——「已關閉」要即刻為真。
  const changeCloudSync = (mode: CloudSyncMode): void => {
    settings.setCloudSync(mode);
    // ADR-0327：寫進**這個身分**的登錄項，不再是裝置層的一把鑰匙開所有門。
    if (self.pubkey) saveCloudSyncFor(self.pubkey, mode);
    if (mode === "off") backendRef.current?.purgeCloudSnapshot?.(getDeviceId());
  };

  // 已讀回條開關（ADR-0058）：寫入偏好並即時推到後端。
  const toggleReadReceipts = (v: boolean): void => {
    setReadReceiptsState(v);
    try {
      localStorage.setItem(READ_RECEIPTS_KEY, v ? "1" : "0");
    } catch {
      /* 忽略 */
    }
    backendRef.current?.setReadReceipts?.(v);
  };
  // 保留上限（ADR-0094）：寫入偏好、即時套用到當前身分的儲存。
  const changeRetention = (n: number): void => {
    const v = Math.max(0, Math.floor(n));
    try {
      localStorage.setItem(RETENTION_KEY, String(v));
    } catch {
      /* 忽略 */
    }
    setRetentionCapState(v);
    storeRef.current?.setMaxPerConvo(v);
  };
  // 明文紀錄導出（ADR-0094）：導出全部對話，三種格式各下載一份（RN-web）。
  // 非同步：必須讀封存（ADR-0111），否則會靜默漏掉所有被封存的舊訊息。
  const exportAll = async (): Promise<void> => {
    const storage = storeRef.current;
    if (!storage) return;
    const stamp = new Date().toISOString().slice(0, 10);
    for (const fmt of ["txt", "md", "json"] as ExportFormat[]) {
      // eslint-disable-next-line no-await-in-loop -- 匯出需讀封存（非同步，ADR-0111）
      const text = await exportRecords(storage, fmt, { selfLabel: self.name || "我", now: Date.now() });
      downloadText(`cinder-紀錄-${stamp}.${exportExtension(fmt)}`, exportMime(fmt), text);
    }
  };
  const nameFor = (pk: string): string =>
    pk === self.pubkey ? self.name : contacts.find((c) => c.pubkey === pk)?.name ?? `${pk.slice(0, 8)}…`;

  const entries = useMemo(() => chatList(contacts, groups, convos, unread), [contacts, groups, convos, unread]);
  const unreadTotal = useMemo(() => Object.values(unread).reduce((a, b) => a + b, 0), [unread]);
  const mobileContacts = useMemo<MobileContact[]>(
    // ADR-0148：暱稱優先；ADR-0170：帶對方企業自報頭銜（有才帶，供 chip 顯示）。
    () => contacts.map((c) => ({ pubkey: c.pubkey, name: contactLabel(c), status: c.status, ...(c.title ? { title: c.title } : {}) })),
    [contacts],
  );
  // 便條金鑰（ADR-0183）：以作用中身分 nsec 導出，供便條加密落盤（每對話一張、只存本機）。
  const noteKey = useMemo(() => (self.nsec ? deriveStorageKey(nsecDecode(self.nsec)) : null), [self.nsec]);

  /**
   * 改畫質（ADR-0337）：**兩件事都要做**——寫回外殼（跨重啟記住、切身分不變）
   * 與推給後端（通話中即時生效）。只做前者的話，使用者在通話中調了卻沒有反應。
   */
  const changeVideoQuality = (q: VideoQuality): void => {
    setVideoQuality(q);
    backendRef.current?.setVideoQuality?.(q);
  };

  // 通話覆蓋層（ADR-0101）：來電/通話中一律蓋在最上層，不論當下在哪個畫面。
  const callOverlay = call.active ? (
    <CallScreen
      peerName={call.peer ? nameFor(call.peer) : ""}
      state={call.state}
      media={call.media}
      localStream={call.localStream}
      remoteStream={call.remoteStream}
      onAccept={() => backendRef.current?.acceptCall?.()}
      onReject={() => backendRef.current?.rejectCall?.()}
      onHangup={() => backendRef.current?.hangupCall?.()}
      quality={videoQuality}
      onQualityChange={changeVideoQuality}
      localMedia={call.localMedia}
      remoteMedia={call.remoteMedia}
      canChangeMedia={backendRef.current?.canChangeCallMedia?.() ?? false}
      onMediaChange={(m) => backendRef.current?.setCallMedia?.(m)}
      locale={locale}
      theme={theme}
      accent={accent}
    />
  ) : null;

  // 解鎖（ADR-0117）：記住的身分以 Argon2id 密碼包裹，開機需輸入密碼。
  if (screen === "unlock" && remembered) {
    return (
      <UnlockScreen
        name={remembered.name}
        onUnlock={(password) => {
          const r = unlockRemembered(remembered, password);
          if (!r.ok) return false; // 密碼錯／遭竄改（不區分）
          onEnter(r.identity);
          setScreen("main");
          return true;
        }}
        onUseNsec={() => setScreen("signin")}
        onForget={forgetActive}
        {...themeProps}
      />
    );
  }

  // 切換身分（ADR-0138）：解開待切換身分的密碼。同一個解鎖畫面，指向目標身分。
  if (screen === "switch" && pendingProfile) {
    return (
      <UnlockScreen
        name={pendingProfile.name}
        onUnlock={doSwitch}
        onUseNsec={() => {
          setPendingSwitch(null);
          setScreen("main");
        }}
        onForget={() => {
          setPendingSwitch(null);
          setScreen("main");
        }}
        {...themeProps}
      />
    );
  }

  // 新增身分（ADR-0138）：貼另一把 nsec／備份碼，設本地密碼記住 → 加入登錄並切過去。
  if (screen === "addIdentity") {
    return (
      <NsecSignInScreen
        onSignIn={(identity, password) => {
          handleSignIn(identity, password);
          setScreen("main");
          setTab("chats");
          threads.close();
        }}
        nameTaken={(name, pubkey) => nameTaken(profiles, name, pubkey)}
        onJoinOrg={joinOrg}
        onCreateCompany={createCompany}
        onBack={() => setScreen("main")}
        canRemember
        {...themeProps}
      />
    );
  }

  // 配對搬家——送出端（ADR-0118）：把這台的全部資料搬到新裝置。
  if (screen === "pairExport") {
    return (
      <PairExportScreen
        phase={pairPhase}
        onStart={startPairExport}
        onConfirmSas={(ok) => pairDecision.current?.(ok)}
        onCancel={() => setPairPhase({ kind: "idle" })}
        onBack={() => {
          setPairPhase({ kind: "idle" });
          setScreen("main");
        }}
        {...themeProps}
      />
    );
  }

  if (screen === "signin") {
    return (
      <NsecSignInScreen
        onSignIn={handleSignIn}
        onJoinOrg={joinOrg}
        onCreateCompany={createCompany}
        nameTaken={(name, pubkey) => nameTaken(profiles, name, pubkey)}
        onUsePairing={() => setScreen("pair")}
        canRemember
        {...themeProps}
      />
    );
  }
  if (screen === "pair") {
    return (
      <PairImportScreen
        // ADR-0118：接上真的 WebRTC。過去這裡是「配對需原生環境」的拋錯 stub——但行動端
        // **本來就有 WebRTC**（通話能用，ADR-0101），那個註解是舊的。
        onPair={(code, onSas) =>
          runPairTarget({ code, transport: webRtcPairTransport(webSocketConnector), onSas })
        }
        onImport={importFromOldDevice}
        onUseNsec={() => setScreen("signin")}
        {...themeProps}
      />
    );
  }
  // 歷史紀錄（ADR-0111）：讀封存的舊訊息（分頁，一次一塊）。
  const archiveOf = storeRef.current?.archiveOf?.();
  if (screen === "history" && activeId && archiveOf) {
    const group = groups.find((g) => g.id === activeId);
    const contact = contacts.find((c) => c.pubkey === activeId);
    return (
      <View style={shell.root}>
        <HistoryScreen
          name={group?.name ?? contact?.name ?? activeId}
          convo={activeId}
          archive={archiveOf}
          selfLabel={self.name || "我"}
          {...(group ? { nameFor } : {})}
          onBack={backToConvo}
          {...themeProps}
        />
      </View>
    );
  }

  // 連線狀態細條（ADR-0169）：只在真實 relay 且非 online 時顯示（示範模式無中繼、不顯示）。
  const connBanner =
    relayUrl && self.connection !== "online" ? (
      <View style={self.connection === "offline" ? bannerStyles.offline : bannerStyles.connecting}>
        <Text style={bannerStyles.text} testID="conn-banner">
          {translate(locale, self.connection === "offline" ? "conn_offline" : "conn_connecting")}
        </Text>
      </View>
    ) : null;

  if (screen === "conversation" && activeId) {
    const group = groups.find((g) => g.id === activeId);
    const contact = contacts.find((c) => c.pubkey === activeId);
    // 副標題：對方正在輸入（ADR-0120）最優先；群組＝成員數；1:1＝正在聽（♪）→ 自訂狀態文字
    // → 上線狀態（與桌面同序）。typing 是易失提示，6 秒無新訊號自動退回一般副標。
    const subtitle =
      !group && typingFrom === activeId
        ? translate(locale, "convo_typing", { name: contact ? contactLabel(contact) : "" })
        : group
          ? translate(locale, "group_membersCount", { count: group.members.length })
          : contact
            ? contact.nowPlaying?.trim()
              ? `♪ ${contact.nowPlaying}`
              : contact.statusMessage || translate(locale, STATUS_KEY[contact.status])
            : undefined;
    // 群組另傳成員名解析＋成員清單：供已讀分級（≤5 名單、6–10 計數、>10 不顯示，ADR-0095）。
    // 群組管理（ADR-0114）：任何成員都能離開；**只有管理者**能移除成員（ADR-0027）。
    const groupProps = group
      ? {
          nameFor,
          groupMembers: group.members,
          selfPubkey: self.pubkey,
          isGroupAdmin: group.admin === self.pubkey,
          // 群組 FS 狀態（ADR-0319）：只在啟用 FS 時提供——沒開的人不需要知道這個維度存在。
          ...(settings.fsEnabled && backendRef.current?.fsPeerState
            ? { fsPeerState: (pk: string) => backendRef.current!.fsPeerState!(pk) }
            : {}),
          // @提及候選（ADR-0133）：群組＝其他成員（排除自己）。
          mentionCandidates: group.members
            .filter((m) => m !== self.pubkey)
            .map((m) => ({ pubkey: m, name: nameFor(m) })),
          onLeaveGroup: () => {
            backendRef.current?.leaveGroup?.(group.id);
            back(); // 已經不是成員了，留在對話畫面沒有意義
          },
          onRemoveMember: (pk: string) => backendRef.current?.removeGroupMember?.(group.id, pk),
          // 新增成員（ADR-0170）：候選＝尚非成員的聯絡人；僅管理者且後端支援時才接上。
          ...(group.admin === self.pubkey && backendRef.current?.addGroupMember
            ? {
                onAddMember: (pk: string) => backendRef.current?.addGroupMember?.(group.id, pk),
                addMemberCandidates: contacts
                  .filter((c) => !group.members.includes(c.pubkey))
                  .map((c) => ({ pubkey: c.pubkey, name: contactLabel(c) })),
              }
            : {}),
        }
      : {};
    // @提及候選（ADR-0133）：1:1＝對方一人（群組候選已在 groupProps 內）。
    const dmMentionProps =
      !group && contact ? { mentionCandidates: [{ pubkey: contact.pubkey, name: contact.name }] } : {};
    // 本地暱稱（ADR-0148，1:1）：傳廣播名＋目前暱稱＋設定回呼；點標頭可切換、✎ 可設定/清除。
    const aliasProps =
      !group && contact && backendRef.current?.setContactAlias
        ? {
            broadcastName: contact.name,
            ...(contact.alias ? { alias: contact.alias } : {}),
            onSetAlias: (a: string | undefined) => backendRef.current?.setContactAlias?.(contact.pubkey, a),
          }
        : {};
    // 檔案：真實 relay 才有 P2P 傳輸（示範後端無 sendFile）。
    // 企業政策 disableFiles（ADR-0048／0311）：不傳 handler → 📎 與 📷 都不顯示（拍照亦是送檔）。
    const fileProps =
      backendRef.current?.sendFile && !org.policy.disableFiles
        ? { onSendFile: sendFileFromPicker, onSendPhoto: sendPhotoFromCamera } // ADR-0274：📷 拍照直傳
        : {};
    // 便條（ADR-0183）：有作用中身分金鑰（self.nsec 導出）＋activeId 才提供；讀/寫加密便條，App 層
    // 持金鑰、元件只碰明文。（金鑰只看 self.nsec，與是否示範後端無關——登入後恆有。）
    const noteProps =
      noteKey && activeId
        ? { onNoteLoad: () => loadNote(activeId, noteKey), onNoteSave: (text: string) => saveNote(activeId, noteKey, text) }
        : {};
    // 公司儲存槽（ADR-0161／0177）：企業成員（有企業主 pubkey）＋後端支援才顯示 🗄；origin＝對話名。
    const convoName = group ? group.name : contact ? contactLabel(contact) : activeId;
    const slotProps =
      org.enterprise && org.admin && backendRef.current?.depositFile ? { onDepositSlot: () => depositToSlot(convoName) } : {};
    // 通話：需真實後端＋平台具備 WebRTC（ADR-0101）；企業政策 disableCalls 時不提供（ADR-0311）。
    // 只擋**發起**——收到的來電照常可接（政策應由發起端的名冊決定，單方面拒接只會讓對方以為你不理他）。
    const callProps =
      backendRef.current?.startCall && hasCallSupport() && !org.policy.disableCalls ? { onStartCall: startCall } : {};
    // 貼圖（ADR-0311）：面板送出走共用的 onSend，沒有專屬 callback 可拿掉 → 以旗標設閘（同桌面）。
    const stickerProps = org.policy.disableStickers ? { stickersDisabled: true } : {};
    // 共享行程（ADR-0263／0265）：示範後端沒有 calendarPublish → 整個分頁不出現、日期也不偵測。
    // 群組 vs 1:1 由當前對話 id 是否為群組決定（與訊息路由同一判準）。
    const calProps = ((): Record<string, unknown> => {
      const publish = backendRef.current?.calendarPublish;
      if (!publish) return {};
      const target = group ? { groupId: activeId } : { contact: activeId };
      const mine = cal.eventsFor(activeId);
      const rsvp = backendRef.current?.calendarRsvp;
      return {
        calendar: mine,
        calendarNameFor: nameFor,
        onPickDate: (at: number) => cal.pickDate(activeId, at, Date.now()),
        // ADR-0331：`draftFor` 內含「是不是這個對話」的比對——呼叫端無從拿錯（見該檔說明）。
        ...(cal.draftFor(activeId) ? { calendarDraft: cal.draftFor(activeId)! } : {}),
        onCalendarPublish: (input: CalendarEventInput, opts?: { eventId?: string }) => {
          publish(target, input, opts?.eventId ? { action: "update", eventId: opts.eventId } : {});
        },
        onCalendarCancel: (eventId: string) => {
          // 取消只需指名目標；欄位帶原值以滿足型別（收端只看 action 與 e tag）。
          const e = mine.find((x) => x.id === eventId);
          if (!e) return;
          publish(target, { title: e.title, start: e.start }, { action: "cancel", eventId });
        },
        ...(rsvp ? { onCalendarRsvp: (id: string, status: RsvpStatus) => rsvp(id, status) } : {}),
        ...(backendRef.current?.calendarRemind
          ? {
              onCalendarRemind: (id: string, lead: number | undefined) =>
                backendRef.current?.calendarRemind?.(id, lead),
            }
          : {}),
      };
    })();
    return (
      <View style={shell.root}>
        {connBanner}
        <ConversationScreen
          // ADR-0169 審查修正：以 activeId 作 key，換對話（含從通知直接跳另一對話、screen 不變）
          // 時強制重掛，重置 ttl/draft/replyTarget/面板——避免燒毀效期殘留到別的對話。
          key={activeId}
          name={group ? group.name : contact ? contactLabel(contact) : activeId}
          // 無痕收回（ADR-0234）：進畫面前整行剔除（相簿/串/回覆數一致看不到）。
          messages={(convos[activeId] ?? []).filter((m) => !purged.has(m.id))}
          onSend={send}
          onBack={back}
          reactions={reactions}
          unsent={unsent}
          onReact={react}
          onUnsend={unsend}
          // 行程的主揪權威要在 1:1 也判得出來（groupProps 只在群組帶 self.pubkey）——
          // 少了它，自己開的 1:1 行程會顯示成別人的，變成「改不動自己的行程」。
          selfPubkey={self.pubkey}
          {...aliasProps}
          {...(!group && contact?.title ? { title: contact.title } : {})}
          {...(subtitle ? { subtitle } : {})}
          {...(relayUrl && !group ? { onNudge: nudge, onTyping: sendTyping } : {})}
          {...((archived[activeId] ?? 0) > 0 ? { onHistory: () => setScreen("history") } : {})}
          chatBg={chatBg}
          onSetChatBg={applyChatBg}
          onClearChatBg={clearChatBg}
          {...groupProps}
          {...dmMentionProps}
          {...fileProps}
          {...noteProps}
          {...calProps}
          {...slotProps}
          {...callProps}
          {...stickerProps}
          {...themeProps}
        />
        {callOverlay}
      </View>
    );
  }

  // 組織名冊管理（ADR-0178，企業主）：建立公司後或設定入口進入；發布名冊、複製邀請碼、設公司設定。
  if (screen === "roster" && org.owner) {
    const rosterDoc = backendRef.current?.currentRoster?.() ?? null;
    // 離職＝在託管中但不在現行名冊在世成員（ADR-0163／0179）。
    const liveMembers = new Set((rosterDoc?.members ?? []).filter((m) => !m.supersededBy).map((m) => m.pubkey));
    const offboarded = offboardedEntries(org.escrow, liveMembers);
    return (
      <RosterAdminScreen
        selfNpub={self.npub}
        onPublish={(org, members, policy, profile) =>
          backendRef.current?.publishRoster?.(org, members, policy, undefined, profile) ?? []
        }
        onBack={() => setScreen("main")}
        {...(org.inviteToken && relayUrl
          ? { invite: { relayUrl, adminPubkey: self.pubkey, token: org.inviteToken } }
          : {})}
        initial={rosterDoc}
        offboarded={offboarded.map((e) => ({ pubkey: e.pubkey, name: e.name }))}
        onTakeover={(pubkey) => {
          const e = org.escrow.find((x) => x.pubkey === pubkey);
          if (e) takeoverOffboarded(e);
        }}
        onDeleteEscrow={deleteEscrow}
        {...themeProps}
      />
    );
  }

  // 主畫面：分頁內容 + 底部分頁列。
  return (
    <View style={shell.root}>
      {connBanner}
      {tab === "chats" ? (
        <ChatsListScreen
          entries={entries}
          convos={convos}
          onOpen={openConvo}
          {...(relayUrl
            ? {
                onAddContact: addContact,
                // ADR-0281：出示分享字串 `npub…@wss://…`（帶中繼提示，ADR-0034）而非裸 npub
                // ——與桌面 QR 同一種內容，掃到的人才拿得到路由提示。無 home relay 時退回裸 npub。
                selfNpub: backendRef.current?.selfShareUri ?? self.npub,
                // ADR-0284：只進 QR，不進複製的純文字。
                selfName: self.name,
                // 建立群組（ADR-0114）：只有真實 relay 才有（示範後端無群組扇出）。
                onCreateGroup: createGroup,
                contacts: contacts.map((c) => ({ pubkey: c.pubkey, name: c.name })),
                // 自己的狀態列（ADR-0278）：改狀態是高頻操作，擺在聊天頁頂部而非只在設定分頁。
                // 示範後端無 presence 可廣播，故與其他真實 relay 功能同一個閘。
                self: {
                  name: self.name,
                  status: self.status,
                  onStatus: changeStatus,
                  statusMessage: self.statusMessage,
                  onStatusMessage: changeStatusMessage,
                  // 更換頭像（ADR-0283）：與設定分頁同一個 changeAvatar，不另開路徑。
                  onAvatar: changeAvatar,
                  invisible: self.invisible,
                  ...(() => {
                    const av = backendRef.current?.selfAvatar?.();
                    return av ? { avatar: av } : {};
                  })(),
                },
              }
            : {})}
          {...themeProps}
        />
      ) : tab === "contacts" ? (
        <ContactListScreen
          selfPubkey={self.pubkey}
          selfName={self.name}
          contacts={mobileContacts}
          onOpen={openConvo}
          onBlock={block}
          onRemove={removeContact}
          blocked={blocked}
          onUnblock={unblock}
          requests={requests}
          onAcceptRequest={(pk) => backendRef.current?.acceptRequest?.(pk)}
          onDeclineRequest={(pk) => {
            backendRef.current?.declineRequest?.(pk);
            threads.setConvos((c) => {
              const { [pk]: _drop, ...rest } = c;
              return rest;
            });
          }}
          onClearRequests={() => {
            // 全部刪除（ADR-0127 防洪）：清空請求區與相關對話快取。
            const reqPks = new Set(requests.map((r) => r.pubkey));
            backendRef.current?.clearRequests?.();
            threads.setConvos((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !reqPks.has(k))));
          }}
          {...themeProps}
        />
      ) : (
        <SettingsScreen
          selfName={self.name}
          onRename={renameSelf}
          selfNpub={self.npub}
          selfNsec={self.nsec}
          relayUrl={relayUrl}
          theme={theme}
          onTheme={setTheme}
          locale={locale}
          onLocale={setLocale}
          accent={accent}
          onAccent={setAccent}
          invisible={self.invisible}
          onInvisible={toggleInvisible}
          orgPolicy={org.policy}
          {...(relayUrl
            ? {
                status: self.status,
                onStatus: changeStatus,
                statusMessage: self.statusMessage,
                onStatusMessage: changeStatusMessage,
                nowPlaying: self.nowPlaying,
                onNowPlaying: changeNowPlaying,
                // 企業自報頭銜（ADR-0170／0172）：**企業/企業主身分才顯示編輯器**（與桌面設閘一致；
                // 旗標來自配對搬家捆包），且需真實 relay 後端（setSelfTitle 廣播個人檔）。
                ...(org.enterprise && backendRef.current?.setSelfTitle ? { title: org.title, onSetTitle: changeOrgTitle } : {}),
                // 組織名冊管理（ADR-0178）：企業主＋後端支援才顯示入口。
                ...(org.owner && backendRef.current?.publishRoster ? { onOpenRoster: () => setScreen("roster") } : {}),
                // 公司儲存槽佇列（ADR-0180）：有排隊項才顯示管理（狀態/移除/重試）。
                ...(org.slots.length > 0
                  ? {
                      slotQueue: org.slots.map((s) => ({ id: s.id, name: s.name, status: s.status })),
                      onSlotRetry: retrySlots,
                      onSlotRemove: removeSlot,
                    }
                  : {}),
                onPairExport: () => setScreen("pairExport"),
                notify,
                onNotify: (v: boolean) => void setNotify(v),
                notifyHidePreview: notifyHide,
                onNotifyHidePreview: setNotifyHide,
                // 背景保持連線（ADR-0272/0274）：僅原生殼提供 → 瀏覽器預覽不顯示此開關。
                ...(foregroundSupported()
                  ? {
                      foreground: fgOn,
                      onForeground: (on: boolean) => {
                        setForegroundEnabled(on);
                        setFgOn(on);
                        if (on) {
                          void startForeground(translate(locale, "fg_title"), translate(locale, "fg_text"));
                        } else {
                          void stopForeground();
                        }
                      },
                    }
                  : {}),
                retention: retentionCap,
                onRetention: changeRetention,
                onExport: exportAll,
                readReceipts,
                onReadReceipts: toggleReadReceipts,
                // ADR-0337：預設畫質；通話中另有即時切換（CallScreen）。
                videoQuality,
                onVideoQuality: changeVideoQuality,
                ...(settings.devices.length > 0 ? { devices: settings.devices } : {}),
                // ADR-0322 S2：撤銷三態；行動端只呈現狀態，移除入口留桌面。
                ...(backendRef.current?.revocationState
                  ? { revocation: backendRef.current.revocationState() }
                  : {}),
                ...(backendRef.current?.selfDevicePk
                  ? { selfDevicePk: backendRef.current.selfDevicePk() }
                  : {}),
                ...(backendRef.current?.deviceKeyTier
                  ? { deviceKeyTier: backendRef.current.deviceKeyTier() }
                  : {}),
                ...(backendRef.current?.deviceKeyEverPlaintext?.()
                  ? { deviceKeyEverPlaintext: true }
                  : {}),
                // ADR-0323：行動端的移除入口。過去 S3 只做在桌面，等於「手機丟了要開電腦才撤銷得掉」
                // ——而手機正是最常掉的那一台。
                ...(backendRef.current?.removeDevice
                  ? { onRemoveDevice: (id: string) => removeDeviceById(id) }
                  : {}),
                // ADR-0324：不在目錄內的觀測沒有 pk，撤銷對它們是靜默無效的；改給這個。
                ...(backendRef.current?.forgetDevice
                  ? { onForgetDevice: (id: string) => forgetDeviceById(id) }
                  : {}),
                // ADR-0317：入群邀請閘門。值在跨裝置同步設定裡（身分層級的隱私決定），故取自後端。
                ...(backendRef.current?.setGroupInviteFromAnyone
                  ? {
                      groupInviteFromAnyone: settings.groupInviteAnyone,
                      onGroupInvite: (v: boolean) => {
                        backendRef.current?.setGroupInviteFromAnyone?.(v);
                        settings.setGroupInviteAnyone(v);
                      },
                    }
                  : {}),
                // 前向保密（ADR-0245／0306 D1）：實驗性、預設關。引擎層與桌面共用
                // 同一個 RelayChatBackend，故此處只是接線；`enableFs` 缺席＝這個後端
                // 不支援（如瀏覽器示範），區塊自動不顯示。
                // ⚠ 兩個確認都用 **fail-closed** 的 `confirmRequired`：拿不到 confirm
                // 就不做。啟用那顆是 ADR-0306 D1 的驗收條件（揭露不得被跳過）；
                // 換鑰那顆會讓在途訊息收不到（ADR-0245），兩者都不該 fail-open。
                ...(backendRef.current?.enableFs
                  ? {
                      fs: {
                        enabled: settings.fsEnabled,
                        ...(settings.fsFailures.count > 0 ? { undecryptable: settings.fsFailures } : {}),
                        onEnable: () => {
                          if (!confirmRequired("fs_enableConfirm")) return;
                          backendRef.current?.enableFs?.();
                          settings.setFsEnabled(true);
                        },
                        onRotate: () => {
                          if (!confirmRequired("fs_rotateConfirm")) return;
                          backendRef.current?.rotateEncryptionKey?.();
                        },
                        // ADR-0314：停用＝廣播明示退場；確認文案講清楚會發生什麼。
                        onDisable: () => {
                          if (!confirmRequired("fs_disableConfirm")) return;
                          backendRef.current?.disableFs?.();
                          settings.setFsEnabled(false);
                        },
                      },
                    }
                  : {}),
                cloudSync: settings.cloudSync,
                onCloudSync: changeCloudSync,
                // 加密備份碼（ADR-0070）：需 relay（信封含 home relay）＋在手的 nsec。
                onMakeBackupCode: (pw: string) => makeBackupCode(self.nsec, relayUrl, pw),
                // 多身分（ADR-0138）：切換器列出已記住的身分，可切換/新增。
                identities: visibleProfiles(profiles).map((p) => ({
                  pubkey: p.pubkey,
                  name: p.name,
                  active: p.pubkey === self.pubkey,
                })),
                onSwitchIdentity: beginSwitch,
                onAddIdentity: () => setScreen("addIdentity"),
                // 頭像（ADR-0154）：真實 relay 模式才有廣播意義（示範後端僅記憶體）。
                onAvatar: changeAvatar,
                ...(() => {
                  const av = backendRef.current?.selfAvatar?.();
                  return av ? { selfAvatar: av } : {};
                })(),
              }
            : {})}
          {...(remembered ? { onChangePassword: changePassword } : {})}
          onLogout={logout}
          onRemoveIdentity={removeActiveIdentity}
          onWipeDevice={wipeDevice}
        />
      )}
      {/* ADR-0286：聯絡人分頁帶待處理好友請求數——否則請求靜靜躺在那裡沒人知道。 */}
      <BottomTabs
        active={tab}
        onSelect={setTab}
        unreadTotal={unreadTotal}
        requestCount={requests.length}
        {...themeProps}
      />
      {callOverlay}
    </View>
  );
}
