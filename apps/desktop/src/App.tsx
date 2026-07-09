import {
  applyRosterRotations,
  type CallMedia,
  type CallState,
  generateSecretKey,
  getPublicKey,
  isBackupCode,
  newGroupId,
  npubDecode,
  nsecDecode,
  nsecEncode,
  type OrgGroup,
  type OrgMember,
  parseBackupCode,
  peekBackupRelay,
  type PubkeyHex,
} from "@cinder/core";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { BrowserChatBackend } from "./backend/browser-backend.js";
import { normalizeRelayUrl, RelayChatBackend, webSocketConnector } from "./backend/relay-backend.js";
import { getKeyVault } from "./native/keyvault.js";
import { isWrappedValue, passChange, passDisable, passEnable, passLock, passUnlock } from "./native/passlock.js";
import {
  activeDrain,
  activeProfile,
  adoptCloudSyncMode,
  changeProfileRelay,
  clearDrain,
  loadProfiles,
  type Profile,
  type ProfilesState,
  saveProfiles,
  setActive,
  setProfileCloudSync,
  setProfileSecurity,
  upsertProfile,
  visibleProfiles,
} from "./storage/profiles.js";
import { getDeviceId } from "./storage/device-id.js";
import type { CloudSyncMode } from "./storage/cloud-snapshot.js";
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
import { TauriStorage } from "./native/tauri-storage.js";
import type { AppStorage } from "./storage/types.js";
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
import {
  DEFAULT_OLLAMA,
  ollamaAvailable,
  ollamaRewrite,
  ollamaSummarize,
  type OllamaConfig,
} from "./native/ollama.js";
import { createPairingOffer, runPairSource, runPairTarget, webRtcPairTransport } from "./backend/pairing-session.js";
import { applyPairBundle } from "./storage/pair-bundle.js";
import { PairDeviceModal, type PairPhase } from "./ui/PairDeviceModal.js";
import { SettingsPanel } from "./ui/SettingsPanel.js";
import { RELAY_URL_KEY, SignIn } from "./ui/SignIn.js";
import { UnlockScreen } from "./ui/UnlockScreen.js";
import { SummaryModal } from "./ui/SummaryModal.js";
import "./ui/msn.css";

const TYPING_VISIBLE_MS = 6_000;
/** 閒置自動上鎖門檻（H4，ADR-0067）：啟用本地密碼的身分無操作逾時即上鎖。 */
const PASS_LOCK_MS = 5 * 60_000;
const NOTIFY_KEY = "nb.notify";
const READ_RECEIPTS_KEY = "nb.readReceipts";
const OLLAMA_KEY = "nb.ollama";

/** 本機 AI 改寫設定（ADR-0060）；`enabled` 開啟才在 composer 顯示 ✨。 */
interface OllamaState extends OllamaConfig {
  enabled: boolean;
}
const DEFAULT_OLLAMA_STATE: OllamaState = { ...DEFAULT_OLLAMA, enabled: false };

let _uid = 0;
const uid = (prefix: string): string => `${prefix}_${Date.now()}_${_uid++}`;

/**
 * 更換 relay 的守門（ADR-0066 H2，純函式可測）：回傳正規化後的新網址；
 * 無作用中身分、企業身分（鎖定漫遊，ADR-0044/0048）、非法網址或同值時回 null（no-op）。
 */
