// 行動端 app 殼與導覽（ADR-0085/0086/0087）：登入→底部分頁（聊天／聯絡人／設定）→點擊開對話（push）。
// 接 @cinder/engine 的 ChatBackend（示範或真實 relay，見 backend.ts）；主題/主色/語言由本殼掌管，
// 設定分頁即時切換。正式版把後端換成注入 RelayChatBackend＋原生安全儲存即可（同一套 UI）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppStorage, ChatBackend, ChatMessage, CloudSyncMode, ConnectionState, Contact, Group, OrgInfo, Status } from "@cinder/engine";
import {
  applyPairBundle,
  exportExtension,
  exportMime,
  type ExportFormat,
  exportRecords,
  getDeviceId,
  LocalStorage,
  openOpfsArchive,
  type PairBundle,
  shouldMuteOrgNotification,
} from "@cinder/engine";
import { makeBackupCode, nsecDecode } from "@cinder/core";
import {
  contactLabel,
  createPairingOffer,
  notificationFor,
  runPairSource,
  runPairTarget,
  webRtcPairTransport,
  webSocketConnector,
} from "@cinder/engine";
import { notifier, onNotifyClick } from "./native/notify.js";
import type { BlockedContact, ContactRequest } from "@cinder/engine";
import type { CallMedia, CallState } from "@cinder/core";
import { makeThumbnail, pickFile, saveFile } from "./native/files.js";
import { hasCallSupport } from "./native/call-media.js";
import { CallScreen } from "./screens/CallScreen.js";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import type { ChatBg, Theme } from "@cinder/theme";
import { getChatBg, removeChatBg, setChatBg } from "./personalize.js";
import { StyleSheet, Text, View } from "react-native-web";
import { changeRememberedPassword, type MobileIdentity, unlockRemembered } from "./auth.js";
import {
  activeProfile,
  getRemembered,
  isOwnIdentity,
  loadIdentities,
  nameTaken,
  profileOrg,
  type ProfilesState,
  putRemembered,
  rememberInProfile,
  removeIdentity,
  renameIdentity,
  switchActive,
  visibleProfiles,
} from "./identities.js";
import { createBackend } from "./backend.js";
import { loadPresence, savePresence } from "./presence.js";
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
  | "history";

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

// 加密雲端備份（ADR-0071）：裝置本地偏好；off／basic／full。
const CLOUD_SYNC_KEY = "nb.cloudSync";
/** 通知設定（ADR-0116）：開關與「隱藏預覽」。 */
const NOTIFY_KEY = "nb.notify";
const NOTIFY_HIDE_KEY = "nb.notifyHidePreview";
// 「記住我」（ADR-0117）＋多身分（ADR-0138）：每身分一份 Argon2id 包裹的 nsec，登錄見
// identities.ts。**絕不明文存 nsec**（ADR-0112 紅線）。
function readCloudSync(): CloudSyncMode {
  try {
    const v = localStorage.getItem(CLOUD_SYNC_KEY);
    return v === "basic" || v === "full" ? v : "off";
  } catch {
    return "off";
  }
}

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

