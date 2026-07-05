import {
  type CallMedia,
  type CallState,
  generateSecretKey,
  getPublicKey,
  nsecDecode,
  nsecEncode,
  type PubkeyHex,
} from "@nostr-buddy/core";
import { useEffect, useRef, useState } from "react";
import { BrowserChatBackend } from "./backend/browser-backend.js";
import { RelayChatBackend, webSocketConnector } from "./backend/relay-backend.js";
import {
  activeProfile,
  loadProfiles,
  type Profile,
  type ProfilesState,
  saveProfiles,
  setActive,
  upsertProfile,
} from "./storage/profiles.js";
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
import { cleanOnPasteEnabled, setCleanOnPasteEnabled } from "./ui/url-hygiene.js";
import {
  allLabels,
  arrangeGroups,
  type GroupPrefsMap,
  loadGroupPrefs,
  pruneGroup,
  saveGroupPrefs,
  withLabel,
  withoutLabel,
  withPinned,
} from "./ui/group-labels.js";
import { ANCHOR_RELAYS, MAINTAINER_PUBKEY } from "./bootstrap-config.js";
import { initIdle, reduceIdle, type IdleState } from "./ui/idle-status.js";
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

/**
 * 依身分設定檔建立後端（ADR-0045）。工作身分（enterprise）鎖定單座：不給
 * connectorFor/anchors/onHomeSwitched → 不漫遊、不遞補；個人身分走開放模式。
 * 資料以 profile.namespace 隔離。
 */
function buildBackend(p: Profile): ChatBackend {
  if (!p.relayUrl) return new BrowserChatBackend(p.name);
  const storage = new LocalStorage(p.namespace);
  const opts = p.enterprise
    ? { relayUrl: p.relayUrl }
    : {
        relayUrl: p.relayUrl,
        connectorFor: webSocketConnector,
        anchors: ANCHOR_RELAYS,
        ...(MAINTAINER_PUBKEY ? { maintainerPubkey: MAINTAINER_PUBKEY } : {}),
        onHomeSwitched: (url: string) => {
          try {
            localStorage.setItem(RELAY_URL_KEY, url);
          } catch {
            /* 忽略 */
          }
        },
      };
  return new RelayChatBackend(storage, webSocketConnector(p.relayUrl), p.name, opts);
}

