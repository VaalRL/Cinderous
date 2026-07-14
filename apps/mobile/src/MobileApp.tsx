// 行動端 app 殼與導覽（ADR-0085/0086/0087）：登入→底部分頁（聊天／聯絡人／設定）→點擊開對話（push）。
// 接 @cinder/engine 的 ChatBackend（示範或真實 relay，見 backend.ts）；主題/主色/語言由本殼掌管，
// 設定分頁即時切換。正式版把後端換成注入 RelayChatBackend＋原生安全儲存即可（同一套 UI）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppStorage, ChatBackend, ChatMessage, CloudSyncMode, Contact, Group, Status } from "@cinder/engine";
import {
  exportExtension,
  exportMime,
  type ExportFormat,
  exportRecords,
  getDeviceId,
  LocalStorage,
  openOpfsArchive,
} from "@cinder/engine";
import { nsecDecode } from "@cinder/core";
import type { CallMedia, CallState } from "@cinder/core";
import { makeThumbnail, pickFile, saveFile } from "./native/files.js";
import { hasCallSupport } from "./native/call-media.js";
import { CallScreen } from "./screens/CallScreen.js";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import type { Theme } from "@cinder/theme";
import { StyleSheet, View } from "react-native-web";
import type { MobileIdentity } from "./auth.js";
import { createBackend } from "./backend.js";
import { chatList } from "./chat-list.js";
import { BottomTabs, type Tab } from "./screens/BottomTabs.js";
import { ChatsListScreen } from "./screens/ChatsListScreen.js";
import { ContactListScreen, type MobileContact } from "./screens/ContactListScreen.js";
import { ConversationScreen } from "./screens/ConversationScreen.js";
import { HistoryScreen } from "./screens/HistoryScreen.js";
import { NsecSignInScreen } from "./screens/NsecSignInScreen.js";
import { PairImportScreen } from "./screens/PairImportScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";

type Screen = "signin" | "pair" | "main" | "conversation" | "history";

const STATUS_KEY: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

const shell = StyleSheet.create({ root: { flex: 1 } });

// 加密雲端備份（ADR-0071）：裝置本地偏好；off／basic／full。
const CLOUD_SYNC_KEY = "nb.cloudSync";
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
  const [screen, setScreen] = useState<Screen>("signin");
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
  const [activeId, setActiveId] = useState<string | null>(null);
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

  useEffect(() => () => backendRef.current?.stop(), []);

  const themeProps = { locale, theme, accent } as const;

  const handleSignIn = (identity: MobileIdentity): void => {
    backendRef.current?.stop();
    // ADR-0094：真實 relay 用外部持有的儲存（供保留上限/導出）；示範模式無持久化。
    // ADR-0112：靜態加密——資料金鑰由 nsec 導出。行動端**從不持久化 nsec**（每次輸入），
    // 所以金鑰不在磁碟上 → localStorage/OPFS 上的訊息**真的**解不開。
    const sk = nsecDecode(identity.nsec);
    const store = relayUrl ? new LocalStorage(identity.pubkey, readRetentionCap(), sk) : null;
    storeRef.current = store;
    // ADR-0111：封存走 OPFS（webview 沒有檔案系統；OPFS 的配額與 localStorage 是不同的池子）。
    // 非同步掛上——掛上前不會裁切熱區，故安全；不支援 OPFS 時不掛（熱區無上限，資料完好）。
    // 封存塊以同一把金鑰加密（ADR-0112）。
    if (store) {
      void openOpfsArchive(identity.pubkey, store.storageKey()).then((a) => a && store.attachArchive?.(a));
    }
    // ADR-0100：帶上錨點/簽章清單（backend.ts 內）與加密雲端備份模式。
    const backend = createBackend(identity, relayUrl, { store: store ?? undefined, cloudSync });
    backendRef.current = backend;
    setSelfPubkey(identity.pubkey);
    setSelfName(identity.name);
    setSelfNpub(identity.npub);
    setSelfNsec(identity.nsec);
    setContacts([]);
    setGroups([]);
    setConvos({});
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
      },
      // 未讀（ADR-0108）：重新載入後徽章仍在（過去是記憶體計數器，重載歸零）。
      onUnread: setUnread,
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
      onTyping: () => {},
      onNudge: () => {},
    });
    backend.setReadReceipts?.(readReceipts); // ADR-0058：互惠開關（關＝不送也不顯示對方已讀）
    setTab("chats");
    setScreen("main");
  };

  const openConvo = (id: string): void => {
    setActiveId(id);
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
    setScreen("signin");
    setTab("chats");
    setActiveId(null);
    setInvisible(false);
  };
  const send = (text: string): void => {
    if (activeId) backendRef.current?.sendMessage(activeId, text);
  };
  const addContact = (npub: string): void => backendRef.current?.addContact?.(npub.trim());
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
    () => contacts.map((c) => ({ pubkey: c.pubkey, name: c.name, status: c.status })),
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

  if (screen === "signin") {
    return <NsecSignInScreen onSignIn={handleSignIn} onUsePairing={() => setScreen("pair")} {...themeProps} />;
  }
  if (screen === "pair") {
    return (
      <PairImportScreen
        onPair={() => Promise.reject(new Error("配對需原生環境（WebRTC/EAS），此網頁示範不可用"))}
        onSignIn={handleSignIn}
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

  if (screen === "conversation" && activeId) {
    const group = groups.find((g) => g.id === activeId);
    const contact = contacts.find((c) => c.pubkey === activeId);
    const subtitle = group
      ? translate(locale, "group_membersCount", { count: group.members.length })
      : contact
        ? contact.statusMessage || translate(locale, STATUS_KEY[contact.status])
        : undefined;
    // 群組另傳成員名解析＋成員清單：供已讀分級（≤5 名單、6–10 計數、>10 不顯示，ADR-0095）。
    const groupProps = group ? { nameFor, groupMembers: group.members } : {};
    // 檔案：真實 relay 才有 P2P 傳輸（示範後端無 sendFile）。
    const fileProps = backendRef.current?.sendFile ? { onSendFile: sendFileFromPicker } : {};
    // 通話：需真實後端＋平台具備 WebRTC（ADR-0101）。
    const callProps = backendRef.current?.startCall && hasCallSupport() ? { onStartCall: startCall } : {};
    return (
      <View style={shell.root}>
        <ConversationScreen
          name={group?.name ?? contact?.name ?? activeId}
          messages={convos[activeId] ?? []}
          onSend={send}
          onBack={back}
          {...(subtitle ? { subtitle } : {})}
          {...((archived[activeId] ?? 0) > 0 ? { onHistory: () => setScreen("history") } : {})}
          {...groupProps}
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
      {tab === "chats" ? (
        <ChatsListScreen
          entries={entries}
          onOpen={openConvo}
          {...(relayUrl ? { onAddContact: addContact, selfNpub } : {})}
          {...themeProps}
        />
      ) : tab === "contacts" ? (
        <ContactListScreen selfPubkey={selfPubkey} selfName={selfName} contacts={mobileContacts} onOpen={openConvo} {...themeProps} />
      ) : (
        <SettingsScreen
          selfName={selfName}
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
                retention: retentionCap,
                onRetention: changeRetention,
                onExport: exportAll,
                readReceipts,
                onReadReceipts: toggleReadReceipts,
                cloudSync,
                onCloudSync: changeCloudSync,
              }
            : {})}
          onLogout={logout}
        />
      )}
      <BottomTabs active={tab} onSelect={setTab} unreadTotal={unreadTotal} {...themeProps} />
      {callOverlay}
    </View>
  );
}
