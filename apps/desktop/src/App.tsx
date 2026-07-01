import { useEffect, useRef, useState } from "react";
import { BrowserChatBackend } from "./backend/browser-backend.js";
import { RelayChatBackend, webSocketConnector } from "./backend/relay-backend.js";
import type { BlockedContact, ChatBackend, ChatMessage, Contact, Self, Status } from "./backend/types.js";
import { LocalStorage } from "./storage/local.js";
import { ContactListWindow } from "./ui/ContactListWindow.js";
import { ConversationWindow } from "./ui/ConversationWindow.js";
import { SignIn } from "./ui/SignIn.js";
import "./ui/msn.css";

const TYPING_VISIBLE_MS = 6_000;
const RELAY_URL_KEY = "nb.relayUrl";

export function App(): JSX.Element {
  const [backend, setBackend] = useState<ChatBackend | null>(null);
  const [self, setSelf] = useState<Self | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [convos, setConvos] = useState<Record<string, ChatMessage[]>>({});
  const [typingAt, setTypingAt] = useState<Record<string, number>>({});
  const [nudge, setNudge] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [unsent, setUnsent] = useState<Set<string>>(new Set());
  const [expired, setExpired] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const lastTyping = useRef<Record<string, number>>({});

  // 自動登入：已有持久身分 + relay 網址 → 直接重連（A2 持久化）
  useEffect(() => {
    try {
      const storage = new LocalStorage();
      const identity = storage.loadIdentity();
      const relayUrl = localStorage.getItem(RELAY_URL_KEY);
      if (identity && relayUrl) {
        const b = new RelayChatBackend(storage, webSocketConnector(relayUrl), identity.name);
        setSelf({ ...b.self });
        setBackend(b);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    if (!backend) return;
    backend.start({
      onContacts: setContacts,
      onMessage: (pk, msg) => {
        setConvos((prev) => {
          const cur = prev[pk] ?? [];
          if (cur.some((m) => m.id === msg.id)) return prev;
          return { ...prev, [pk]: [...cur, msg] };
        });
        setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
      },
      onTyping: (pk) => setTypingAt((prev) => ({ ...prev, [pk]: Date.now() })),
      onNudge: (pk) => {
        setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
        setNudge((prev) => ({ ...prev, [pk]: (prev[pk] ?? 0) + 1 }));
      },
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
    });
    return () => backend.stop();
  }, [backend]);

  // 限時訊息：定期掃描到期訊息，到期即標記（UI 顯示「訊息已到期」）
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setExpired((prev) => {
        let next: Set<string> | null = null;
        for (const msgs of Object.values(convos)) {
          for (const m of msgs) {
            if (m.expiresAt !== undefined && m.expiresAt <= now && !prev.has(m.id)) {
              (next ??= new Set(prev)).add(m.id);
            }
          }
        }
        return next ?? prev;
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [convos]);

  const signIn = (name: string, relayUrl: string) => {
    let b: ChatBackend;
    if (relayUrl) {
      localStorage.setItem(RELAY_URL_KEY, relayUrl);
      b = new RelayChatBackend(new LocalStorage(), webSocketConnector(relayUrl), name);
    } else {
      b = new BrowserChatBackend(name);
    }
    setSelf({ ...b.self });
    setBackend(b);
  };

  if (!backend || !self) return <SignIn onSignIn={signIn} />;

  const activeBackend = backend;
  const setStatus = (status: Status) => {
    activeBackend.setStatus(status, self.statusMessage);
    setSelf((x) => (x ? { ...x, status } : x));
  };
  const setStatusMessage = (message: string) => {
    activeBackend.setStatus(self.status, message);
    setSelf((x) => (x ? { ...x, statusMessage: message } : x));
  };
  const openChat = (pk: string) => setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));

  // 刪除/封鎖後：關閉其對話視窗並清掉本地對話快取
  const forget = (pk: string) => {
    setOpen((prev) => prev.filter((x) => x !== pk));
    setConvos((prev) => {
      if (!(pk in prev)) return prev;
      const next = { ...prev };
      delete next[pk];
      return next;
    });
  };
  const removeContact = (pk: string) => {
    activeBackend.removeContact?.(pk);
    forget(pk);
  };
  const blockContact = (pk: string) => {
    activeBackend.blockContact?.(pk);
    forget(pk);
  };

  const addContactProps = activeBackend.addContact
    ? { onAddContact: activeBackend.addContact.bind(activeBackend), selfNpub: activeBackend.selfNpub ?? "" }
    : {};
  const manageProps = {
    ...(activeBackend.removeContact ? { onRemoveContact: removeContact } : {}),
    ...(activeBackend.blockContact ? { onBlockContact: blockContact } : {}),
    ...(activeBackend.unblockContact
      ? { onUnblockContact: (pk: string) => activeBackend.unblockContact!(pk) }
      : {}),
    blocked,
  };

  return (
    <div className="desktop">
      <ContactListWindow
        self={self}
        contacts={contacts}
        onOpen={openChat}
        onStatus={setStatus}
        onStatusMessage={setStatusMessage}
        {...addContactProps}
        {...manageProps}
      />
      {open.map((pk) => {
        const contact = contacts.find((c) => c.pubkey === pk);
        if (!contact) return null;
        const reactProps = activeBackend.sendReaction
          ? { onReact: (messageId: string, emoji: string) => activeBackend.sendReaction!(pk, messageId, emoji) }
          : {};
        const unsendProps = activeBackend.unsendMessage
          ? { onUnsend: (messageId: string) => activeBackend.unsendMessage!(pk, messageId) }
          : {};
        return (
          <ConversationWindow
            key={pk}
            self={self}
            contact={contact}
            messages={convos[pk] ?? []}
            reactions={reactions}
            unsent={unsent}
            expired={expired}
            typing={(typingAt[pk] ?? 0) > Date.now() - TYPING_VISIBLE_MS}
            nudgeSignal={nudge[pk] ?? 0}
            {...reactProps}
            {...unsendProps}
            onSend={(text, ttlSeconds) => activeBackend.sendMessage(pk, text, ttlSeconds)}
            onTyping={() => {
              const now = Date.now();
              if (now - (lastTyping.current[pk] ?? 0) < 1000) return;
              lastTyping.current[pk] = now;
              activeBackend.sendTyping(pk);
            }}
            onNudge={() => activeBackend.sendNudge(pk)}
            onClose={() => setOpen((prev) => prev.filter((x) => x !== pk))}
          />
        );
      })}
    </div>
  );
}
