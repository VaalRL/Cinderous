// 行動端 app 殼與導覽（ADR-0085）：把登入／聊天清單／對話串成一個可用 app（參考 LINE/Signal 流程）。
// 登入後接 @cinder/engine 的 ChatBackend（此處用示範後端 createDemoChat，接記憶體 relay＋機器人），
// onContacts/onMessage/onHistory/onGroups → 狀態；點清單開對話、送訊走 backend.sendMessage。
// 正式版把 createDemoChat 換成注入 RelayChatBackend＋原生安全儲存即可（同一套 UI）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatBackend, ChatMessage, Contact, Group, Status } from "@cinder/engine";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import type { Theme } from "@cinder/theme";
import type { MobileIdentity } from "./auth.js";
import { chatList } from "./chat-list.js";
import { createDemoChat } from "./chat.js";
import { ChatsListScreen } from "./screens/ChatsListScreen.js";
import { ConversationScreen } from "./screens/ConversationScreen.js";
import { NsecSignInScreen } from "./screens/NsecSignInScreen.js";
import { PairImportScreen } from "./screens/PairImportScreen.js";

type Screen = "signin" | "pair" | "chats" | "conversation";

const STATUS_KEY: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

export function MobileApp({
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const [screen, setScreen] = useState<Screen>("signin");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [convos, setConvos] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selfName, setSelfName] = useState("");
  const backendRef = useRef<ChatBackend | null>(null);
  // 供 onMessage 閉包判斷「此對話是否正在看」以決定要不要累未讀。
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => () => backendRef.current?.stop(), []);

  const themeProps = { locale, theme, accent, accent2 } as const;

  const handleSignIn = (identity: MobileIdentity): void => {
    backendRef.current?.stop();
    const backend = createDemoChat(identity.name);
    backendRef.current = backend;
    setSelfName(identity.name);
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
    setScreen("chats");
  };

  const openConvo = (id: string): void => {
    setActiveId(id);
    setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u));
    setScreen("conversation");
  };
  const back = (): void => {
    setScreen("chats");
    setActiveId(null);
  };
  const send = (text: string): void => {
    if (activeId) backendRef.current?.sendMessage(activeId, text);
  };
  const nameFor = (pk: string): string =>
    pk === backendRef.current?.self.pubkey ? selfName : contacts.find((c) => c.pubkey === pk)?.name ?? `${pk.slice(0, 8)}…`;

  const entries = useMemo(() => chatList(contacts, groups, convos, unread), [contacts, groups, convos, unread]);

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
  return <ChatsListScreen entries={entries} onOpen={openConvo} {...themeProps} />;
}
