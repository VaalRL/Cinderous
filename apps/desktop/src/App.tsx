import type { CallMedia, CallState, PubkeyHex } from "@nostr-buddy/core";
import { useEffect, useRef, useState } from "react";
import { BrowserChatBackend } from "./backend/browser-backend.js";
import { RelayChatBackend, webSocketConnector } from "./backend/relay-backend.js";
import type {
  BlockedContact,
  ChatBackend,
  ChatMessage,
  ConnectionState,
  Contact,
  Group,
  Self,
  Status,
} from "./backend/types.js";
import { LocalStorage } from "./storage/local.js";
import { CallWindow } from "./ui/CallWindow.js";
import { ContactListWindow } from "./ui/ContactListWindow.js";
import { ConversationWindow } from "./ui/ConversationWindow.js";
import { SettingsPanel } from "./ui/SettingsPanel.js";
import { SignIn } from "./ui/SignIn.js";
import "./ui/msn.css";

const TYPING_VISIBLE_MS = 6_000;
const RELAY_URL_KEY = "nb.relayUrl";
const NOTIFY_KEY = "nb.notify";

let _uid = 0;
const uid = (prefix: string): string => `${prefix}_${Date.now()}_${_uid++}`;

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
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [conn, setConn] = useState<ConnectionState>("online");
  const [groups, setGroups] = useState<Group[]>([]);
  const [callPeer, setCallPeer] = useState<PubkeyHex | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callMedia, setCallMedia] = useState<CallMedia | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notify, setNotify] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const lastTyping = useRef<Record<string, number>>({});
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // 自動登入：已有持久身分 + relay 網址 → 直接重連（A2 持久化）
  useEffect(() => {
    try {
      const storage = new LocalStorage();
      const identity = storage.loadIdentity();
      const relayUrl = localStorage.getItem(RELAY_URL_KEY);
      if (identity && relayUrl) {
        const b = new RelayChatBackend(storage, webSocketConnector(relayUrl), identity.name);
        setConn("connecting");
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
        // 未讀徽章與桌面通知：僅在收到他人訊息、且視窗未聚焦時
        if (!msg.outgoing && typeof document !== "undefined" && document.hidden) {
          setUnread((u) => ({ ...u, [pk]: (u[pk] ?? 0) + 1 }));
          if (notifyRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification("Nostr Buddy", { body: msg.text });
            } catch {
              /* 忽略通知失敗 */
            }
          }
        }
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
      onConnection: setConn,
      onFileProgress: (pk, id, sent) =>
        setConvos((prev) => {
          const cur = prev[pk];
          if (!cur) return prev;
          let changed = false;
          const next = cur.map((m) => {
            if (m.file && m.file.id === id) {
              changed = true;
              return { ...m, file: { ...m.file, sent } };
            }
            return m;
          });
          return changed ? { ...prev, [pk]: next } : prev;
        }),
      onFileReceived: (pk, file) => {
        const blob = new Blob([file.bytes as BlobPart], { type: file.mime || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const id = uid("rf");
        const msg: ChatMessage = {
          id,
          outgoing: false,
          text: "",
          at: Date.now(),
          file: { id, name: file.name, mime: file.mime, size: file.bytes.length, sent: file.bytes.length, incoming: true, url },
        };
        setConvos((prev) => ({ ...prev, [pk]: [...(prev[pk] ?? []), msg] }));
        setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
      },
      onFileError: (pk, reason) => {
        const msg: ChatMessage = { id: uid("fe"), outgoing: false, text: `⚠️ ${reason}`, at: Date.now() };
        setConvos((prev) => ({ ...prev, [pk]: [...(prev[pk] ?? []), msg] }));
      },
      onCallState: (peer, state, media) => {
        setCallState(state);
        setCallMedia(media);
        if (state === "idle" || state === "ended") {
          setCallPeer(null);
          setLocalStream(null);
          setRemoteStream(null);
        } else {
          setCallPeer(peer);
          if (peer) setOpen((prev) => (prev.includes(peer) ? prev : [...prev, peer]));
        }
      },
      onCallLocalStream: setLocalStream,
      onCallRemoteStream: setRemoteStream,
      onGroups: setGroups,
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

  // 視窗重新聚焦時清除所有未讀徽章
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setUnread({});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const signIn = (name: string, relayUrl: string) => {
    let b: ChatBackend;
    if (relayUrl) {
      localStorage.setItem(RELAY_URL_KEY, relayUrl);
      b = new RelayChatBackend(new LocalStorage(), webSocketConnector(relayUrl), name);
      setConn("connecting");
    } else {
      b = new BrowserChatBackend(name);
      setConn("online");
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
  const openChat = (pk: string) => {
    setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
    setUnread((u) => (u[pk] ? { ...u, [pk]: 0 } : u));
    // F5：對非群組聯絡人主動建立 P2P 通道，讓輸入中等狀態卸載中繼。
    if (!groups.some((g) => g.id === pk)) activeBackend.connectPeer?.(pk);
  };

  const toggleNotifications = () => {
    if (notify) {
      setNotify(false);
      try {
        localStorage.setItem(NOTIFY_KEY, "0");
      } catch {
        /* 忽略 */
      }
      return;
    }
    const enable = () => {
      setNotify(true);
      try {
        localStorage.setItem(NOTIFY_KEY, "1");
      } catch {
        /* 忽略 */
      }
    };
    if (typeof Notification === "undefined") {
      enable();
    } else if (Notification.permission === "granted") {
      enable();
    } else {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") enable();
      });
    }
  };

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

  const sendFile = async (pk: string, f: File) => {
    if (!activeBackend.sendFile) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mime = f.type || "application/octet-stream";
    const id = activeBackend.sendFile(pk, { name: f.name, mime, bytes });
    // 本機保留 blob URL：送出端也能重播/下載（語音訊息尤其需要）
    const url = URL.createObjectURL(f);
    const msg: ChatMessage = {
      id: uid("of"),
      outgoing: true,
      text: "",
      at: Date.now(),
      file: { id, name: f.name, mime, size: bytes.length, sent: 0, incoming: false, url },
    };
    setConvos((prev) => ({ ...prev, [pk]: [...(prev[pk] ?? []), msg] }));
    setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
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
  const groupProps = activeBackend.createGroup
    ? {
        groups,
        onCreateGroup: (name: string, members: string[]) => activeBackend.createGroup!(name, members),
        onOpenGroup: openChat,
      }
    : {};

  return (
    <div className="desktop">
      <ContactListWindow
        self={self}
        contacts={contacts}
        onOpen={openChat}
        onStatus={setStatus}
        onStatusMessage={setStatusMessage}
        onOpenSettings={() => setSettingsOpen(true)}
        onNowPlaying={(text) => activeBackend.setNowPlaying(text)}
        unread={unread}
        connection={conn}
        {...addContactProps}
        {...manageProps}
        {...groupProps}
      />
      {settingsOpen ? (
        <SettingsPanel
          relayUrl={(() => {
            try {
              return localStorage.getItem(RELAY_URL_KEY) ?? "";
            } catch {
              return "";
            }
          })()}
          {...(activeBackend.selfNsec ? { selfNsec: activeBackend.selfNsec } : {})}
          notifications={notify}
          onToggleNotifications={toggleNotifications}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {open.map((pk) => {
        const group = groups.find((g) => g.id === pk);
        if (group) {
          const groupContact: Contact = {
            pubkey: group.id,
            name: group.name,
            status: "online",
            statusMessage: `${group.members.length}`,
            nowPlaying: "",
          };
          const senderName = (pubkey: string): string =>
            pubkey === self.pubkey ? self.name : contacts.find((c) => c.pubkey === pubkey)?.name ?? `${pubkey.slice(0, 8)}…`;
          return (
            <ConversationWindow
              key={pk}
              self={self}
              contact={groupContact}
              messages={convos[pk] ?? []}
              typing={false}
              nudgeSignal={0}
              senderName={senderName}
              onSend={(text) => activeBackend.sendGroupMessage?.(pk, text)}
              onTyping={() => {}}
              onNudge={() => {}}
              {...(activeBackend.leaveGroup
                ? {
                    onLeaveGroup: () => {
                      activeBackend.leaveGroup!(pk);
                      setOpen((prev) => prev.filter((x) => x !== pk));
                    },
                  }
                : {})}
              onClose={() => setOpen((prev) => prev.filter((x) => x !== pk))}
            />
          );
        }
        const contact = contacts.find((c) => c.pubkey === pk);
        if (!contact) return null;
        const reactProps = activeBackend.sendReaction
          ? { onReact: (messageId: string, emoji: string) => activeBackend.sendReaction!(pk, messageId, emoji) }
          : {};
        const unsendProps = activeBackend.unsendMessage
          ? { onUnsend: (messageId: string) => activeBackend.unsendMessage!(pk, messageId) }
          : {};
        const fileProps = activeBackend.sendFile ? { onSendFile: (f: File) => sendFile(pk, f) } : {};
        const callProps = activeBackend.startCall
          ? { onStartCall: (media: CallMedia) => activeBackend.startCall!(pk, media) }
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
            {...fileProps}
            {...callProps}
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
      {callState !== "idle" && callState !== "ended" ? (
        <CallWindow
          peerName={contacts.find((c) => c.pubkey === callPeer)?.name ?? callPeer ?? ""}
          peerKey={callPeer ?? ""}
          state={callState}
          media={callMedia}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={() => activeBackend.acceptCall?.()}
          onReject={() => activeBackend.rejectCall?.()}
          onHangup={() => activeBackend.hangupCall?.()}
        />
      ) : null}
    </div>
  );
}
