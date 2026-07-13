// 行動端 app 殼與導覽（ADR-0085/0086/0087）：登入→底部分頁（聊天／聯絡人／設定）→點擊開對話（push）。
// 接 @cinder/engine 的 ChatBackend（示範或真實 relay，見 backend.ts）；主題/主色/語言由本殼掌管，
// 設定分頁即時切換。正式版把後端換成注入 RelayChatBackend＋原生安全儲存即可（同一套 UI）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatBackend, ChatMessage, Contact, Group, Status } from "@cinder/engine";
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
  const backendRef = useRef<ChatBackend | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => () => backendRef.current?.stop(), []);

  const themeProps = { locale, theme, accent } as const;

  const handleSignIn = (identity: MobileIdentity): void => {
    backendRef.current?.stop();
    const backend = createBackend(identity, relayUrl);
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
      onTyping: () => {},
      onNudge: () => {},
    });
    setTab("chats");
    setScreen("main");
  };

  const openConvo = (id: string): void => {
    setActiveId(id);
    setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u));
    setScreen("conversation");
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
          onLogout={logout}
        />
      )}
      <BottomTabs active={tab} onSelect={setTab} unreadTotal={unreadTotal} {...themeProps} />
    </View>
  );
}