export function relayChangeTarget(p: Profile | null, url: string): string | null {
  if (!p || p.enterprise) return null;
  const norm = normalizeRelayUrl(url);
  if (!norm || norm === normalizeRelayUrl(p.relayUrl)) return null;
  return norm;
}

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
function buildBackend(p: Profile, nsecOverride?: string, storage?: AppStorage): ChatBackend {
  if (!p.relayUrl) return new BrowserChatBackend(p.name);
  const store = storage ?? new LocalStorage(p.namespace);
  const drain = activeDrain(p, Date.now()); // 搬家排水（ADR-0066 H3）：未到期才多訂舊站
  // 加密雲端快照（ADR-0071）：使用者開啟才發佈；企業政策 disableCloudBackup 由後端於名冊採用時再擋。
  const cloud =
    p.cloudSync && p.cloudSync !== "off" ? { cloudSync: { mode: p.cloudSync, deviceId: getDeviceId() } } : {};
  const opts = p.enterprise
    ? { relayUrl: p.relayUrl, ...cloud, ...(p.adminPubkey ? { orgAdminPubkey: p.adminPubkey } : {}) }
    : {
        relayUrl: p.relayUrl,
        ...cloud,
        ...(drain ? { drainUrl: drain.url } : {}),
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
        // durable 搬家（ADR-0069 T2/T3）：走 H2 保命名空間＋H3 排水，事後通知並重載。
        onHomeMigrate: (newUrl: string, reason: "dead" | "retired") => {
          const state = loadProfiles();
          if (!state.profiles.some((x) => x.pubkey === p.pubkey)) return;
          saveProfiles(changeProfileRelay(state, p.pubkey, newUrl));
          try {
            localStorage.setItem(RELAY_URL_KEY, newUrl);
          } catch {
            /* 忽略 */
          }
          try {
            window.alert(
              reason === "retired"
                ? `你的中繼站已被維護者標記退役，已自動搬家到 ${newUrl}。舊站來訊將續收 7 天（排水）。`
                : `你的中繼站已離線超過一天，已自動搬家到 ${newUrl}。舊站來訊將續收 7 天（排水）。`,
            );
          } catch {
            /* 忽略 */
          }
          try {
            location.reload();
          } catch {
            /* 忽略 */
          }
        },
      };
  return new RelayChatBackend(
    store,
    webSocketConnector(p.relayUrl),
    p.name,
    nsecOverride ? { ...opts, nsecOverride } : opts,
  );
}

/**
 * B5（ADR-0053）：在 Tauri 執行期取得某身分的私鑰——優先 OS 金鑰庫；若金鑰庫尚無、
 * 但 localStorage 仍有既有明文 nsec（舊版/首次遷移），將其搬入金鑰庫並**抹除明文**。
 * 回傳 nsec（供 buildBackend override）；找不到回 undefined。
 */