export function App(): JSX.Element {
  const [backend, setBackend] = useState<ChatBackend | null>(null);
  const [profilesState, setProfilesState] = useState<ProfilesState>(() => loadProfiles());
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
  const [relays, setRelays] = useState<{ url: string; state: ConnectionState; home: boolean; stale: boolean }[]>([]);
  const [cleanPaste, setCleanPaste] = useState<boolean>(() => cleanOnPasteEnabled());
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupPrefs, setGroupPrefs] = useState<GroupPrefsMap>(() => loadGroupPrefs());
  const [labelFilter, setLabelFilter] = useState<string | undefined>(undefined);
  const [callPeer, setCallPeer] = useState<PubkeyHex | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callMedia, setCallMedia] = useState<CallMedia | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addIdOpen, setAddIdOpen] = useState(false);
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
  const selfRef = useRef<Self | null>(self);
  selfRef.current = self;
  const idleRef = useRef<IdleState>(initIdle(Date.now()));

  // 自動登入：以「作用中身分設定檔」建立後端（ADR-0045；相容既有單一身分）
  useEffect(() => {
    try {
      const active = activeProfile(profilesState);
      if (!active) return;
      const b = buildBackend(active);
      setConn(active.relayUrl ? "connecting" : "online");
      setSelf({ ...b.self });
      setBackend(b);
    } catch {
      /* 忽略 */
    }
    // 僅在掛載時依當時作用中身分啟動；切換身分走 reload。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      onHistory: (pk, msgs) => {
        // 啟動回放：一次寫入該對話、且不自動開窗（使用者從清單點開才載入視窗）。
        setConvos((prev) => (prev[pk] ? prev : { ...prev, [pk]: msgs }));
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
      onRelayPool: setRelays,
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

  // 閒置自動「離開」：無操作逾時自動切 away，一有活動即還原手動狀態
  useEffect(() => {
    if (!backend) return;
    idleRef.current = initIdle(Date.now(), selfRef.current?.status ?? "online");
    const apply = (status: Status) => {
      backend.setStatus(status, selfRef.current?.statusMessage ?? "");
      setSelf((x) => (x ? { ...x, status } : x));
    };
    const dispatch = (ev: Parameters<typeof reduceIdle>[1]) => {
      const { state, setStatus } = reduceIdle(idleRef.current, ev);
      idleRef.current = state;
      if (setStatus) apply(setStatus);
    };
    const onActivity = () => dispatch({ type: "activity", at: Date.now() });
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    const timer = setInterval(() => dispatch({ type: "tick", at: Date.now() }), 30_000);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      clearInterval(timer);
    };
  }, [backend]);

  const signIn = (name: string, relayUrl: string) => {
    if (!relayUrl) {
      const b = new BrowserChatBackend(name);
      setConn("online");
      setSelf({ ...b.self });
      setBackend(b);
      return;
    }
    localStorage.setItem(RELAY_URL_KEY, relayUrl);
    // 第一個身分沿用舊鍵命名空間（空），達成向後相容
    const b = buildBackend({ pubkey: "", name, relayUrl, enterprise: false, namespace: "" });
    const profile: Profile = { pubkey: b.self.pubkey, name, relayUrl, enterprise: false, namespace: "" };
    const next = upsertProfile(profilesState, profile);
    saveProfiles(next);
    setProfilesState(next);
    setConn("connecting");
    setSelf({ ...b.self });
    setBackend(b);
  };

  // 切換身分：持久化作用中選擇後重載，讓所有 per-身分 狀態乾淨重建（ADR-0045）。
  const switchProfile = (pubkey: string) => {
    if (pubkey === profilesState.active) return;
    saveProfiles(setActive(profilesState, pubkey));
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  // 新增身分：產生或匯入 nsec → 存入該身分命名空間 → 登錄並切換（重載）。
  const addIdentity = (name: string, relayUrl: string, enterprise: boolean, nsecInput?: string) => {
    const sk = nsecInput?.trim() ? nsecDecode(nsecInput.trim()) : generateSecretKey();
    const pubkey = getPublicKey(sk);
    new LocalStorage(pubkey).saveIdentity({ nsec: nsecEncode(sk), name });
    const profile: Profile = { pubkey, name, relayUrl, enterprise, namespace: pubkey };
    saveProfiles(upsertProfile(profilesState, profile));
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  if (!backend || !self) return <SignIn onSignIn={signIn} />;

  const activeBackend = backend;
  const setStatus = (status: Status) => {
    // 記錄為手動狀態：閒置邏輯不會覆蓋它（UI 已即時套用，故 reducer 不重複 setStatus）
    idleRef.current = reduceIdle(idleRef.current, { type: "manual", status, at: Date.now() }).state;
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
    ? {
        onAddContact: activeBackend.addContact.bind(activeBackend),
        selfNpub: activeBackend.selfShareUri ?? activeBackend.selfNpub ?? "",
      }
    : {};
  const manageProps = {
    ...(activeBackend.removeContact ? { onRemoveContact: removeContact } : {}),
    ...(activeBackend.blockContact ? { onBlockContact: blockContact } : {}),
    ...(activeBackend.unblockContact
      ? { onUnblockContact: (pk: string) => activeBackend.unblockContact!(pk) }
      : {}),
    blocked,
  };
  const updatePrefs = (next: GroupPrefsMap) => {
    setGroupPrefs(next);
    saveGroupPrefs(next);
  };
  const arrangedGroups = arrangeGroups(groups, groupPrefs, labelFilter);
  const groupLabels: Record<string, string[]> = {};
  const groupPinned: Record<string, boolean> = {};
  for (const g of groups) {
    const p = groupPrefs[g.id];
    if (p?.labels.length) groupLabels[g.id] = p.labels;
    if (p?.pinned) groupPinned[g.id] = true;
  }
  const groupProps = activeBackend.createGroup
    ? {
        groups: arrangedGroups,
        onCreateGroup: (name: string, members: string[]) => activeBackend.createGroup!(name, members),
        onOpenGroup: openChat,
        groupLabels,
        groupPinned,
        labelOptions: allLabels(groupPrefs),
        activeLabel: labelFilter,
        onFilterLabel: setLabelFilter,
        onAddGroupLabel: (id: string, label: string) => updatePrefs(withLabel(groupPrefs, id, label)),
        onRemoveGroupLabel: (id: string, label: string) => updatePrefs(withoutLabel(groupPrefs, id, label)),
        onToggleGroupPin: (id: string) => updatePrefs(withPinned(groupPrefs, id, !groupPrefs[id]?.pinned)),
      }
    : {};

  return (
    <div className="desktop">
      {profilesState.profiles.length > 0 ? (
        <div className="idbar" data-testid="identity-bar">
          <span className="idbar__icon" aria-hidden="true">
            {activeProfile(profilesState)?.enterprise ? "🏢" : "👤"}
          </span>
          <select
            className="idbar__select"
            aria-label="切換身分"
            value={profilesState.active ?? ""}
            onChange={(e) => switchProfile(e.target.value)}
          >
            {profilesState.profiles.map((p) => (
              <option key={p.pubkey} value={p.pubkey}>
                {(p.enterprise ? "🏢 " : "👤 ") + p.name}
              </option>
            ))}
          </select>
          <button className="idbar__add" title="新增身分" onClick={() => setAddIdOpen(true)}>
            ＋
          </button>
        </div>
      ) : null}
      {addIdOpen ? (
        <AddIdentityModal onCancel={() => setAddIdOpen(false)} onAdd={addIdentity} />
      ) : null}
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
          {...(relays.length > 0 ? { relays } : {})}
          {...(activeBackend.clearRelayHint
            ? { onRelayClear: activeBackend.clearRelayHint.bind(activeBackend) }
            : {})}
          {...(activeBackend.acknowledgeRelayStale
            ? { onRelayKeep: activeBackend.acknowledgeRelayStale.bind(activeBackend) }
            : {})}
          {...(activeBackend.selfNsec ? { selfNsec: activeBackend.selfNsec } : {})}
          cleanOnPaste={cleanPaste}
          onToggleCleanOnPaste={() => {
            setCleanOnPasteEnabled(!cleanPaste);
            setCleanPaste(!cleanPaste);
          }}
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
                      updatePrefs(pruneGroup(groupPrefs, pk));
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

/** 新增身分小視窗（ADR-0045）：名稱＋relay＋是否工作身分＋可選匯入 nsec。 */
function AddIdentityModal({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, relayUrl: string, enterprise: boolean, nsec?: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [enterprise, setEnterprise] = useState(false);
  const [nsec, setNsec] = useState("");
  const submit = () => {
    if (!name.trim() || !relayUrl.trim()) return;
    try {
      onAdd(name.trim(), relayUrl.trim(), enterprise, nsec.trim() || undefined);
    } catch {
      /* 非法 nsec：保留輸入 */
    }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="新增身分" onClick={onCancel}>
      <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>新增身分</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label="關閉" onClick={onCancel}>
            ×
          </span>
        </div>
        <div className="groupmodal">
          <input className="groupmodal__name" placeholder="顯示名稱" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="groupmodal__name"
            placeholder="relay 網址（wss://…）"
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
          />
          <label className="groupmodal__item">
            <input type="checkbox" checked={enterprise} onChange={(e) => setEnterprise(e.target.checked)} />
            <span>工作身分（鎖定此節點、不漫遊）</span>
          </label>
          <input
            className="groupmodal__name"
            placeholder="匯入 nsec（留空＝產生新身分）"
            value={nsec}
            onChange={(e) => setNsec(e.target.value)}
          />
          <button className="groupmodal__create" data-testid="add-identity-confirm" disabled={!name.trim() || !relayUrl.trim()} onClick={submit}>
            建立並切換
          </button>
        </div>
      </div>
    </div>
  );
}
