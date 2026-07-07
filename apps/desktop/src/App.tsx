import {
  applyRosterRotations,
  type CallMedia,
  type CallState,
  generateSecretKey,
  getPublicKey,
  newGroupId,
  npubDecode,
  nsecDecode,
  nsecEncode,
  type OrgGroup,
  type OrgMember,
  type PubkeyHex,
} from "@cinder/core";
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
  OrgPolicy,
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
import { createRinger, createRingback } from "./ui/ringtone.js";
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

/** 把管理者輸入（npub… 或 hex）正規化為 hex pubkey；非法回傳 undefined（ADR-0047）。 */
function normalizeAdminPubkey(input: string): string | undefined {
  const v = input.trim();
  try {
    if (v.startsWith("npub")) return npubDecode(v);
    if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
  } catch {
    /* 非法 */
  }
  return undefined;
}

/**
 * 依身分設定檔建立後端（ADR-0045）。工作身分（enterprise）鎖定單座：不給
 * connectorFor/anchors/onHomeSwitched → 不漫遊、不遞補；個人身分走開放模式。
 * 資料以 profile.namespace 隔離。
 */
function buildBackend(p: Profile): ChatBackend {
  if (!p.relayUrl) return new BrowserChatBackend(p.name);
  const storage = new LocalStorage(p.namespace);
  const opts = p.enterprise
    ? { relayUrl: p.relayUrl, ...(p.adminPubkey ? { orgAdminPubkey: p.adminPubkey } : {}) }
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
  /** 來電鈴聲 / 外撥回鈴音（M8）：依通話狀態循環播放，狀態一變即停。 */
  const ringerRef = useRef(createRinger());
  const ringbackRef = useRef(createRingback());
  const [open, setOpen] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addIdOpen, setAddIdOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [policy, setPolicy] = useState<OrgPolicy>({});
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
              new Notification("Cinder", { body: msg.text });
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
      onPolicy: setPolicy,
      onIdentityRotated: (from, to, name) => {
        // 企業身分輪替（ADR-0052）：storage 已由後端接續；同步記憶體對話狀態（舊→新 npub）
        // 並注入一則系統提示。開啟中的對話一併換鍵。
        const note: ChatMessage = { id: uid("rot"), outgoing: false, text: `🔑 ${name} 已更新金鑰（對話已接續）`, at: Date.now() };
        setConvos((prev) => {
          // 先把所有對話（含群組）中 sender=from 的訊息改寫為 to（群訊發送者標籤 remap）。
          const next: Record<string, ChatMessage[]> = {};
          for (const [key, msgs] of Object.entries(prev)) {
            next[key] = msgs.map((m) => (m.sender === from ? { ...m, sender: to } : m));
          }
          // 再把 1:1 舊對話併入新 npub + 系統提示。
          next[to] = [...(next[to] ?? []), ...(next[from] ?? []), note].sort((a, b) => a.at - b.at);
          delete next[from];
          return next;
        });
        setOpen((prev) => {
          const mapped = prev.map((pk) => (pk === from ? to : pk));
          return mapped.filter((pk, i) => mapped.indexOf(pk) === i);
        });
      },
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

  // 通話鈴聲（M8）：來電中播來電鈴、外撥等待中播回鈴音；其餘狀態兩者皆停。
  useEffect(() => {
    const ringer = ringerRef.current;
    const ringback = ringbackRef.current;
    if (callState === "incoming") {
      ringer.start();
      ringback.stop();
    } else if (callState === "outgoing") {
      ringback.start();
      ringer.stop();
    } else {
      ringer.stop();
      ringback.stop();
    }
    return () => {
      ringer.stop();
      ringback.stop();
    };
  }, [callState]);

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
  const addIdentity = (
    name: string,
    relayUrl: string,
    enterprise: boolean,
    opts: { nsec?: string | undefined; adminPubkey?: string | undefined } = {},
  ) => {
    const sk = opts.nsec?.trim() ? nsecDecode(opts.nsec.trim()) : generateSecretKey();
    const pubkey = getPublicKey(sk);
    new LocalStorage(pubkey).saveIdentity({ nsec: nsecEncode(sk), name });
    const admin = enterprise && opts.adminPubkey?.trim() ? normalizeAdminPubkey(opts.adminPubkey.trim()) : undefined;
    const profile: Profile = { pubkey, name, relayUrl, enterprise, namespace: pubkey, ...(admin ? { adminPubkey: admin } : {}) };
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
          {activeBackend.publishRoster ? (
            <button className="idbar__add" title="組織名冊（管理者）" onClick={() => setRosterOpen(true)}>
              🗂
            </button>
          ) : null}
        </div>
      ) : null}
      {addIdOpen ? (
        <AddIdentityModal onCancel={() => setAddIdOpen(false)} onAdd={addIdentity} />
      ) : null}
      {rosterOpen ? (
        <RosterAdminModal
          selfNpub={activeBackend.selfNpub ?? ""}
          onCancel={() => setRosterOpen(false)}
          onPublish={(org, members, pol, groups) => activeBackend.publishRoster!(org, members, pol, groups)}
        />
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
              mentionCandidates={group.members
                .filter((m) => m !== self.pubkey)
                .map((m) => ({ pubkey: m, name: senderName(m) }))}
              groupMembers={group.members.map((m) => ({ pubkey: m, name: senderName(m) }))}
              // 組織群（ADR-0049）由名冊權威管理，不開放手動增/移成員（避免與名冊分歧）。
              isGroupAdmin={group.admin === self.pubkey && !group.org}
              addableContacts={contacts
                .filter((c) => !group.members.includes(c.pubkey))
                .map((c) => ({ pubkey: c.pubkey, name: c.name }))}
              {...(activeBackend.addGroupMember
                ? { onAddMember: (m: string) => activeBackend.addGroupMember!(pk, m) }
                : {})}
              {...(activeBackend.removeGroupMember
                ? { onRemoveMember: (m: string) => activeBackend.removeGroupMember!(pk, m) }
                : {})}
              onSend={(text, _ttl, mentions, replyTo) => activeBackend.sendGroupMessage?.(pk, text, mentions, replyTo)}
              onTyping={() => {}}
              onNudge={() => {}}
              {...(group.announce && group.admin !== self.pubkey ? { readOnly: true } : {})}
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
        // 企業政策（ADR-0048）：停用檔案/通話時不傳對應 handler → UI 隱藏。
        const fileProps =
          activeBackend.sendFile && !policy.disableFiles ? { onSendFile: (f: File) => sendFile(pk, f) } : {};
        const callProps =
          activeBackend.startCall && !policy.disableCalls
            ? { onStartCall: (media: CallMedia) => activeBackend.startCall!(pk, media) }
            : {};
        const stickerProps = policy.disableStickers ? { stickersDisabled: true } : {};
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
            {...stickerProps}
            mentionCandidates={[{ pubkey: contact.pubkey, name: contact.name }]}
            onSend={(text, ttlSeconds, mentions, replyTo) =>
              activeBackend.sendMessage(pk, text, ttlSeconds, mentions, replyTo)
            }
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
  onAdd: (
    name: string,
    relayUrl: string,
    enterprise: boolean,
    opts: { nsec?: string | undefined; adminPubkey?: string | undefined },
  ) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [enterprise, setEnterprise] = useState(false);
  const [nsec, setNsec] = useState("");
  const [admin, setAdmin] = useState("");
  const submit = () => {
    if (!name.trim() || !relayUrl.trim()) return;
    try {
      onAdd(name.trim(), relayUrl.trim(), enterprise, {
        nsec: nsec.trim() || undefined,
        adminPubkey: enterprise ? admin.trim() || undefined : undefined,
      });
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
          {enterprise ? (
            <input
              className="groupmodal__name"
              placeholder="管理者 npub（可選，自動同步企業通訊錄）"
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
            />
          ) : null}
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

/** 組織名冊管理（ADR-0047）：每行「npub 名稱」→ 簽章發布 → 顯示供 relay 佈建的 allowlist。 */
function RosterAdminModal({
  selfNpub,
  onPublish,
  onCancel,
}: {
  selfNpub: string;
  onPublish: (org: string, members: OrgMember[], policy?: OrgPolicy, groups?: OrgGroup[]) => string[];
  onCancel: () => void;
}): JSX.Element {
  const [org, setOrg] = useState("");
  const [text, setText] = useState(selfNpub ? `${selfNpub} 管理者` : "");
  const [groupText, setGroupText] = useState("");
  const [rotText, setRotText] = useState("");
  const [pol, setPol] = useState<OrgPolicy>({});
  const [allowlist, setAllowlist] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const flip = (k: keyof OrgPolicy) => setPol((p) => ({ ...p, [k]: !p[k] }));
  const publish = () => {
    setError("");
    const members: OrgMember[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [np, ...rest] = t.split(/\s+/);
      try {
        members.push({ pubkey: npubDecode((np ?? "").trim()), name: rest.join(" ") || "成員" });
      } catch {
        setError(`無法解析：${t}`);
        return;
      }
    }
    // 身分輪替（ADR-0052）：每行 `舊npub 新npub [名稱]`；舊成員標記作廢、新 npub 補入。
    const rotations: { from: PubkeyHex; to: PubkeyHex; name?: string }[] = [];
    for (const line of rotText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [oldNp, newNp, ...rest] = t.split(/\s+/);
      try {
        rotations.push({
          from: npubDecode((oldNp ?? "").trim()),
          to: npubDecode((newNp ?? "").trim()),
          ...(rest.length > 0 ? { name: rest.join(" ") } : {}),
        });
      } catch {
        setError(`輪替無法解析：${t}`);
        return;
      }
    }
    const finalMembers = rotations.length > 0 ? applyRosterRotations(members, rotations) : members;
    if (finalMembers.length === 0) {
      setError("至少需要一位成員");
      return;
    }
    // 管理者自身公鑰（發布者）：自動納入每個群組，確保有人可管理／發布公告。
    let adminPubkey: PubkeyHex | null = null;
    try {
      adminPubkey = selfNpub ? npubDecode(selfNpub) : null;
    } catch {
      adminPubkey = null;
    }
    const groups: OrgGroup[] = [];
    for (const line of groupText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      // 格式：`群組名稱, npub, npub …`；名稱前綴 `!` 代表公告頻道（僅管理者可發文）。
      const parts = t.split(",").map((s) => s.trim()).filter(Boolean);
      const rawName = parts.shift() ?? "";
      const announce = rawName.startsWith("!");
      const name = (announce ? rawName.slice(1) : rawName).trim() || "群組";
      const gm = new Set<PubkeyHex>();
      if (adminPubkey) gm.add(adminPubkey);
      try {
        for (const np of parts) gm.add(npubDecode(np));
      } catch {
        setError(`群組無法解析：${t}`);
        return;
      }
      groups.push({ id: newGroupId(), name, members: [...gm], ...(announce ? { announce: true } : {}) });
    }
    try {
      const anyPol = Object.values(pol).some(Boolean);
      setAllowlist(
        onPublish(org.trim() || "組織", finalMembers, anyPol ? pol : undefined, groups.length ? groups : undefined),
      );
    } catch {
      setError("發布失敗");
    }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="組織名冊" onClick={onCancel}>
      <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>組織名冊（管理者佈建）</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label="關閉" onClick={onCancel}>×</span>
        </div>
        <div className="groupmodal">
          <input className="groupmodal__name" placeholder="組織名稱" value={org} onChange={(e) => setOrg(e.target.value)} />
          <div className="groupmodal__label">成員（每行：npub 名稱）</div>
          <textarea
            className="groupmodal__name"
            rows={6}
            aria-label="成員清單"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="groupmodal__label">政策（可選，集中控管）</div>
          <label className="groupmodal__item">
            <input type="checkbox" checked={!!pol.disableFiles} onChange={() => flip("disableFiles")} />
            <span>停用檔案傳輸</span>
          </label>
          <label className="groupmodal__item">
            <input type="checkbox" checked={!!pol.disableCalls} onChange={() => flip("disableCalls")} />
            <span>停用通話</span>
          </label>
          <label className="groupmodal__item">
            <input type="checkbox" checked={!!pol.disableStickers} onChange={() => flip("disableStickers")} />
            <span>停用貼圖</span>
          </label>
          <label className="groupmodal__item">
            <input type="checkbox" checked={!!pol.forceTurn} onChange={() => flip("forceTurn")} />
            <span>強制 TURN（不揭露內網 IP）</span>
          </label>
          <div className="groupmodal__label">組織群組（可選，每行：群組名稱, npub, npub…；名稱前綴 ! 為公告頻道）</div>
          <textarea
            className="groupmodal__name"
            rows={4}
            aria-label="組織群組"
            placeholder="!全體公告, npub1…, npub1…"
            value={groupText}
            onChange={(e) => setGroupText(e.target.value)}
          />
          <div className="groupmodal__label">身分輪替（可選，換機/遺失，每行：舊npub 新npub 名稱）</div>
          <textarea
            className="groupmodal__name"
            rows={3}
            aria-label="身分輪替"
            placeholder="npub1舊… npub1新… Alice"
            value={rotText}
            onChange={(e) => setRotText(e.target.value)}
          />
          {error ? <div className="text expired__text">{error}</div> : null}
          <button className="groupmodal__create" data-testid="roster-publish" onClick={publish}>
            簽章並發布名冊
          </button>
          {allowlist ? (
            <>
              <div className="groupmodal__label">✅ 已發布。以下 pubkey 供 relay allowedAuthors 佈建：</div>
              <textarea className="groupmodal__name" rows={4} readOnly value={allowlist.join("\n")} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