export function MobileApp({
  relayUrl = null,
  initialTheme = "light",
  initialLocale = "zh-Hant",
  initialAccent = null,
}: {
  /** 真實中繼站網址（wss://…）；null＝示範後端（ADR-0086）。 */
  relayUrl?: string | null;
  initialTheme?: Theme;
  initialLocale?: Locale;
  initialAccent?: string | null;
}): JSX.Element {
  /** 身分登錄（多身分，ADR-0138）：開機載入（含舊單一身分遷移）。 */
  const [profiles, setProfiles] = useState<ProfilesState>(() => loadIdentities(relayUrl ?? ""));
  /** 作用中身分的登錄項；其密碼包裹 blob 供解鎖／改密碼。 */
  const activeReg = activeProfile(profiles);
  const remembered = activeReg ? getRemembered(activeReg.pubkey) : null;
  const [screen, setScreen] = useState<Screen>(() => (activeProfile(profiles) ? "unlock" : "signin"));
  /** 切換身分時，待解鎖的目標 pubkey（ADR-0138）。 */
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("chats");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [accent, setAccent] = useState<string | null>(initialAccent);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [convos, setConvos] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  /** 有封存的對話（ADR-0111）：只有真的有封存才顯示「歷史紀錄」入口。 */
  const [archived, setArchived] = useState<Record<string, number>>({});
  /** emoji 回應（NIP-25）：訊息 id → emoji 清單。後端 start() 會回放既有的。 */
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  /** 已收回的訊息（NIP-09）。收回是**隱私**功能——不同步的話，在桌面收回的訊息會留在手機上。 */
  const [unsent, setUnsent] = useState<Set<string>>(new Set());
  /** 封鎖名單：被封鎖者的訊息不再收，且移出聯絡人。 */
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  /** 訊息請求（ADR-0121）：陌生人傳來訊息但尚未接受。**不是聯絡人**。 */
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  /** 通知（ADR-0116）：預設關（需使用者明確授權）。 */
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
  const [activeId, setActiveId] = useState<string | null>(null);
  // 對話背景（ADR-0134，本地個人化）：開對話時載入該對話的偏好，換對話時更新。
  const [chatBg, setChatBgState] = useState<ChatBg | null>(null);
  const [selfPubkey, setSelfPubkey] = useState("");
  const [selfName, setSelfName] = useState("");
  const [selfNpub, setSelfNpub] = useState("");
  const [selfNsec, setSelfNsec] = useState("");
  const [invisible, setInvisible] = useState(false);
  const [retentionCap, setRetentionCapState] = useState<number>(() => readRetentionCap());
  const [readReceipts, setReadReceiptsState] = useState<boolean>(() => readReadReceipts());
  const [cloudSync, setCloudSyncState] = useState<CloudSyncMode>(() => readCloudSync());
  // 通話（ADR-0101）：媒體全程 P2P，不經中繼。
  const [callPeer, setCallPeer] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callMedia, setCallMedia] = useState<CallMedia | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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
    signInWith(identity);
  };

  // ── 多身分切換（ADR-0138）─────────────────────────────────────────────────
  /** 點切換器裡的某身分：同一個＝忽略；不同＝進切換解鎖畫面解該身分的密碼。 */
  const beginSwitch = (pubkey: string): void => {
    if (pubkey === selfPubkey) return; // 已是作用中
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
    setActiveId(null);
    signInWith(r.identity); // 換命名空間＝資料天然隔離（ADR-0138）
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
    signInWith(identity, bundle);
  };

  const signInWith = (identity: MobileIdentity, bundle?: PairBundle): void => {
    backendRef.current?.stop();
    // ADR-0094：真實 relay 用外部持有的儲存（供保留上限/導出）；示範模式無持久化。
    // ADR-0112：靜態加密——資料金鑰由 nsec 導出。行動端**從不持久化 nsec**（每次輸入），
    // 所以金鑰不在磁碟上 → localStorage/OPFS 上的訊息**真的**解不開。
    const sk = nsecDecode(identity.nsec);
    const store = relayUrl ? new LocalStorage(identity.pubkey, readRetentionCap(), sk) : null;
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
    // ADR-0173／0174：企業身分精華——配對當下取捆包 org；重啟解鎖則取**已記住的登錄 Profile**
    // （rememberInProfile 已把 org 寫進登錄）＝跨重啟持久。兩者皆無＝一般身分。
    const org = bundle?.org ?? profileOrg(profiles.profiles.find((p) => p.pubkey === identity.pubkey));
    const backend = createBackend(identity, relayUrl, {
      store: store ?? undefined,
      cloudSync,
      ...(pref ? { initialStatus: pref.status, initialStatusMessage: pref.statusMessage } : {}),
      // ADR-0173：企業身分 → 後端唯讀採用公司名冊（同事/allowlist/政策/組織資訊）。
      ...(org ? { org } : {}),
    });
    backendRef.current = backend;
    setSelfStatus(pref?.status ?? "online");
    setSelfStatusMessage(pref?.statusMessage ?? "");
    setSelfNowPlaying("");
    setOrgTitle(backend.selfTitle?.() ?? ""); // ADR-0170：還原這個身分已廣播的頭銜（供設定頁預填）
    // ADR-0172／0174：企業身分旗標＝配對捆包 org 或已記住登錄的 org（跨重啟持久）；一般身分＝false。
    setSelfEnterprise(!!(org?.enterprise || org?.orgOwner));
    setConnState("connecting"); // ADR-0169：換身分重連，先回連線中，待後端回報 online
    // ADR-0169 審查修正：換身分清掉殘留的 typing 狀態與計時器（衛生性，避免舊值誤帶到新身分）。
    setTypingFrom(null);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current); // ADR-0171：別把上個身分待送的狀態文字帶過來
    orgInfoRef.current = null; // ADR-0157/0175：清上個身分的組織資訊（下次 onOrgInfo 重設）
    setSelfPubkey(identity.pubkey);
    setSelfName(identity.name);
    setSelfNpub(identity.npub);
    setSelfNsec(identity.nsec);
    setContacts([]);
    setGroups([]);
    setConvos({});
    setReactions({});
    setUnsent(new Set());
    setBlocked([]);
    setRequests([]);
    setUnread({});
    backend.start({
      onContacts: setContacts,
      onGroups: setGroups,
      onHistory: (pk, msgs) => setConvos((c) => ({ ...c, [pk]: msgs })),
      onMessage: (pk, m) => {
        setConvos((c) => {
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
      onUnread: setUnread,
      onReaction: (messageId, emoji) =>
        setReactions((prev) => {
          const cur = prev[messageId] ?? [];
          if (cur.includes(emoji)) return prev;
          return { ...prev, [messageId]: [...cur, emoji] };
        }),
      onUnsend: (messageId) =>
        setUnsent((prev) => {
          if (prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.add(messageId);
          return next;
        }),
      onBlocked: setBlocked,
      onRequests: setRequests, // ADR-0121
      // 送出狀態（ADR-0095）：與桌面同一套（傳送中/失敗/已送出/已送達/已讀）→ 氣泡旁圖示。
      onMessageStatus: (pk, messageId, status) =>
        setConvos((c) => {
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
        setConvos((c) => {
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
        setConvos((c) => {
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
        setConvos((c) => {
          const cur = c[pk];
          if (!cur) return c;
          return {
            ...c,
            [pk]: cur.map((m) => (m.id === messageId && m.file ? { ...m, file: { ...m.file, thumb } } : m)),
          };
        }),
      // ADR-0071：還原時採用快照傳播的備份模式（僅本機從未設定時）。
      onCloudSyncMode: (mode) => {
        if (readCloudSync() === "off") changeCloudSync(mode);
      },
      // ADR-0173：後端採用公司名冊（企業身分）→ **實際會員身分確認**（比捆包旗標更穩健的設閘訊號）。
      // 同事/allowlist/政策由引擎的 onContacts/onPolicy 與保留天數（引擎內部）自動帶入。
      // ADR-0157（行動端 ADR-0175 補齊）：存工時＋成員供下班靜音；歡迎詞變更時顯示一次。
      onOrgInfo: (info) => {
        setSelfEnterprise(true);
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
      // 通話狀態與串流（ADR-0101）：來電自動開通話畫面。
      onCallState: (peer, state, media) => {
        setCallState(state);
        setCallMedia(media);
        if (state === "idle" || state === "ended") {
          setCallPeer(null);
          setLocalStream(null);
          setRemoteStream(null);
        } else {
          setCallPeer(peer);
        }
      },
      onCallLocalStream: setLocalStream,
      onCallRemoteStream: setRemoteStream,
      // 對方正在輸入（ADR-0120；行動端於 ADR-0169 補齊）：記下來源，對話副標顯示「正在輸入…」。
      onTyping: (pk) => markTyping(pk),
      // 與中繼站連線狀態（ADR-0034；行動端於 ADR-0169 補齊）：非 online 時頂端顯示細條。
      onConnection: (state) => setConnState(state),
      // 敲一下（ADR-0114）：收到就震動（行動端於 ADR-0168 補齊）。裝置不支援 Vibration API
      // （多數桌面瀏覽器、iOS Safari）時靜默略過——不是錯誤，只是沒有觸覺回饋。
      onNudge: () => {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate([120, 60, 120]);
        }
      },
    });
    backend.setReadReceipts?.(readReceipts); // ADR-0058：互惠開關（關＝不送也不顯示對方已讀）
    setTab("chats");
    setScreen("main");
  };

  const openConvo = (id: string): void => {
    setActiveId(id);
    setChatBgState(getChatBg(id)); // 載入該對話的背景偏好（ADR-0134）
    setScreen("conversation");
    // ADR-0111：查這個對話有沒有封存（決定要不要顯示「歷史紀錄」入口）。非同步、不擋畫面。
    const arch = storeRef.current?.archiveOf?.();
    if (arch) void arch.chunkCount(id).then((n) => setArchived((a) => (a[id] === n ? a : { ...a, [id]: n })));
    // 開對話＝真的看到了：推進本機已讀水位（ADR-0108，一律持久化）＋送已讀回條（ADR-0058 Tier 3，
    // 僅在回條開啟時）。未讀徽章由後端的 onUnread 推回，UI 不再自行歸零。
    backendRef.current?.markRead?.(id);
  };
  const back = (): void => {
    setScreen("main");
    setActiveId(null);
  };
  /** 從歷史紀錄退回該對話（不是回主畫面）。 */
  const backToConvo = (): void => setScreen("conversation");
  const logout = (): void => {
    backendRef.current?.stop();
    backendRef.current = null;
    setTab("chats");
    setActiveId(null);
    setInvisible(false);
    // ADR-0169/0171 審查修正：登出也顯式清掉殘留的 typing 與狀態文字廣播計時器（與 signInWith 對稱）。
    setTypingFrom(null);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
    // 登出＝移除這個身分並清其密文（ADR-0138）；還有其他身分就去解下一個，沒有了才回登入。
    forgetActive();
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
  /** 移除聯絡人（ADR-0121，非封鎖）：清掉該對話（含封存）。正在看就退回主畫面。 */
  const removeContact = (pubkey: string): void => {
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(translate(locale, "contact_removeConfirm"))) {
      return;
    }
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
    setProfiles((p) => ({ ...p })); // 觸發重繪，讓 remembered 重新由 blob 導出
    return true;
  };
  // 設定/移除自己的廣播頭像（ADR-0154）：引擎落地＋加密廣播；回 false＝格式拒收。
  const changeAvatar = (uri: string | undefined): boolean => backendRef.current?.setSelfAvatar?.(uri) ?? false;
  // 更改顯示名稱（ADR-0144）：後端落地本機＋廣播給聯絡人（ADR-0061）；更新 self 與登錄/記住的 blob。
  const renameSelf = (name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === selfName) return true; // 空白或未變動：no-op，非錯誤
    // ADR-0146：改名不得撞到本機另一個可見身分（排除自己）——維持名稱唯一。
    if (nameTaken(profiles, trimmed, selfPubkey)) return false;
    backendRef.current?.setSelfName?.(trimmed);
    setSelfName(trimmed);
    setProfiles((prev) => renameIdentity(prev, selfPubkey, trimmed));
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
  /** 收回自己送出的訊息（NIP-09）。 */
  const unsend = (messageId: string): void => {
    if (activeId) backendRef.current?.unsendMessage?.(activeId, messageId);
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
  const createGroup = (name: string, memberPubkeys: string[]): void =>
    backendRef.current?.createGroup?.(name, memberPubkeys);
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
      identity: { nsec, name: selfName },
      profile: { relayUrl, ...(cloudSync !== "off" ? { cloudSync } : {}) },
      transport: webRtcPairTransport(webSocketConnector),
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
  /** 上線狀態（ADR-0114）。隱身優先——隱身時後端完全不廣播（ADR-0088）。 */
  const [selfStatus, setSelfStatus] = useState<Status>("online");
  /** 自訂狀態文字（ADR-0142；行動端於 ADR-0168 補齊）：隨心跳廣播、本機持久化。 */
  const [selfStatusMessage, setSelfStatusMessage] = useState("");
  /** 正在聽（ADR-0142；行動端於 ADR-0168 補齊）：純易失，不持久化（換歌就換）。 */
  const [selfNowPlaying, setSelfNowPlaying] = useState("");
  /**
   * 是不是企業/企業主身分（ADR-0172）：行動端本身無入職流程，故此旗標**只**來自配對搬家捆包的
   * org 精華（工作身分從桌面搬來時帶）。決定要不要顯示企業專屬 UI（目前＝頭銜編輯器）。
   * 非企業身分（一般個人、示範）恒為 false → 不顯示頭銜編輯（與桌面設閘語意一致）。
   */
  const [selfEnterprise, setSelfEnterprise] = useState(false);
  /** 企業自報頭銜（ADR-0158；行動端於 ADR-0170 補齊）：≤24 字，變更即全量重播個人檔給聯絡人。 */
  const [orgTitle, setOrgTitle] = useState("");
  const changeOrgTitle = (title: string): void => {
    const trimmed = title.trim();
    setOrgTitle(trimmed);
    backendRef.current?.setSelfTitle?.(trimmed || undefined); // 空＝移除（廣播移除記號）
  };
  const persistPresence = (status: Status, message: string): void => {
    if (selfPubkey) savePresence(selfPubkey, { status, statusMessage: message }); // ADR-0164：本機記住手動狀態
  };
  // ADR-0171：狀態文字廣播節流計時器。引擎 setStatus 是**同步廣播**（catch-up 語意依賴，不改），
  // 逐字打字若逐字 setStatus 會逐字打中繼/P2P、且把打到一半的文字廣播出去 → 在此 UI 層合併。
  const statusBcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeStatus = (v: Status): void => {
    setSelfStatus(v);
    // 離散狀態變更＝立即廣播；併入任何待送的文字（清掉節流計時器，避免隨後又用舊狀態重播）。
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
    backendRef.current?.setStatus(v, selfStatusMessage);
    persistPresence(v, selfStatusMessage);
  };
  /** 改自訂狀態文字（ADR-0142／0168／0171）：本機即時記住；廣播停手 ~600ms 才送出一次（合併逐字）。 */
  const changeStatusMessage = (msg: string): void => {
    setSelfStatusMessage(msg);
    persistPresence(selfStatus, msg); // 本機即時記住（localStorage 廉價、不節流→打到一半關 App 也不丟）
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
    statusBcTimer.current = setTimeout(() => backendRef.current?.setStatus(selfStatus, msg), 600);
  };
  /** 改「正在聽」（ADR-0142／0168）：隨心跳廣播；易失、不落地。 */
  const changeNowPlaying = (text: string): void => {
    const t = text.trim();
    setSelfNowPlaying(t);
    backendRef.current?.setNowPlaying(t);
  };
  /** 對方正在輸入（ADR-0120／0169）：只留最近一位；6 秒無新訊號自動清（typing 是易失提示）。 */
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markTyping = (pk: string): void => {
    setTypingFrom(pk);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTypingFrom(null), 6000);
  };
  // ADR-0169/0171 審查修正：卸載時清掉待觸發的 typing 與狀態文字廣播計時器（避免洩漏/對已卸載元件動作）。
  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (statusBcTimer.current) clearTimeout(statusBcTimer.current);
  }, []);
  /** 與中繼站連線狀態（ADR-0034）：非 online 時頂端顯示細條（連線中/離線）。 */
  const [connState, setConnState] = useState<ConnectionState>("connecting");
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
    setInvisible(v);
    backendRef.current?.setInvisible?.(v);
  };
  // 送出檔案（ADR-0093/0100）：選檔 → P2P 位元組＋中繼 metadata；訊息由 backend 建立。
  const sendFileFromPicker = (): void => {
    const b = backendRef.current;
    const pk = activeIdRef.current;
    if (!b?.sendFile || !pk) return;
    void pickFile().then(async (f) => {
      if (!f) return;
      const thumb = await makeThumbnail(f.bytes, f.mime); // ADR-0102：只存本機、不外送
      // 行動端目前用 DOM <input>（無完整路徑）→ 不帶 savedPath；真 RN 的 document picker 會給 URI（ADR-0103）。
      b.sendFile?.(pk, f, thumb ? { thumb } : {});
    });
  };

  // 通話（ADR-0101）：發起／接聽／拒接／掛斷。
  const startCall = (media: CallMedia): void => {
    const pk = activeIdRef.current;
    if (pk) backendRef.current?.startCall?.(pk, media);
  };

  // 加密雲端備份（ADR-0071）：關閉時必須立即 purge——「已關閉」要即刻為真。
  const changeCloudSync = (mode: CloudSyncMode): void => {
    setCloudSyncState(mode);
    try {
      localStorage.setItem(CLOUD_SYNC_KEY, mode);
    } catch {
      /* 忽略 */
    }
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
      const text = await exportRecords(storage, fmt, { selfLabel: selfName || "我", now: Date.now() });
      downloadText(`cinder-紀錄-${stamp}.${exportExtension(fmt)}`, exportMime(fmt), text);
    }
  };
  const nameFor = (pk: string): string =>
    pk === selfPubkey ? selfName : contacts.find((c) => c.pubkey === pk)?.name ?? `${pk.slice(0, 8)}…`;

  const entries = useMemo(() => chatList(contacts, groups, convos, unread), [contacts, groups, convos, unread]);
  const unreadTotal = useMemo(() => Object.values(unread).reduce((a, b) => a + b, 0), [unread]);
  const mobileContacts = useMemo<MobileContact[]>(
    // ADR-0148：暱稱優先；ADR-0170：帶對方企業自報頭銜（有才帶，供 chip 顯示）。
    () => contacts.map((c) => ({ pubkey: c.pubkey, name: contactLabel(c), status: c.status, ...(c.title ? { title: c.title } : {}) })),
    [contacts],
  );

  // 通話覆蓋層（ADR-0101）：來電/通話中一律蓋在最上層，不論當下在哪個畫面。
  const inCall = callState !== "idle" && callState !== "ended";
  const callOverlay = inCall ? (
    <CallScreen
      peerName={callPeer ? nameFor(callPeer) : ""}
      state={callState}
      media={callMedia}
      localStream={localStream}
      remoteStream={remoteStream}
      onAccept={() => backendRef.current?.acceptCall?.()}
      onReject={() => backendRef.current?.rejectCall?.()}
      onHangup={() => backendRef.current?.hangupCall?.()}
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
          signInWith(r.identity);
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
          setActiveId(null);
        }}
        nameTaken={(name, pubkey) => nameTaken(profiles, name, pubkey)}
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
          selfLabel={selfName || "我"}
          {...(group ? { nameFor } : {})}
          onBack={backToConvo}
          {...themeProps}
        />
      </View>
    );
  }

  // 連線狀態細條（ADR-0169）：只在真實 relay 且非 online 時顯示（示範模式無中繼、不顯示）。
  const connBanner =
    relayUrl && connState !== "online" ? (
      <View style={connState === "offline" ? bannerStyles.offline : bannerStyles.connecting}>
        <Text style={bannerStyles.text} testID="conn-banner">
          {translate(locale, connState === "offline" ? "conn_offline" : "conn_connecting")}
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
          selfPubkey,
          isGroupAdmin: group.admin === selfPubkey,
          // @提及候選（ADR-0133）：群組＝其他成員（排除自己）。
          mentionCandidates: group.members
            .filter((m) => m !== selfPubkey)
            .map((m) => ({ pubkey: m, name: nameFor(m) })),
          onLeaveGroup: () => {
            backendRef.current?.leaveGroup?.(group.id);
            back(); // 已經不是成員了，留在對話畫面沒有意義
          },
          onRemoveMember: (pk: string) => backendRef.current?.removeGroupMember?.(group.id, pk),
          // 新增成員（ADR-0170）：候選＝尚非成員的聯絡人；僅管理者且後端支援時才接上。
          ...(group.admin === selfPubkey && backendRef.current?.addGroupMember
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
    const fileProps = backendRef.current?.sendFile ? { onSendFile: sendFileFromPicker } : {};
    // 通話：需真實後端＋平台具備 WebRTC（ADR-0101）。
    const callProps = backendRef.current?.startCall && hasCallSupport() ? { onStartCall: startCall } : {};
    return (
      <View style={shell.root}>
        {connBanner}
        <ConversationScreen
          // ADR-0169 審查修正：以 activeId 作 key，換對話（含從通知直接跳另一對話、screen 不變）
          // 時強制重掛，重置 ttl/draft/replyTarget/面板——避免燒毀效期殘留到別的對話。
          key={activeId}
          name={group ? group.name : contact ? contactLabel(contact) : activeId}
          messages={convos[activeId] ?? []}
          onSend={send}
          onBack={back}
          reactions={reactions}
          unsent={unsent}
          onReact={react}
          onUnsend={unsend}
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
          {...callProps}
          {...themeProps}
        />
        {callOverlay}
      </View>
    );
  }

  // 主畫面：分頁內容 + 底部分頁列。
  return (
    <View style={shell.root}>
      {connBanner}
      {tab === "chats" ? (
        <ChatsListScreen
          entries={entries}
          onOpen={openConvo}
          {...(relayUrl
            ? {
                onAddContact: addContact,
                selfNpub,
                // 建立群組（ADR-0114）：只有真實 relay 才有（示範後端無群組扇出）。
                onCreateGroup: createGroup,
                contacts: contacts.map((c) => ({ pubkey: c.pubkey, name: c.name })),
              }
            : {})}
          {...themeProps}
        />
      ) : tab === "contacts" ? (
        <ContactListScreen
          selfPubkey={selfPubkey}
          selfName={selfName}
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
            setConvos((c) => {
              const { [pk]: _drop, ...rest } = c;
              return rest;
            });
          }}
          onClearRequests={() => {
            // 全部刪除（ADR-0127 防洪）：清空請求區與相關對話快取。
            const reqPks = new Set(requests.map((r) => r.pubkey));
            backendRef.current?.clearRequests?.();
            setConvos((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !reqPks.has(k))));
          }}
          {...themeProps}
        />
      ) : (
        <SettingsScreen
          selfName={selfName}
          onRename={renameSelf}
          selfNpub={selfNpub}
          selfNsec={selfNsec}
          relayUrl={relayUrl}
          theme={theme}
          onTheme={setTheme}
          locale={locale}
          onLocale={setLocale}
          accent={accent}
          onAccent={setAccent}
          invisible={invisible}
          onInvisible={toggleInvisible}
          {...(relayUrl
            ? {
                status: selfStatus,
                onStatus: changeStatus,
                statusMessage: selfStatusMessage,
                onStatusMessage: changeStatusMessage,
                nowPlaying: selfNowPlaying,
                onNowPlaying: changeNowPlaying,
                // 企業自報頭銜（ADR-0170／0172）：**企業/企業主身分才顯示編輯器**（與桌面設閘一致；
                // 旗標來自配對搬家捆包），且需真實 relay 後端（setSelfTitle 廣播個人檔）。
                ...(selfEnterprise && backendRef.current?.setSelfTitle ? { title: orgTitle, onSetTitle: changeOrgTitle } : {}),
                onPairExport: () => setScreen("pairExport"),
                notify,
                onNotify: (v: boolean) => void setNotify(v),
                notifyHidePreview: notifyHide,
                onNotifyHidePreview: setNotifyHide,
                retention: retentionCap,
                onRetention: changeRetention,
                onExport: exportAll,
                readReceipts,
                onReadReceipts: toggleReadReceipts,
                cloudSync,
                onCloudSync: changeCloudSync,
                // 加密備份碼（ADR-0070）：需 relay（信封含 home relay）＋在手的 nsec。
                onMakeBackupCode: (pw: string) => makeBackupCode(selfNsec, relayUrl, pw),
                // 多身分（ADR-0138）：切換器列出已記住的身分，可切換/新增。
                identities: visibleProfiles(profiles).map((p) => ({
                  pubkey: p.pubkey,
                  name: p.name,
                  active: p.pubkey === selfPubkey,
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
        />
      )}
      <BottomTabs active={tab} onSelect={setTab} unreadTotal={unreadTotal} {...themeProps} />
      {callOverlay}
    </View>
  );
}
