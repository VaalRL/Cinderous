// 行動端 app 殼與導覽（ADR-0085/0086/0087）：登入→底部分頁（聊天／聯絡人／設定）→點擊開對話（push）。
// 接 @cinder/engine 的 ChatBackend（示範或真實 relay，見 backend.ts）；主題/主色/語言由本殼掌管，
// 設定分頁即時切換。正式版把後端換成注入 RelayChatBackend＋原生安全儲存即可（同一套 UI）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppStorage, ChatBackend, ChatMessage, Contact, Group, Status } from "@cinder/engine";
import { exportExtension, exportMime, type ExportFormat, exportRecords, LocalStorage } from "@cinder/engine";
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
import { NsecSignInScreen } from "./screens/NsecSignInScreen.js";
import { PairImportScreen } from "./screens/PairImportScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";

type Screen = "signin" | "pair" | "main" | "conversation";

const STATUS_KEY: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

const shell = StyleSheet.create({ root: { flex: 1 } });

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selfPubkey, setSelfPubkey] = useState("");
  const [selfName, setSelfName] = useState("");
  const [selfNpub, setSelfNpub] = useState("");
  const [selfNsec, setSelfNsec] = useState("");
  const [invisible, setInvisible] = useState(false);
  const [retentionCap, setRetentionCapState] = useState<number>(() => readRetentionCap());
  const [readReceipts, setReadReceiptsState] = useState<boolean>(() => readReadReceipts());
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
    const store = relayUrl ? new LocalStorage(identity.pubkey, readRetentionCap()) : null;
    storeRef.current = store;
    const backend = createBackend(identity, relayUrl, store ?? undefined);
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
        const viewing = screenRef.current === "conversation" && activeIdRef.current === pk;
        if (!m.outgoing && !viewing) setUnread((u) => ({ ...u, [pk]: (u[pk] ?? 0) + 1 }));
      },
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
      onTyping: () => {},
      onNudge: () => {},
    });
    backend.setReadReceipts?.(readReceipts); // ADR-0058：互惠開關（關＝不送也不顯示對方已讀）
    setTab("chats");
    setScreen("main");
  };

  const openConvo = (id: string): void => {
    setActiveId(id);
    setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u));
    setScreen("conversation");
    backendRef.current?.markRead?.(id); // ADR-0058 Tier 3：開對話＝送已讀水位（未開啟則後端自行忽略）
  };
  const back = (): void => {
    setScreen("main");
    setActiveId(null);
  };
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
  const exportAll = (): void => {
    const storage = storeRef.current;
    if (!storage) return;
    const stamp = new Date().toISOString().slice(0, 10);
    for (const fmt of ["txt", "md", "json"] as ExportFormat[]) {
      const text = exportRecords(storage, fmt, { selfLabel: selfName || "我", now: Date.now() });
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
  if (screen === "conversation" && activeId) {
    const group = groups.find((g) => g.id === activeId);
    const contact = contacts.find((c) => c.pubkey === activeId);
    const subtitle = group
      ? translate(locale, "group_membersCount", { count: group.members.length })
      : contact
        ? contact.statusMessage || translate(locale, STATUS_KEY[contact.status])
        : undefined;
    return (
      <ConversationScreen
        name={group?.name ?? contact?.name ?? activeId}
        messages={convos[activeId] ?? []}
        onSend={send}
        onBack={back}
        {...(subtitle ? { subtitle } : {})}
        {...(group ? { nameFor } : {})}
        {...themeProps}
      />
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
              }
            : {})}
          onLogout={logout}
        />
      )}
      <BottomTabs active={tab} onSelect={setTab} unreadTotal={unreadTotal} {...themeProps} />
    </View>
  );
}