async function loadNsecFromVault(p: Profile): Promise<string | undefined> {
  const vault = getKeyVault();
  let nsec = await vault.getKey(p.pubkey);
  if (!nsec) {
    const legacy = new LocalStorage(p.namespace).loadIdentity();
    if (legacy?.nsec) {
      await vault.setKey(p.pubkey, legacy.nsec);
      // 抹掉 localStorage 內的明文私鑰（保留名稱），達成「私鑰不明文落地」。
      new LocalStorage(p.namespace).saveIdentity({ nsec: "", name: legacy.name });
      nsec = legacy.nsec;
    }
  }
  return nsec ?? undefined;
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
  /** 開機閘門（H4，ADR-0067）：作用中身分啟用本地密碼→先解鎖再建後端。 */
  const [lockedProfile, setLockedProfile] = useState<Profile | null>(null);
  /** 配對新裝置（D4a，ADR-0072）：舊機視角的階段狀態；null＝面板未開。 */
  const [pairPhase, setPairPhase] = useState<PairPhase | null>(null);
  const pairDecision = useRef<((ok: boolean) => void) | null>(null);
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
  const [readReceipts, setReadReceipts] = useState<boolean>(() => {
    try {
      return localStorage.getItem(READ_RECEIPTS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [ollama, setOllama] = useState<OllamaState>(() => {
    try {
      const raw = localStorage.getItem(OLLAMA_KEY);
      if (raw) return { ...DEFAULT_OLLAMA_STATE, ...(JSON.parse(raw) as Partial<OllamaState>) };
    } catch {
      /* 忽略 */
    }
    return DEFAULT_OLLAMA_STATE;
  });
  const updateOllama = (next: OllamaState): void => {
    setOllama(next);
    try {
      localStorage.setItem(OLLAMA_KEY, JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
  };
  // AI 改寫/摘要回呼：僅在啟用時提供（否則不顯示入口）。localOnly 由 ollama 設定內強制。
  const rewriteFn = ollama.enabled
    ? (text: string, instruction: string): Promise<string> => ollamaRewrite(text, instruction, ollama)
    : undefined;
  const checkAiAvailable = ollama.enabled ? (): Promise<boolean> => ollamaAvailable(ollama) : undefined;
  // 未讀摘要（點開對話前）：狀態驅動的小視窗。
  const [summary, setSummary] = useState<{ pubkey: string; status: "busy" | "done" | "error" | "empty"; text: string } | null>(
    null,
  );
  const summarizeUnread = (pubkey: string): void => {
    const n = unread[pubkey] ?? 0;
    const recent = (convos[pubkey] ?? []).filter((m) => !m.outgoing).slice(-(n || 5));
    if (recent.length === 0) {
      setSummary({ pubkey, status: "empty", text: "" });
      return;
    }
    setSummary({ pubkey, status: "busy", text: "" });
    const nameOf = (pk: string): string => contacts.find((c) => c.pubkey === pk)?.name ?? pk.slice(0, 8);
    const named = recent.map((m) => ({ sender: nameOf(m.sender ?? pubkey), text: m.text }));
    ollamaSummarize(named, ollama)
      .then((s) => setSummary({ pubkey, status: "done", text: s }))
      .catch(() => setSummary({ pubkey, status: "error", text: "" }));
  };
  const lastTyping = useRef<Record<string, number>>({});
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  // 已讀回條開關同步到後端（ADR-0058）；後端重建或開關變動時皆推送。
  useEffect(() => {
    backend?.setReadReceipts?.(readReceipts);
  }, [backend, readReceipts]);
  /** 作用中身分的儲存實例（D4a 配對匯出用；示範模式為 null）。 */
  const storageRef = useRef<AppStorage | null>(null);
  const selfRef = useRef<Self | null>(self);
  selfRef.current = self;
  const idleRef = useRef<IdleState>(initIdle(Date.now()));

  // 自動登入：以「作用中身分設定檔」建立後端（ADR-0045；相容既有單一身分）。
  // B5（ADR-0053）：Tauri 下私鑰改由 OS 金鑰庫提供，須先 async 載入才建後端；瀏覽器不變。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const active = activeProfile(profilesState);
        if (!active) return;
        let override: string | undefined;
        let storage: AppStorage | undefined;
        if (isTauri() && active.relayUrl) {
          // H4（ADR-0067）：啟用本地密碼的身分先出解鎖畫面——沒有密碼，金鑰庫裡只有密文。
          if (active.locked) {
            setLockedProfile(active);
            return;
          }
          // B2（ADR-0054）：從加密 blob 載入狀態；B5：私鑰自 OS 金鑰庫載入。
          const ts = new TauriStorage(active.namespace);
          await ts.hydrate();
          storage = ts;
          override = await loadNsecFromVault(active);
          // 審查修正 #3：金鑰庫是密碼包裹密文但 locked 旗標遺失（設定檔毀損/重建）——
          // 不能把 blob 當 nsec 用（會拋錯掉到 SignIn 誤建新身分）；修復旗標並走解鎖。
          if (override && isWrappedValue(override)) {
            if (cancelled) return;
            const repaired = setProfileSecurity(profilesState, active.pubkey, { locked: true });
            saveProfiles(repaired);
            setProfilesState(repaired);
            setLockedProfile({ ...active, locked: true });
            return;
          }
        }
        if (cancelled) return;
        // 配對匯出（D4a）需與後端同一份儲存；非 Tauri 走 LocalStorage 同命名空間。
        storageRef.current = storage ?? (active.relayUrl ? new LocalStorage(active.namespace) : null);
        const b = buildBackend(active, override, storage);
        setConn(active.relayUrl ? "connecting" : "online");
        setSelf({ ...b.self });
        setBackend(b);
      } catch {
        /* 忽略 */
      }
    })();
    // 僅在掛載時依當時作用中身分啟動；切換身分走 reload。
    return () => {
      cancelled = true;
    };
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
      onMessageStatus: (pk, messageId, status) =>
        setConvos((prev) => {
          const cur = prev[pk];
          if (!cur) return prev;
          let changed = false;
          const next = cur.map((m) => {
            if (m.id !== messageId || m.status === status) return m;
            changed = true;
            return { ...m, status };
          });
          return changed ? { ...prev, [pk]: next } : prev;
        }),
      onBlocked: setBlocked,
      onConnection: setConn,
      onRelayPool: setRelays,
      onPolicy: setPolicy,
      onCloudSyncMode: (mode) => {
        // ADR-0071：還原時採用快照傳播的模式——僅本機從未設定時（不覆蓋較新的手動選擇）。
        const state = loadProfiles();
        const p = activeProfile(state);
        if (!p) return;
        const next = adoptCloudSyncMode(state, p.pubkey, mode);
        if (next === state) return;
        saveProfiles(next);
        setProfilesState(next);
      },
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

  // 閒置自動上鎖（H4，ADR-0067）：啟用本地密碼的身分無操作逾時，清除原生金鑰快取
  // 並重載——重載後開機閘門回到解鎖畫面。重用與 away 相同的活動事件。
  useEffect(() => {
    const p = activeProfile(profilesState);
    if (!backend || !isTauri() || !p?.locked) return;
    const ns = p.namespace;
    let last = Date.now();
    const onActivity = () => {
      last = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - last < PASS_LOCK_MS) return;
      void passLock(ns).finally(() => {
        try {
          location.reload();
        } catch {
          /* 忽略 */
        }
      });
    }, 30_000);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      clearInterval(timer);
    };
  }, [backend, profilesState]);

  // 解鎖（H4）：驗密碼→取回 nsec 與 db 金鑰（原生快取）→照常建後端。
  const unlock = async (password: string): Promise<boolean> => {
    const p = lockedProfile;
    if (!p) return false;
    try {
      const nsec = await passUnlock(p.namespace, p.pubkey, password);
      const ts = new TauriStorage(p.namespace);
      await ts.hydrate();
      const b = buildBackend(p, nsec, ts);
      setConn(p.relayUrl ? "connecting" : "online");
      setSelf({ ...b.self });
      setBackend(b);
      setLockedProfile(null);
      return true;
    } catch {
      return false;
    }
  };

  // 解鎖隱藏身分（H4）：以密碼逐一嘗試隱藏身分，符合者切換過去（重載後再過解鎖閘門）。
  const unlockHidden = async (): Promise<void> => {
    const password = window.prompt("輸入隱藏身分的本地密碼");
    if (!password) return;
    const hidden = profilesState.profiles.filter((x) => x.hidden && x.pubkey !== profilesState.active);
    for (const p of hidden) {
      try {
        await passUnlock(p.namespace, p.pubkey, password);
        saveProfiles(setActive(profilesState, p.pubkey));
        try {
          location.reload();
        } catch {
          /* 忽略 */
        }
        return;
      } catch {
        /* 密碼不符此身分：試下一個 */
      }
    }
    window.alert("密碼不符任何隱藏身分");
  };

  const signIn = async (name: string, relayUrl: string) => {
    if (!relayUrl) {
      const b = new BrowserChatBackend(name);
      setConn("online");
      setSelf({ ...b.self });
      setBackend(b);
      return;
    }
    localStorage.setItem(RELAY_URL_KEY, relayUrl);
    // 第一個身分沿用舊鍵命名空間（空），達成向後相容
    const first: Profile = { pubkey: "", name, relayUrl, enterprise: false, namespace: "" };
    let b: ChatBackend;
    if (isTauri()) {
      // B5（ADR-0053）：私鑰本機產生後存 OS 金鑰庫，不落 localStorage。
      // B2（ADR-0054）：狀態走加密 blob（TauriStorage）而非 localStorage。
      const sk = generateSecretKey();
      const nsec = nsecEncode(sk);
      await getKeyVault().setKey(getPublicKey(sk), nsec);
      const ts = new TauriStorage(first.namespace);
      await ts.hydrate(); // 首個身分：空
      b = buildBackend(first, nsec, ts);
    } else {
      b = buildBackend(first); // 瀏覽器：後端自動產生 nsec 存 localStorage（既有行為）
    }
    const profile: Profile = { pubkey: b.self.pubkey, name, relayUrl, enterprise: false, namespace: "" };
    const next = upsertProfile(profilesState, profile);
    saveProfiles(next);
    setProfilesState(next);
    setConn("connecting");
    setSelf({ ...b.self });
    setBackend(b);
  };

  // 更換 home relay（ADR-0066 H2）：保留 namespace＝資料零損失；重載後開機廣播（H1）
  // 帶新 hint，聯絡人自動改道。
  const changeRelay = (url: string) => {
    const p = activeProfile(profilesState);
    const target = relayChangeTarget(p, url);
    if (!p || !target) return;
    saveProfiles(changeProfileRelay(profilesState, p.pubkey, target));
    try {
      localStorage.setItem(RELAY_URL_KEY, target);
    } catch {
      /* 忽略 */
    }
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  // 配對新裝置（D4a，ADR-0072；舊機／資料持有方）：產生一次性載荷 → 新機接上顯示 SAS
  // → 使用者確認相符才送出全量捆包。企業身分不提供（組織政策，ADR-0072 v1 排除）。
  const startPairDevice = () => {
    const p = activeProfile(profilesState);
    const store = storageRef.current;
    if (!p || !p.relayUrl || p.enterprise || !store) return;
    const { offer, key } = createPairingOffer(p.relayUrl); // 載荷帶會合 relay（新機尚無設定）
    setPairPhase({ kind: "offer", code: offer.code, expiresAt: offer.expiresAt });
    const transport = webRtcPairTransport(webSocketConnector);
    void runPairSource({
      key,
      storage: store,
      profile: { relayUrl: p.relayUrl, ...(p.cloudSync ? { cloudSync: p.cloudSync } : {}) },
      transport,
      confirmSas: (sas) =>
        new Promise<boolean>((resolve) => {
          setPairPhase({ kind: "sas", sas });
          pairDecision.current = (ok) => {
            pairDecision.current = null;
            setPairPhase(ok ? { kind: "sending" } : null);
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

  // 新機：貼上載荷 → 連線 → 顯示 SAS → 舊機確認後收捆包 → 寫入金鑰庫/儲存/登錄 → 重載。
  const importFromOldDevice = async (code: string, onSas: (sas: string) => void): Promise<void> => {
    const bundle = await runPairTarget({ code, transport: webRtcPairTransport(webSocketConnector), onSas });
    const nsec = bundle.snapshot.identity?.nsec;
    if (!nsec) throw new Error("配對捆包缺少身分");
    const pubkey = getPublicKey(nsecDecode(nsec));
    const name = bundle.snapshot.identity?.name ?? "我";
    const namespace = pubkey;
    if (isTauri()) {
      await getKeyVault().setKey(pubkey, nsec); // 私鑰進 OS 金鑰庫（ADR-0053）
      const ts = new TauriStorage(namespace);
      await ts.hydrate();
      applyPairBundle(ts, bundle);
      await ts.flush(); // 重載前確保加密 blob 落地
    } else {
      const ls = new LocalStorage(namespace);
      applyPairBundle(ls, bundle);
    }
    const profile: Profile = {
      pubkey,
      name,
      relayUrl: bundle.relayUrl,
      enterprise: false,
      namespace,
      ...(bundle.cloudSync ? { cloudSync: bundle.cloudSync } : {}),
    };
    saveProfiles(upsertProfile(loadProfiles(), profile));
    try {
      localStorage.setItem(RELAY_URL_KEY, bundle.relayUrl);
    } catch {
      /* 忽略 */
    }
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  // 提前完成排水（ADR-0066 H3）：移除舊站記錄後重載，乾淨收掉排水訂閱。
  const completeDrain = () => {
    const p = activeProfile(profilesState);
    if (!p) return;
    saveProfiles(clearDrain(profilesState, p.pubkey));
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
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
  const addIdentity = async (
    name: string,
    relayUrl: string,
    enterprise: boolean,
    opts: { nsec?: string | undefined; adminPubkey?: string | undefined } = {},
  ) => {
    const sk = opts.nsec?.trim() ? nsecDecode(opts.nsec.trim()) : generateSecretKey();
    const pubkey = getPublicKey(sk);
    if (isTauri()) {
      await getKeyVault().setKey(pubkey, nsecEncode(sk)); // B5：私鑰 → OS 金鑰庫，不落 localStorage
    } else {
      new LocalStorage(pubkey).saveIdentity({ nsec: nsecEncode(sk), name }); // 瀏覽器：既有行為
    }
    const admin = enterprise && opts.adminPubkey?.trim() ? normalizeAdminPubkey(opts.adminPubkey.trim()) : undefined;
    const profile: Profile = { pubkey, name, relayUrl, enterprise, namespace: pubkey, ...(admin ? { adminPubkey: admin } : {}) };
    saveProfiles(upsertProfile(profilesState, profile));
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  // H4（ADR-0067）：作用中身分已上鎖→解鎖畫面（不落 SignIn，避免誤建新身分）。
  if (lockedProfile && !backend) return <UnlockScreen name={lockedProfile.name} onUnlock={unlock} />;
  if (!backend || !self) return <SignIn onSignIn={signIn} onPair={importFromOldDevice} />;

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

  const toggleReadReceipts = () => {
    const next = !readReceipts;
    setReadReceipts(next);
    try {
      localStorage.setItem(READ_RECEIPTS_KEY, next ? "1" : "0");
    } catch {
      /* 忽略 */
    }
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

  // 跨身分互加防呆（ADR-0055）：加自己任一身分（作用中或其他 profile）都會把分身連結給
  // 中繼站、破壞區隔，故從介面擋下（丟 "self-identity" 讓 AddContact 顯示明確訊息）。
  const addContactGuarded = (input: string): void => {
    const raw = input.trim().split(/[@\s]+/, 1)[0] ?? "";
    const pk = npubDecode(raw); // 非法 npub → 由 AddContact 顯示「無效」
    if (profilesState.profiles.some((p) => p.pubkey === pk)) {
      throw new Error("self-identity");
    }
    activeBackend.addContact!(input);
  };
  const addContactProps = activeBackend.addContact
    ? {
        onAddContact: addContactGuarded,
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
            {visibleProfiles(profilesState).map((p) => (
              <option key={p.pubkey} value={p.pubkey}>
                {(p.enterprise ? "🏢 " : "👤 ") + p.name}
              </option>
            ))}
          </select>
          <button className="idbar__add" title="新增身分" onClick={() => setAddIdOpen(true)}>
            ＋
          </button>
          {isTauri() ? (
            <button className="idbar__add" title="解鎖隱藏身分" onClick={() => void unlockHidden()}>
              🔒
            </button>
          ) : null}
          {activeBackend.publishRoster ? (
            <button className="idbar__add" title="組織名冊（管理者）" onClick={() => setRosterOpen(true)}>
              🗂
            </button>
          ) : null}
        </div>
      ) : null}
      {addIdOpen ? (
        <AddIdentityModal defaultRelayUrl={activeProfile(profilesState)?.relayUrl ?? ""} onCancel={() => setAddIdOpen(false)} onAdd={addIdentity} />
      ) : null}
      {pairPhase ? (
        <PairDeviceModal
          phase={pairPhase}
          onConfirm={() => pairDecision.current?.(true)}
          onReject={() => pairDecision.current?.(false)}
          onClose={() => {
            pairDecision.current?.(false); // 關閉＝拒絕（不送包）
            setPairPhase(null);
          }}
        />
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
        {...(ollama.enabled ? { onSummarize: summarizeUnread } : {})}
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
          {...(() => {
            // 更換 relay（ADR-0066 H2）：個人身分可換；工作身分鎖定（顯示說明）；示範模式無此區塊。
            const p = activeProfile(profilesState);
            if (!p) return {};
            const drain = activeDrain(p, Date.now()); // H3：排水中顯示舊站與提前完成
            return {
              ...(p.enterprise ? { relayLocked: true } : { onRelayChange: changeRelay }),
              ...(drain ? { drain, onDrainComplete: completeDrain } : {}),
            };
          })()}
          {...(() => {
            // 配對新裝置（ADR-0072 D4a）：個人身分＋真實 relay 才提供（企業 v1 排除）。
            const p = activeProfile(profilesState);
            return p && p.relayUrl && !p.enterprise && storageRef.current
              ? { onPairDevice: () => startPairDevice() }
              : {};
          })()}
          {...(() => {
            // 加密雲端快照（ADR-0071）：三檔模式；示範模式與政策禁用時不顯示。
            const p = activeProfile(profilesState);
            if (!p || !p.relayUrl) return {};
            if (p.enterprise && policy.disableCloudBackup) return {};
            const mode: CloudSyncMode = p.cloudSync ?? "off";
            return {
              cloud: {
                mode,
                onChange: (m: CloudSyncMode) => {
                  if (m === mode) return;
                  if (m === "off") activeBackend.purgeCloudSnapshot?.(getDeviceId()); // 已關閉必須立即為真
                  const next = setProfileCloudSync(loadProfiles(), p.pubkey, m);
                  saveProfiles(next);
                  setProfilesState(next);
                  // 稍候讓 purge/設定送出，再重載以新模式重建後端。
                  setTimeout(() => {
                    try {
                      location.reload();
                    } catch {
                      /* 忽略 */
                    }
                  }, 500);
                },
                ...(mode !== "off" && activeBackend.publishSnapshotNow
                  ? { onBackupNow: () => activeBackend.publishSnapshotNow?.() }
                  : {}),
              },
            };
          })()}
          {...(() => {
            // 本地密碼（H4，ADR-0067）：僅 Tauri（KDF 在原生層）；示範模式/瀏覽器不顯示。
            const p = activeProfile(profilesState);
            if (!p || !isTauri()) return {};
            const flag = (patch: { locked?: boolean; hidden?: boolean }) => {
              const next = setProfileSecurity(loadProfiles(), p.pubkey, patch);
              saveProfiles(next);
              setProfilesState(next);
            };
            return {
              security: {
                enabled: !!p.locked,
                hidden: !!p.hidden,
                onEnable: async (pw: string) => {
                  try {
                    await passEnable(p.namespace, p.pubkey, pw);
                    flag({ locked: true });
                    return true;
                  } catch {
                    return false;
                  }
                },
                onChangePassword: async (oldPw: string, newPw: string) => {
                  try {
                    await passChange(p.namespace, p.pubkey, oldPw, newPw);
                    return true;
                  } catch {
                    return false;
                  }
                },
                onDisable: async (pw: string) => {
                  try {
                    await passDisable(p.namespace, p.pubkey, pw);
                    flag({ locked: false, hidden: false }); // 停用密碼＝隱藏一併解除
                    return true;
                  } catch {
                    return false;
                  }
                },
                onToggleHidden: () => flag({ hidden: !p.hidden }),
              },
            };
          })()}
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
          readReceipts={readReceipts}
          onToggleReadReceipts={toggleReadReceipts}
          ollama={ollama}
          onOllamaChange={updateOllama}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {summary ? (
        <SummaryModal
          status={summary.status}
          text={summary.text}
          contactName={contacts.find((c) => c.pubkey === summary.pubkey)?.name ?? ""}
          onOpen={() => {
            const pk = summary.pubkey;
            setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
            setSummary(null);
          }}
          onClose={() => setSummary(null)}
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
              {...(rewriteFn ? { onRewrite: rewriteFn } : {})}
              {...(checkAiAvailable ? { onCheckAiAvailable: checkAiAvailable } : {})}
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
            onMarkRead={() => {
              // 僅在視窗聚焦時送已讀（開著但沒看不算讀；ADR-0058）。
              if (typeof document === "undefined" || !document.hidden) activeBackend.markRead?.(pk);
            }}
            {...(rewriteFn ? { onRewrite: rewriteFn } : {})}
            {...(checkAiAvailable ? { onCheckAiAvailable: checkAiAvailable } : {})}
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
export function AddIdentityModal({
  defaultRelayUrl,
  onAdd,
  onCancel,
}: {
  /** relay 欄位預設值（帶入目前作用中身分的網址，可改）。 */
  defaultRelayUrl: string;
  onAdd: (
    name: string,
    relayUrl: string,
    enterprise: boolean,
    opts: { nsec?: string | undefined; adminPubkey?: string | undefined },
  ) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [relayUrl, setRelayUrl] = useState(defaultRelayUrl);
  const [enterprise, setEnterprise] = useState(false);
  const [nsec, setNsec] = useState("");
  const [admin, setAdmin] = useState("");
  // 加密備份碼匯入（ADR-0070）：偵測到備份碼即要求備份密碼；信封 relay（明文）自動預填。
  const [backupPw, setBackupPw] = useState("");
  const [backupErr, setBackupErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const isCode = isBackupCode(nsec.trim());
  const submit = () => {
    if (!name.trim() || !relayUrl.trim() || busy) return;
    const adminPubkey = enterprise ? admin.trim() || undefined : undefined;
    if (isCode) {
      if (!backupPw) return;
      // scrypt 解碼約需一秒（審查修正 #9）：先讓「還原中…」上畫再執行，避免無回饋凍結。
      setBusy(true);
      setTimeout(() => {
        try {
          const imported = parseBackupCode(nsec.trim(), backupPw).nsec;
          onAdd(name.trim(), relayUrl.trim(), enterprise, { nsec: imported, adminPubkey });
        } catch {
          setBackupErr(true); // 備份密碼錯誤：保留輸入
        } finally {
          setBusy(false);
        }
      }, 0);
      return;
    }
    try {
      onAdd(name.trim(), relayUrl.trim(), enterprise, { nsec: nsec.trim() || undefined, adminPubkey });
    } catch {
      setBackupErr(true); // 非法 nsec：保留輸入
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
            placeholder="匯入 nsec 或加密備份碼（留空＝產生新身分）"
            value={nsec}
            onChange={(e) => {
              const v = e.target.value;
              setNsec(v);
              setBackupErr(false);
              const relay = peekBackupRelay(v.trim());
              if (relay) setRelayUrl(relay); // 備份碼信封的 home relay 預填（可改）
            }}
          />
          {isCode ? (
            <input
              className="groupmodal__name"
              type="password"
              data-testid="backup-password"
              placeholder="備份密碼"
              value={backupPw}
              onChange={(e) => {
                setBackupPw(e.target.value);
                setBackupErr(false);
              }}
            />
          ) : null}
          {backupErr ? <p className="settings__warn">備份密碼錯誤或金鑰格式不符</p> : null}
          <button
            className="groupmodal__create"
            data-testid="add-identity-confirm"
            disabled={!name.trim() || !relayUrl.trim() || (isCode && !backupPw) || busy}
            onClick={submit}
          >
            {busy ? "還原中…" : "建立並切換"}
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
