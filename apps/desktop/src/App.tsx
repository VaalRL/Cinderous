import {
  applyRosterRotations,
  type CallMedia,
  type CallState,
  generateSecretKey,
  getPublicKey,
  isBackupCode,
  makeOrgInvite,
  newGroupId,
  newInviteToken,
  npubDecode,
  npubEncode,
  nsecDecode,
  nsecEncode,
  type OrgGroup,
  type OrgInvite,
  type OrgMember,
  parseBackupCode,
  parseOrgInvite,
  peekBackupRelay,
  type PubkeyHex,
} from "@cinderous/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { BrowserChatBackend } from "@cinderous/engine";
import { normalizeRelayUrl, RelayChatBackend, shouldMuteOrgNotification, webSocketConnector } from "@cinderous/engine";
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs, shouldNotify } from "@cinderous/engine";
import { browserStore } from "./native/browser-store.js";
import { safeNsecDecode } from "./nsec.js";
import { getKeyVault } from "./native/keyvault.js";
import { wipeDeviceLocal, wipeIdentityLocal } from "./native/wipe.js";
import { getNotifier, onNotificationClick } from "./native/notify.js";
import { pickFileToSend, readFileAtPath, saveIncomingFile, saveTextFile } from "./native/save-file.js";
import { onNativeFileDrop } from "./native/file-drop.js";
import { makeThumbnail } from "./ui/thumbnail.js";
import { useI18n } from "./i18n.js";
import { type Layout, useLayout } from "./layout.js";
import {
  browserIsRemembered,
  browserPassEnable,
  browserPassForget,
  browserPassUnlock,
  isWrappedValue,
  passChange,
  passDisable,
  passEnable,
  passLock,
  passRescue,
  passUnlock,
} from "./native/passlock.js";
import {
  activeDrain,
  activeProfile,
  adoptCloudSyncMode,
  changeProfileRelay,
  clearActive,
  loadProfiles,
  nameTaken,
  type Profile,
  type ProfilesState,
  removeProfile,
  resolveSignIn,
  saveProfiles,
  setActive,
  setProfileCloudSync,
  setProfileSecurity,
  upsertProfile,
  visibleProfiles,
} from "@cinderous/engine";
import { getDeviceId } from "@cinderous/engine";
import type { CloudSyncMode } from "@cinderous/engine";
import type {
  BlockedContact,
  ContactRequest,
  ChatBackend,
  ChatFile,
  ChatMessage,
  ConnectionState,
  Contact,
  Group,
  OrgInfo,
  OrgPolicy,
  OrgRosterDoc,
  Self,
  Status,
} from "@cinderous/engine";
import { LocalStorage, onStorageQuota, exportRecords, exportExtension, exportMime, type ExportFormat } from "@cinderous/engine";
import { TauriArchive } from "./native/tauri-archive.js";
import { HistoryWindow } from "./ui/HistoryWindow.js";
import { TauriStorage } from "./native/tauri-storage.js";
import type { AppStorage } from "@cinderous/engine";
import { cleanOnPasteEnabled, setCleanOnPasteEnabled } from "./ui/url-hygiene.js";
import { autoAcquireEnabled, setAutoAcquireEnabled } from "./ui/sticker-library.js";
import {
  allLabels,
  arrangeGroups,
  type GroupPrefsMap,
  isMuted,
  labelsOf,
  loadGroupPrefs,
  pruneGroup,
  saveGroupPrefs,
  withLabel,
  withMuted,
  withoutLabel,
  withPinned,
} from "./ui/group-labels.js";
import { ANCHOR_RELAYS, MAINTAINER_PUBKEY } from "@cinderous/engine";
import { initIdle, reduceIdle, type IdleState } from "./ui/idle-status.js";
import { setBroadcastAvatars } from "./ui/personalize.js";
import {
  enqueueSlot,
  loadSlotQueue,
  nextPending,
  removeSlot,
  retryFailed,
  saveSlotQueue,
  setSlotStatus,
  type SlotItem,
} from "./ui/slot-queue.js";
import { pickSlotFolder, setSlotDir, slotDir, storeSlotDeposit } from "./native/slot-store.js";
import { type EscrowEntry, loadEscrow, offboardedEntries, removeEscrow, saveEscrow, upsertEscrow } from "./ui/org-escrow.js";
import { loadPresence, savePresence } from "./ui/presence-store.js";
import { createRinger, createRingback, DEFAULT_CHIME_ID, playChime } from "./ui/ringtone.js";
import { CallWindow } from "./ui/CallWindow.js";
import { ContactListWindow } from "./ui/ContactListWindow.js";
import { DeckSidebar } from "./ui/DeckSidebar.js";
import { DeckRight } from "./ui/DeckRight.js";
import { DeckTabs } from "./ui/DeckTabs.js";
import { ConversationWindow } from "./ui/ConversationWindow.js";
import { useFloatingWindows } from "./ui/useFloatingWindow.js";
import {
  DEFAULT_OLLAMA,
  ollamaAvailable,
  ollamaRewrite,
  ollamaSummarize,
  type OllamaConfig,
} from "./native/ollama.js";
import { createPairingOffer, runPairSource, runPairTarget, webRtcPairTransport } from "@cinderous/engine";
import { applyPairBundle } from "@cinderous/engine";
import { PairDeviceModal, type PairPhase } from "./ui/PairDeviceModal.js";
import { SettingsPanel } from "./ui/SettingsPanel.js";
import { useRegisterIdentityControls, useRegisterSettingsOpener } from "./titlebar.js";
import { dialog, useDialog } from "./ui/Dialog.js";
import { ExportModal, type ExportConvoItem } from "./ui/ExportModal.js";
import { RELAY_URL_KEY, SignIn } from "./ui/SignIn.js";
import { RESCUE_RESET_OK, UnlockScreen } from "./ui/UnlockScreen.js";
import { SummaryModal } from "./ui/SummaryModal.js";
import "./ui/msn.css";

// 一次性遷移（ADR-0191 更名）：舊 localStorage 的 relay 子網域 whoami885 已失效 → cinderous1。
try {
  const legacyRelay = typeof localStorage !== "undefined" ? localStorage.getItem(RELAY_URL_KEY) : null;
  if (legacyRelay && legacyRelay.includes("whoami885")) {
    localStorage.setItem(RELAY_URL_KEY, legacyRelay.replace("whoami885", "cinderous1"));
  }
} catch {
  /* 無 localStorage（SSR/測試）→ 略過 */
}

const TYPING_VISIBLE_MS = 6_000;
/** 閒置自動上鎖門檻（H4，ADR-0067）：啟用本地密碼的身分無操作逾時即上鎖。 */
const PASS_LOCK_MS = 5 * 60_000;
const NOTIFY_KEY = "nb.notify";
// 通知子設定（ADR-0076）：提示音預設開、隱藏預覽預設關（顯示內文，LINE 風）。
const NOTIFY_SOUND_KEY = "nb.notifySound";
// 全域通知音效（ADR-0149）：合成預設集 id；未設＝經典叮咚。
const NOTIFY_CHIME_KEY = "nb.notifyChime";
const NOTIFY_PREVIEW_KEY = "nb.notifyHidePreview";
const NOTIFY_EVENTS_KEY = "nb.notifyEvents"; // ADR-0217：各事件通知開關
const READ_RECEIPTS_KEY = "nb.readReceipts";
// 企業主首次進入自動開名冊管理（ADR-0155）：建立時寫入、開啟一次即清除（跨 Tauri reload）。
const ROSTER_INTRO_PREFIX = "nb.rosterIntro.";
const INVISIBLE_KEY = "nb.invisible";
const OLLAMA_KEY = "nb.ollama";
// 每對話保留上限（ADR-0094）：裝置本地、不同步；`0`＝無上限（預設）。
const RETENTION_KEY = "nb.retentionCap";
function readRetentionCap(): number {
  try {
    return Math.max(0, parseInt(localStorage.getItem(RETENTION_KEY) ?? "0", 10) || 0);
  } catch {
    return 0;
  }
}

/** 本機 AI 改寫設定（ADR-0060）；`enabled` 開啟才在 composer 顯示 ✨。 */
interface OllamaState extends OllamaConfig {
  enabled: boolean;
}
const DEFAULT_OLLAMA_STATE: OllamaState = { ...DEFAULT_OLLAMA, enabled: false };

let _uid = 0;
const uid = (prefix: string): string => `${prefix}_${Date.now()}_${_uid++}`;

/** 就地更新某對話中，符合 `match` 的檔案訊息的附件欄位（ADR-0093）。 */
function patchFileWhere(
  prev: Record<string, ChatMessage[]>,
  pk: string,
  match: (m: ChatMessage) => boolean,
  patch: Partial<ChatFile>,
): Record<string, ChatMessage[]> {
  const cur = prev[pk];
  if (!cur) return prev;
  let changed = false;
  const next = cur.map((m) => {
    if (!m.file || !match(m)) return m;
    changed = true;
    return { ...m, file: { ...m.file, ...patch } };
  });
  return changed ? { ...prev, [pk]: next } : prev;
}

/** 依訊息 id 更新檔案附件（收檔回填：onFileBytes 的 messageId）。 */
function patchFileByMsgId(prev: Record<string, ChatMessage[]>, pk: string, messageId: string, patch: Partial<ChatFile>) {
  return patchFileWhere(prev, pk, (m) => m.id === messageId, patch);
}

/** 依傳輸 id 更新檔案附件（送出端併入本機 blob URL：file.id＝傳輸 id）。 */
function patchFileByTid(prev: Record<string, ChatMessage[]>, pk: string, tid: string, patch: Partial<ChatFile>) {
  return patchFileWhere(prev, pk, (m) => m.file?.id === tid, patch);
}

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

/** 身分類型圖示（ADR-0155/0163，純函式可測）：🗄 離職接管 ＞ 🗂 企業主 ＞ 🏢 企業成員 ＞ 👤 個人。 */
export function profileGlyph(p: Profile | null | undefined): string {
  return p?.orgOffboarded ? "🗄" : p?.orgOwner ? "🗂" : p?.enterprise ? "🏢" : "👤";
}

// 下班自動靜音（ADR-0157）：純函式已上移共用引擎（ADR-0175，消除桌面/行動端重複）；此處
// 再匯出，讓既有 import 路徑（含 App.test.tsx）不動。
export { shouldMuteOrgNotification };

/**
 * 登入建立身分的命名空間（ADR-0140，純函式可測）：
 *
 * **只有第一個身分**沿用空命名空間 `""`（向後相容 pre-multi-identity 的舊鍵）。若登錄裡**已有**
 * 身分佔用 `""`，再從登入頁建身分就必須用**自己的 pubkey 命名空間**——否則新身分會讀到第一個
 * 身分存在 `""` 的聯絡人/訊息（正是「新身分帶著舊聯絡人」的成因）。
 */
export function pickSignInNamespace(profiles: Profile[], pubkey: string): string {
  return profiles.some((p) => p.namespace === "") ? pubkey : "";
}

/**
 * 某對話當下是否「真的看得到」（ADR-0079 三欄修正）：視窗需聚焦，且——
 * 經典佈局所有視窗同時可見（只看聚焦）；三欄僅 active 分頁可見。
 * 供未讀累加與已讀回條共用，取代「只看 document.hidden」的舊假設。
 */
export function convoVisibleIn(layout: Layout, activeConvo: string | null, pk: string, hidden: boolean): boolean {
  if (hidden) return false;
  return layout !== "modern" || pk === activeConvo;
}

/**
 * 是否呈現「解鎖隱藏身分」🔒 入口（ADR-0199）。閘在「本機存在任一**已啟用密碼**的身分」，
 * 而**刻意不**閘在「存在隱藏身分」——否則 🔒 的出現本身就洩漏「這台裝置藏了帳號」，反噬
 * 隱藏身分要保護的否認性（ADR-0067）。「有密碼」≠「有隱藏」（可能只開了開機解鎖、沒藏東西），
 * 故此閘門既讓沒設密碼的常見情形看不到 🔒（UI 乾淨），又不洩漏是否真有隱藏身分。
 */
export function shouldOfferUnlockHidden(profiles: Profile[]): boolean {
  return profiles.some((p) => p.locked);
}

/**
 * 把某分頁移出後，作用中分頁該遞補誰（ADR-0079 Q3 修正）：非作用中則不動；
 * 否則挑相鄰（右側優先、否則左側最後一個）；清空回 null。
 */
export function nextActiveAfterRemoval(open: string[], pk: string, active: string | null): string | null {
  if (active !== pk) return active;
  const idx = open.indexOf(pk);
  const rest = open.filter((x) => x !== pk);
  return rest[Math.min(idx, rest.length - 1)] ?? null;
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
  // ADR-0164：本機記住的手動狀態——**建構時就 seed**，讓 start() 首拍 beat() 尊重離線（不事後補正）。
  const pref = loadPresence(p.pubkey);
  // 儲存一律由呼叫端提供（ADR-0119）：過去這裡會自己 `new LocalStorage(...)` 當退路，
  // 而呼叫端**也**各自建一份不帶金鑰的——結果真正被用的是沒加密的那份。單一來源見 `browserStore()`。
  const store = storage ?? browserStore(p.namespace, nsecOverride);
  const drain = activeDrain(p, Date.now()); // 搬家排水（ADR-0066 H3）：未到期才多訂舊站
  // 加密雲端快照（ADR-0071）：使用者開啟才發佈；企業政策 disableCloudBackup 由後端於名冊採用時再擋。
  const cloud =
    p.cloudSync && p.cloudSync !== "off" ? { cloudSync: { mode: p.cloudSync, deviceId: getDeviceId() } } : {};
  // ADR-0164：本機記住的手動狀態，建構時 seed（離職接管身分不套用——它是查看用、不還原上次狀態）。
  const presence = pref && !p.orgOffboarded ? { initialStatus: pref.status, initialStatusMessage: pref.statusMessage } : {};
  const opts = p.enterprise
    ? {
        relayUrl: p.relayUrl,
        ...cloud,
        ...presence,
        ...(p.adminPubkey ? { orgAdminPubkey: p.adminPubkey } : {}),
        ...(p.orgJoinToken ? { orgJoinToken: p.orgJoinToken } : {}), // ADR-0156：開機自動入職
        ...(p.orgEscrow ? { orgEscrow: true } : {}), // ADR-0163：公司帳號金鑰託管
      }
    : {
        relayUrl: p.relayUrl,
        ...cloud,
        ...presence,
        // 企業主（ADR-0155/0156）：訂自己的名冊找回狀態＋入職自動核准；其餘同個人身分。
        ...(p.orgOwner ? { orgOwner: true, ...(p.orgInviteToken ? { orgInviteToken: p.orgInviteToken } : {}) } : {}),
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
          // 非元件情境（後端回呼）→ 走模組級橋接的自訂對話框（ADR-0139）。
          void dialog().alert(
            reason === "retired"
              ? `你的中繼站已被維護者標記退役，已自動更換到 ${newUrl}。舊站來訊仍會續收 7 天。`
              : `你的中繼站已離線超過一天，已自動更換到 ${newUrl}。舊站來訊仍會續收 7 天。`,
          );
          try {
            location.reload();
          } catch {
            /* 忽略 */
          }
        },
      };
  // 🔴 ADR-0122：**告訴引擎「這應該是誰」**。拿不到金鑰時它會大聲失敗（IDENTITY_UNAVAILABLE），
  // 而不是靜默產生一把新的把使用者換掉。首次登入的設定檔還沒有 pubkey → 不傳（此時本來就沒有期待值）。
  const guard = p.pubkey ? { expectPubkey: p.pubkey } : {};
  return new RelayChatBackend(
    store,
    webSocketConnector(p.relayUrl),
    p.name,
    nsecOverride ? { ...opts, ...guard, nsecOverride } : { ...opts, ...guard },
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
  const { t } = useI18n(); // 通知隱藏預覽的本地化文案（ADR-0076）；其餘 UI 文字仍由子元件各自取用。
  const { alert, confirm, prompt } = useDialog(); // 統一自訂對話框（ADR-0139）。
  // 關閉視窗（Tauri）：Rust 攔下 close→emit「app://close-requested」，這裡以 app 風格確認框
  // 讓使用者選「縮到系統匣續連」或「直接結束」（ADR-0198，取代原生 rfd）。
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("app://close-requested", () => {
      void (async () => {
        const quit = await confirm({
          title: t("close_title"),
          message: t("close_message"),
          confirmLabel: t("close_quit"),
          cancelLabel: t("close_tray"),
        });
        await invoke(quit ? "quit_app" : "hide_to_tray");
      })();
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { layout } = useLayout(); // 桌面佈局（ADR-0079）：classic 浮動視窗 ↔ modern 三欄。
  const floatWins = useFloatingWindows(); // ADR-0216：經典右側浮動對話窗（拖曳/縮放/置頂/每窗記憶）。
  // ADR-0216：窄螢幕退回單欄檢視切換（主視窗 ↔ 對話滿版），不啟用浮動。
  const [isNarrow, setIsNarrow] = useState<boolean>(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 720px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 720px)");
    if (!mq) return;
    const on = (): void => setIsNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const [backend, setBackend] = useState<ChatBackend | null>(null);
  const [profilesState, setProfilesState] = useState<ProfilesState>(() => loadProfiles());
  // 明文身分索引（ADR-0203）：身分清單變動時同步給 Rust，供反安裝「一併清空」時 app 未跑仍能
  // 知道要刪哪些金鑰庫條目。pubkey/namespace 皆公開資訊；僅 Tauri。
  useEffect(() => {
    if (!isTauri()) return;
    const identities = profilesState.profiles.map((p) => ({ pubkey: p.pubkey, namespace: p.namespace }));
    void invoke("sync_identity_index", { identities }).catch(() => {});
  }, [profilesState]);
  const [self, setSelf] = useState<Self | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [convos, setConvos] = useState<Record<string, ChatMessage[]>>({});
  const [typingAt, setTypingAt] = useState<Record<string, number>>({});
  /** P2P 直連已建立的聯絡人（ADR-0213）：對話標題列據此顯示連線品質晶片。 */
  const [p2pConnected, setP2pConnected] = useState<Set<string>>(new Set());
  const [nudge, setNudge] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [unsent, setUnsent] = useState<Set<string>>(new Set());
  const [expired, setExpired] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<BlockedContact[]>([]);
  /** 訊息請求（ADR-0121）：陌生人傳來訊息但尚未接受。**不是聯絡人**。 */
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  /** 有封存的對話（ADR-0111）：只有真的有封存才顯示「歷史紀錄」入口。 */
  const [archived, setArchived] = useState<Record<string, number>>({});
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnectionState>("online");
  const [relays, setRelays] = useState<{ url: string; state: ConnectionState; home: boolean; stale: boolean }[]>([]);
  const [cleanPaste, setCleanPaste] = useState<boolean>(() => cleanOnPasteEnabled());
  const [autoAcquire, setAutoAcquire] = useState<boolean>(() => autoAcquireEnabled());
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
  const [activeConvo, setActiveConvo] = useState<string | null>(null); // 三欄中欄當前分頁（ADR-0079 Q3）。
  /** 開機閘門（H4，ADR-0067）：作用中身分啟用本地密碼→先解鎖再建後端。 */
  const [lockedProfile, setLockedProfile] = useState<Profile | null>(null);
  /** 瀏覽器：有設定檔但拿不到 nsec（沒記住／已忘記）→ 回登入畫面貼 nsec（ADR-0122）。 */
  const [needNsec, setNeedNsec] = useState<Profile | null>(null);
  /** 配對新裝置（D4a，ADR-0072）：舊機視角的階段狀態；null＝面板未開。 */
  const [pairPhase, setPairPhase] = useState<PairPhase | null>(null);
  const pairDecision = useRef<((ok: boolean) => void) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ADR-0151：⚙ 上移到自繪外框——把「開啟設定」註冊給標題列（僅 Tauri 有標題列會用到）。
  const registerSettingsOpener = useRegisterSettingsOpener();
  useEffect(() => {
    registerSettingsOpener(() => setSettingsOpen(true));
    return () => registerSettingsOpener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 註冊器來自 context、掛載一次即可
  }, []);
  // ADR-0206：三欄＋Tauri 把身分元件（切換/＋/🔒/🗂）上移標題列的註冊器（實際 bundle 於下方 effect 提供）。
  const registerIdentityControls = useRegisterIdentityControls();
  // 右欄計算機 → 主對話框的單向插入指令（ADR-0097）：nonce 變動即觸發，不接管草稿狀態。
  const [pendingInsert, setPendingInsert] = useState<{ convo: string; text: string; nonce: number } | null>(null);
  // 原生拖放（ADR-0104）：拖曳中被命中的對話（highlight 用）。
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropSendRef = useRef<((pk: string, paths: string[]) => void) | null>(null);
  // 明文紀錄導出（ADR-0094）：null＝關；[]＝全部；[keys]＝預選某對話。
  const [exportPreselect, setExportPreselect] = useState<string[] | null>(null);
  const setExportOpen = (open: boolean) => setExportPreselect(open ? [] : null);
  const [addIdOpen, setAddIdOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [policy, setPolicy] = useState<OrgPolicy>({});
  /** 組織資訊（ADR-0157）：採用名冊時由引擎發出；null＝非工作身分或尚未採用。 */
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  /** 入職金鑰託管（ADR-0163，企業主端）：依作用中身分載入。 */
  const [escrow, setEscrow] = useState<EscrowEntry[]>([]);
  useEffect(() => {
    const pk = profilesState.active;
    setEscrow(pk ? loadEscrow(pk) : []);
  }, [profilesState.active]);
  /** 公司儲存槽（ADR-0161）：員工端待存放佇列＋企業主端槽目錄（依身分載入）。 */
  const [slotQueue, setSlotQueue] = useState<SlotItem[]>([]);
  const [slotDirVal, setSlotDirVal] = useState("");
  const slotBusyRef = useRef(false);
  // 審查修正：以 ref 追蹤當前作用中 pubkey——updateSlotQueue 從 async 傳輸回呼觸發時，
  // 不能閉包捕捉舊 render 的 profilesState（瀏覽器「原地換身分」下會把 A 的佇列寫成 B 的內容）。
  const activePkRef = useRef(profilesState.active);
  activePkRef.current = profilesState.active;
  useEffect(() => {
    const pk = profilesState.active;
    if (!pk) return;
    setSlotQueue(loadSlotQueue(pk));
    setSlotDirVal(slotDir(pk));
  }, [profilesState.active]);
  const updateSlotQueue = (fn: (prev: SlotItem[]) => SlotItem[]): void => {
    setSlotQueue((prev) => {
      const next = fn(prev);
      const pk = activePkRef.current;
      if (pk && next !== prev) saveSlotQueue(pk, next);
      return next;
    });
  };
  const [notify, setNotify] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOTIFY_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 各事件通知開關（ADR-0217）；與舊 blob 合併 DEFAULT 以相容新增鍵。
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>(() => {
    try {
      const raw = localStorage.getItem(NOTIFY_EVENTS_KEY);
      return raw ? { ...DEFAULT_NOTIFY_PREFS, ...(JSON.parse(raw) as Partial<NotifyPrefs>) } : DEFAULT_NOTIFY_PREFS;
    } catch {
      return DEFAULT_NOTIFY_PREFS;
    }
  });
  const toggleNotifyEvent = (ev: keyof NotifyPrefs): void => {
    setNotifyPrefs((prev) => {
      const next = { ...prev, [ev]: !prev[ev] };
      try {
        localStorage.setItem(NOTIFY_EVENTS_KEY, JSON.stringify(next));
      } catch {
        /* 配額/不可用忽略 */
      }
      return next;
    });
  };
  const [notifySound, setNotifySound] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOTIFY_SOUND_KEY) !== "0"; // 預設開
    } catch {
      return true;
    }
  });
  const [notifyChime, setNotifyChime] = useState<string>(() => {
    try {
      return localStorage.getItem(NOTIFY_CHIME_KEY) ?? DEFAULT_CHIME_ID;
    } catch {
      return DEFAULT_CHIME_ID;
    }
  });
  const [notifyHidePreview, setNotifyHidePreview] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NOTIFY_PREVIEW_KEY) === "1"; // 預設關（顯示內文）
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
  const [invisible, setInvisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INVISIBLE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 每對話保留上限（ADR-0094）：0＝無上限（預設）。
  const [retentionCap, setRetentionCapState] = useState<number>(() => readRetentionCap());
  const [storageFull, setStorageFull] = useState<boolean>(false);
  const setRetentionCap = (n: number): void => {
    const v = Math.max(0, Math.floor(n));
    try {
      localStorage.setItem(RETENTION_KEY, String(v));
    } catch {
      /* 忽略 */
    }
    setRetentionCapState(v);
    if (v > 0) setStorageFull(false); // 設有限上限＝逐出釋放空間，清除滿載警告（若仍不足，下次寫入失敗會再現）
  };
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
  // 通知內容/音效需最新的聯絡人、群組與子設定；onMessage 閉包依 [backend]、故以 ref 取現值（ADR-0076）。
  const notifySoundRef = useRef(notifySound);
  notifySoundRef.current = notifySound;
  const notifyChimeRef = useRef(notifyChime);
  notifyChimeRef.current = notifyChime;
  const notifyHidePreviewRef = useRef(notifyHidePreview);
  notifyHidePreviewRef.current = notifyHidePreview;
  // ADR-0217：各事件通知開關與每對話靜音也走通知閉包 → ref。
  const notifyPrefsRef = useRef(notifyPrefs);
  notifyPrefsRef.current = notifyPrefs;
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  // ADR-0157：通知路徑（onMessage 閉包）要讀最新組織資訊 → ref。
  const orgInfoRef = useRef(orgInfo);
  orgInfoRef.current = orgInfo;
  // ADR-0154：把引擎帶出的廣播頭像鏡射到顯示層快取（<Avatar> 免穿 props 直接查）。
  useEffect(() => {
    setBroadcastAvatars(contacts.filter((c) => c.avatar).map((c) => [c.pubkey, c.avatar!] as [string, string]));
  }, [contacts]);
  /** 設定/移除自己的廣播頭像（ADR-0154）；回 false＝引擎拒收（格式防線），UI 提示。 */
  const broadcastSelfAvatar = (uri: string | undefined): boolean => backend?.setSelfAvatar?.(uri) ?? true;
  // 公司儲存槽背景傳輸（ADR-0161，員工端）：企業主在線且佇列有待傳項 → 逐一重讀原檔並 P2P 送出。
  useEffect(() => {
    const p = activeProfile(profilesState);
    const admin = p?.enterprise ? p.adminPubkey : undefined;
    if (!admin || !backend?.depositFile || slotBusyRef.current) return;
    if (!contacts.some((c) => c.pubkey === admin && c.status !== "offline")) return;
    const item = nextPending(slotQueue);
    if (!item) return;
    slotBusyRef.current = true;
    updateSlotQueue((q) => setSlotStatus(q, item.id, "sending"));
    void readFileAtPath(item.path)
      .then((picked) => {
        if (!picked) {
          // 原檔已被搬走/刪除（ADR-0103 語意）→ 標失敗，可於設定面板重試。
          updateSlotQueue((q) => setSlotStatus(q, item.id, "failed"));
          return;
        }
        backend.depositFile!(admin, { name: item.name, mime: item.mime, bytes: picked.bytes }, item.origin);
        updateSlotQueue((q) => setSlotStatus(q, item.id, "done"));
      })
      .catch(() => updateSlotQueue((q) => setSlotStatus(q, item.id, "failed")))
      .finally(() => {
        slotBusyRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, slotQueue, backend, profilesState]);
  // ADR-0155：企業主身分建立後首次進入 → 自動開啟名冊管理（旗標跨越 Tauri reload；用後即清）。
  useEffect(() => {
    const pk = profilesState.active;
    if (!pk || !backend?.publishRoster) return;
    try {
      if (localStorage.getItem(ROSTER_INTRO_PREFIX + pk) === "1") {
        localStorage.removeItem(ROSTER_INTRO_PREFIX + pk);
        setRosterOpen(true);
      }
    } catch {
      /* 忽略：仍可從 idbar 🗂 進入 */
    }
  }, [backend, profilesState.active]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const groupPrefsRef = useRef(groupPrefs); // ADR-0217：每對話靜音查詢（onMessage 閉包）
  groupPrefsRef.current = groupPrefs;
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const tRef = useRef(t);
  tRef.current = t;
  // 三欄可視性（ADR-0079）：讓 onMessage/visibilitychange 這類閉包 handler 讀到當前佈局與作用中分頁。
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const activeConvoRef = useRef(activeConvo);
  activeConvoRef.current = activeConvo;
  // 供 visibilitychange 等 `[]` 依賴的 handler 讀到當前後端與開啟中的對話（ADR-0108）。
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const openRef = useRef(open);
  openRef.current = open;
  // 已讀回條開關同步到後端（ADR-0058）；後端重建或開關變動時皆推送。
  useEffect(() => {
    backend?.setReadReceipts?.(readReceipts);
  }, [backend, readReceipts]);
  // 隱身開關同步到後端（ADR-0088）；後端重建或開關變動時皆推送。
  useEffect(() => {
    backend?.setInvisible?.(invisible);
  }, [backend, invisible]);
  // 每對話保留上限（ADR-0094）：後端重建或設定變動時，套用到當前身分的儲存（0＝無上限）。
  useEffect(() => {
    storageRef.current?.setMaxPerConvo(retentionCap);
  }, [backend, retentionCap]);
  // 無上限保留下 localStorage 撞配額時，提醒使用者（ADR-0094）。
  useEffect(() => {
    onStorageQuota(() => setStorageFull(true));
    return () => onStorageQuota(undefined);
  }, []);
  // 原生檔案拖放（ADR-0104）：Tauri 攔截 OS 拖放，HTML5 onDrop 不會觸發——沒有這條，
  // 打包後的桌面版拖放傳檔是壞的。OS 拖放另給**真實路徑**，故也能記下 savedPath。
  useEffect(() => {
    /** 座標（CSS px）落在哪個對話視窗上；沒命中回 null。 */
    const convoAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const win = (el as HTMLElement | null)?.closest?.("[data-convo]") as HTMLElement | null;
      return win?.dataset.convo ?? null;
    };
    return onNativeFileDrop({
      onHover: (x, y) => setDropTarget(convoAt(x, y)),
      onLeave: () => setDropTarget(null),
      onDrop: (paths, x, y) => {
        setDropTarget(null);
        // 掉在某個對話上就送那個；沒命中就送當前分頁（三欄常見情境）。
        const pk = convoAt(x, y) ?? activeConvoRef.current;
        if (pk) dropSendRef.current?.(pk, paths);
      },
    });
  }, []);
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
          ts.attachArchive(new TauriArchive(active.namespace)); // ADR-0111：加密塊檔封存
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
          // ADR-0140：金鑰庫取不到這個**已知身分**的 nsec（換機/金鑰庫遺失/舊狀態）——
          // 不能往下走：`buildBackend` 會因 expectPubkey 守衛拋 IDENTITY_UNAVAILABLE → 掉到通用登入頁，
          // 使用者一登入就建出重複身分（且讀到 `""` 命名空間的舊聯絡人）。改與瀏覽器對稱：引導**貼回
          // 這個身分的 nsec** 救回同一身分（`enterWithNsec` 會補寫金鑰庫，下次不再失敗）。
          if (!override && active.pubkey) {
            if (cancelled) return;
            setNeedNsec(active);
            return;
          }
        }

        // 🔴 瀏覽器（ADR-0122）：**這裡沒有金鑰庫，nsec 只活在記憶體裡** → 重載後就沒了。
        //
        // 過去這條路直接往下走：`override` 是 undefined → 儲存的 DEK 也是 undefined →
        // 讀不出（已加密的）identity → 引擎走 `generateSecretKey()` →
        // **使用者按一下重新整理就變成另一個人**，舊資料全部讀不出來，
        // 而且新的明文 nsec 被寫進 localStorage。實測確認過。
        //
        // 現在：沒有 nsec 就**不建後端**。有記住（Argon2id 包裹的 blob）→ 解鎖畫面；
        // 沒記住 → 回登入畫面貼 nsec。（`expectPubkey` 是最後一道保險，見引擎。）
        if (!isTauri() && active.relayUrl) {
          if (await browserIsRemembered(active.pubkey)) {
            if (cancelled) return;
            setLockedProfile({ ...active, locked: true });
            return;
          }
          if (cancelled) return;
          setNeedNsec(active); // → SignIn 的「用 nsec 登入」
          return;
        }

        if (cancelled) return;
        // 配對匯出（D4a）與保留上限（ADR-0094）需與後端**同一份**儲存；非 Tauri 走 LocalStorage 同命名空間。
        const store: AppStorage | undefined =
          storage ?? (active.relayUrl ? browserStore(active.namespace, override) : undefined);
        storageRef.current = store ?? null;
        const b = buildBackend(active, override, store);
        setConn(active.relayUrl ? "connecting" : "online");
        // ADR-0164：狀態已在 buildBackend 建構時 seed 進 b.self（initialStatus），故 setSelf 直接鏡射；
        // 稍後的閒置初始化讀 selfRef 也以此為基準，不會被重置回 online。
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
    setOrgInfo(null); // ADR-0157：換身分/後端時重置，避免沿用上一個身分的組織資訊
    setP2pConnected(new Set()); // ADR-0213：換身分/後端時清空 P2P 直連狀態，避免沿用上一個身分
    backend.start({
      onContacts: setContacts,
      onMessage: (pk, msg) => {
        setConvos((prev) => {
          const cur = prev[pk] ?? [];
          if (cur.some((m) => m.id === msg.id)) return prev;
          return { ...prev, [pk]: [...cur, msg] };
        });
        // 訊息請求（ADR-0121）：**不自動開窗、不跳通知**。它只出現在聯絡人清單上方的請求區，
        // 由使用者決定要不要接受。自動開窗等於讓陌生人強制彈出視窗——那就是騷擾。
        const isRequest = requestsRef.current.some((r) => r.pubkey === pk);
        if (!isRequest) setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
        // 未讀徽章：由後端從儲存推導（ADR-0108），UI 不再自行 +1。若該對話當下**看得到**，
        // 就立刻推進已讀水位（三欄背景分頁也算看不到，ADR-0079 修正）。
        // 桌面通知仍僅在整個視窗未聚焦時彈出（視窗聚焦時以未讀徽章提示即可，不打擾）。
        if (!msg.outgoing && !isRequest) {
          const hidden = typeof document !== "undefined" && document.hidden;
          if (convoVisibleIn(layoutRef.current, activeConvoRef.current, pk, hidden)) {
            backend.clearUnread?.(pk);
          }
          if (hidden) {
            const group = groupsRef.current.find((g) => g.id === pk);
            // 下班自動靜音（ADR-0157）：組織來源在表定時間外不彈通知；未讀照常。
            const nowMin = (() => {
              const d = new Date();
              return d.getHours() * 60 + d.getMinutes();
            })();
            const offHoursMuted = shouldMuteOrgNotification(
              orgInfoRef.current,
              group ? { orgGroup: group.org === true } : { senderContact: pk },
              nowMin,
            );
            // ADR-0217：事件開關（1:1/群組，含 @我 override）＋每對話靜音，收斂於 shouldNotify。
            if (
              shouldNotify(notifyPrefsRef.current, {
                event: group ? "group" : "dm",
                masterOn: notifyRef.current,
                windowHidden: hidden,
                offHoursMuted,
                convoMuted: isMuted(groupPrefsRef.current, pk),
                mentionsMe: !!msg.mentionsMe,
              })
            ) {
              // 標題＝該對話顯示名；隱藏預覽只顯示提示語；群訊前綴傳訊者名（ADR-0076）。
              const title = group?.name ?? contactsRef.current.find((c) => c.pubkey === pk)?.name ?? "Cinderous";
              let body: string;
              if (notifyHidePreviewRef.current) {
                body = tRef.current("notify_newMessage");
              } else if (group && msg.sender) {
                const sn = contactsRef.current.find((c) => c.pubkey === msg.sender)?.name ?? `${msg.sender.slice(0, 8)}…`;
                body = `${sn}: ${msg.text}`;
              } else {
                body = msg.text;
              }
              void getNotifier().notify({ title, body, convo: pk });
              if (notifySoundRef.current) {
                // ADR-0149：1:1 依聯絡人音效（未設→全域預設）；群組一律全域預設。
                const perContact = group ? undefined : contactsRef.current.find((c) => c.pubkey === pk)?.notifySound;
                playChime(perContact ?? notifyChimeRef.current);
              }
            }
          }
        }
      },
      onHistory: (pk, msgs) => {
        // 啟動回放：一次寫入該對話、且不自動開窗（使用者從清單點開才載入視窗）。
        setConvos((prev) => (prev[pk] ? prev : { ...prev, [pk]: msgs }));
      },
      onTyping: (pk) => setTypingAt((prev) => ({ ...prev, [pk]: Date.now() })),
      // ADR-0213：P2P 直連狀態 → 對話標題列晶片。connected 加入集合、斷線移除。
      onPeerConnection: (pk, connected) =>
        setP2pConnected((prev) => {
          if (prev.has(pk) === connected) return prev; // 無變化不重繪
          const next = new Set(prev);
          if (connected) next.add(pk);
          else next.delete(pk);
          return next;
        }),
      onNudge: (pk) => {
        setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
        setNudge((prev) => ({ ...prev, [pk]: (prev[pk] ?? 0) + 1 }));
        // ADR-0217：敲一敲通知（視窗未聚焦＋事件開關＋此對話未靜音）。
        const hidden = typeof document !== "undefined" && document.hidden;
        if (
          shouldNotify(notifyPrefsRef.current, {
            event: "nudge",
            masterOn: notifyRef.current,
            windowHidden: hidden,
            offHoursMuted: false,
            convoMuted: isMuted(groupPrefsRef.current, pk),
          })
        ) {
          const name = contactsRef.current.find((c) => c.pubkey === pk)?.name ?? "Cinderous";
          void getNotifier().notify({ title: name, body: tRef.current("notify_nudge"), convo: pk });
        }
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
      // 未讀由後端從儲存推導（ADR-0108）——重新載入後徽章仍在（過去是記憶體計數器，重載歸零）。
      onUnread: setUnread,
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
      onRequests: (reqs) => {
        // ADR-0121 清單設定 ＋ ADR-0217 opt-in 通知：僅對「新出現」的請求者提示一次（預設關）。
        const prev = new Set(requestsRef.current.map((r) => r.pubkey));
        const fresh = reqs.find((r) => !prev.has(r.pubkey));
        setRequests(reqs);
        const hidden = typeof document !== "undefined" && document.hidden;
        if (
          fresh &&
          shouldNotify(notifyPrefsRef.current, {
            event: "request",
            masterOn: notifyRef.current,
            windowHidden: hidden,
            offHoursMuted: false,
            convoMuted: false,
          })
        ) {
          void getNotifier().notify({
            title: tRef.current("request_section"),
            body: notifyHidePreviewRef.current ? tRef.current("notify_newMessage") : fresh.name,
          });
        }
      },
      onConnection: setConn,
      onRelayPool: setRelays,
      onPolicy: setPolicy,
      onOrgEscrow: (e) => {
        // ADR-0163：公司帳號成員入職託管的私鑰 → 持久化（依管理者身分），供日後離職接管。
        const adminPk = backend.self.pubkey;
        setEscrow((prev) => {
          const next = upsertEscrow(prev, { ...e, at: Date.now() });
          saveEscrow(adminPk, next);
          return next;
        });
      },
      onSlotDeposit: (sender, dep) => {
        // 公司儲存槽（ADR-0161，企業主端）：靜默落盤（無通知）；槽目錄未設＝appData 預設槽。
        const senderName = contactsRef.current.find((c) => c.pubkey === sender)?.name ?? sender.slice(0, 8);
        void storeSlotDeposit(slotDir(backend.self.pubkey), {
          senderName,
          senderPubkey: sender,
          name: dep.name,
          origin: dep.origin,
          bytes: dep.bytes,
        }).catch((e: unknown) => console.warn("[slot] 存放落盤失敗", e));
      },
      onOrgInfo: (info) => {
        // 組織資訊（ADR-0157）：供設定面板顯示與下班靜音判定。
        setOrgInfo(info);
        // 歡迎詞：首次或內容變更時一次性彈窗（標題＝公司名稱）；以身分為鍵記住已顯示的內容。
        if (info.welcome) {
          const key = `nb.orgWelcome.${backend.self.pubkey}`;
          try {
            if (localStorage.getItem(key) !== info.welcome) {
              localStorage.setItem(key, info.welcome);
              void alert({ title: info.org, message: info.welcome });
            }
          } catch {
            /* localStorage 不可用：寧可不重複彈，也不要每次開機都彈 */
          }
        }
      },
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
        setActiveConvo((a) => (a === from ? to : a)); // 三欄：當前分頁若被輪替，接續到新 npub（ADR-0079 修正）。
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
      onFileBytes: (pk, messageId, file) => {
        // 圖片縮圖（ADR-0102）：由位元組產生，持久化供跨 session 顯示（原檔位元組仍不保存）。
        void makeThumbnail(file.bytes, file.mime).then((thumb) => {
          if (thumb) backend.setFileThumb?.(pk, messageId, thumb);
        });
        // 收到位元組（ADR-0093）：跳「另存新檔」讓使用者選位置。App 不保管檔案本體，只回填路徑；
        // 訊息本身（metadata）已由 backend 經 onMessage/onHistory 建好，這裡只更新該則的檔案欄位。
        void saveIncomingFile(file.name, file.mime, file.bytes).then((res) => {
          setConvos((prev) =>
            patchFileByMsgId(prev, pk, messageId, {
              sent: file.bytes.length,
              ...(res.savedPath ? { savedPath: res.savedPath } : {}),
              ...(res.url ? { url: res.url } : {}),
            }),
          );
          if (res.savedPath) backend.setFileSavedPath?.(pk, messageId, res.savedPath);
        });
        setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
      },
      // 縮圖產生完成（ADR-0102）：不等重載就顯示。
      onFileThumb: (pk, messageId, thumb) =>
        setConvos((prev) => patchFileByMsgId(prev, pk, messageId, { thumb })),
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
        // ADR-0217：來電通知（視窗未聚焦＋事件開關＋此對話未靜音）；響鈴仍由下方 useEffect 處理。
        if (state === "incoming" && peer) {
          const hidden = typeof document !== "undefined" && document.hidden;
          if (
            shouldNotify(notifyPrefsRef.current, {
              event: "call",
              masterOn: notifyRef.current,
              windowHidden: hidden,
              offHoursMuted: false,
              convoMuted: isMuted(groupPrefsRef.current, peer),
            })
          ) {
            const name = contactsRef.current.find((c) => c.pubkey === peer)?.name ?? "Cinderous";
            void getNotifier().notify({ title: name, body: tRef.current("notify_call"), convo: peer });
          }
        }
      },
      onCallLocalStream: setLocalStream,
      onCallRemoteStream: setRemoteStream,
      onGroups: setGroups,
    });
    // ADR-0164：狀態已於 buildBackend 建構時 seed 進 self（initialStatus），start() 首拍 beat()
    // 就尊重離線——不再事後 setStatus 補正（那會先漏一拍上線信標，見程式碼審查 CRITICAL 修正）。
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

  // 視窗重新聚焦時清未讀：經典＝所有**開啟中**的對話都看得到故全清；三欄＝只有 active 分頁可見，
  // 只清它（ADR-0079 修正）。改推進本機已讀水位（ADR-0108）→ 重載後不會又冒出來。
  //
  // 註：舊版經典佈局是 `setUnread({})`——把**每一個**對話（含從沒開過的）都清成 0。
  // 那本來就是 bug，而水位一旦持久化就會變成永久的（那些訊息再也不亮紅點），故一併修正為
  // 只清開啟中的對話。
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      const b = backendRef.current;
      if (!b) return;
      if (layoutRef.current === "modern") {
        const a = activeConvoRef.current;
        if (a) b.clearUnread?.(a);
      } else {
        for (const pk of openRef.current) b.clearUnread?.(pk);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 通知點擊（ADR-0076 N3）：叫回視窗後開啟該對話並置前；三欄下一併設為當前分頁並清未讀（ADR-0079 修正）。
  useEffect(() => {
    return onNotificationClick((convo) => {
      if (!convo) return;
      setOpen((prev) => (prev.includes(convo) ? [...prev.filter((x) => x !== convo), convo] : [...prev, convo]));
      setActiveConvo(convo);
      backendRef.current?.clearUnread?.(convo); // 推進本機水位（ADR-0108）；回條交由視窗可見時的 onMarkRead
    });
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
  // 以取得的 nsec 建後端並進入（解鎖與救援共用）。
  const enterWithNsec = async (p: Profile, nsec: string): Promise<boolean> => {
    // ADR-0119 修正：舊版**無條件** `new TauriStorage()`——在瀏覽器 `invoke()` 必然 reject，
    // 於是 ADR-0112 才剛加的「瀏覽器本地密碼解鎖」**永遠打不開**。必須分流。
    let store: AppStorage;
    if (isTauri()) {
      // ADR-0140：救回時把 nsec 補回 OS 金鑰庫——若這次是因金鑰庫遺失才走到救援，補寫後下次重載
      // 就能自動載入、不再掉登入頁（治本觸發點）。金鑰庫以 pubkey 為鍵，冪等。
      await getKeyVault().setKey(p.pubkey, nsec);
      const ts = new TauriStorage(p.namespace);
      await ts.hydrate();
      ts.attachArchive(new TauriArchive(p.namespace)); // ADR-0111
      store = ts;
    } else {
      store = browserStore(p.namespace, nsec); // 以解出的 nsec 導出 DEK（ADR-0112）
    }
    storageRef.current = store; // ADR-0094：讓保留上限與導出用到後端同一份儲存
    const b = buildBackend(p, nsec, store);
    setConn(p.relayUrl ? "connecting" : "online");
    setSelf({ ...b.self });
    setBackend(b);
    setLockedProfile(null);
    setNeedNsec(null); // ADR-0122
    return true;
  };

  const unlock = async (password: string): Promise<boolean> => {
    const p = lockedProfile;
    if (!p) return false;
    try {
      if (!isTauri()) {
        // 瀏覽器（ADR-0112）：Argon2id 在 JS 解包（參數與原生版一致）。
        const nsec = await browserPassUnlock(p.pubkey, password);
        return nsec ? await enterWithNsec(p, nsec) : false;
      }
      return await enterWithNsec(p, await passUnlock(p.namespace, p.pubkey, password));
    } catch {
      return false;
    }
  };

  // 忘記密碼救援（ADR-0073）：以 nsec 解回資料金鑰、設新密碼、救回舊本地資料後進入。
  const rescue = async (nsec: string, newPassword: string): Promise<boolean> => {
    const p = lockedProfile;
    if (!p) return false;

    // 瀏覽器（ADR-0122）：沒有 ADR-0073 的雙重包裹（那是原生層的東西），但也**不需要**——
    // DEK 本來就由 nsec 導出（ADR-0112）。所以救援＝「用 nsec 重新包裹一個新密碼」，
    // 資料自然解得開。重用同一個 `RescueFn` 契約與同一個 UI，不另開畫面。
    if (!isTauri()) {
      let pubkey: string;
      try {
        pubkey = getPublicKey(nsecDecode(nsec.trim()));
      } catch {
        return false; // 不是合法的 nsec
      }
      if (pubkey !== p.pubkey) return false; // 是別人的金鑰 → 解不開這個 namespace 的資料
      await browserPassEnable(pubkey, nsec.trim(), newPassword);
      try {
        return await enterWithNsec(p, nsec.trim());
      } catch {
        throw new Error(RESCUE_RESET_OK);
      }
    }

    // passRescue 失敗＝nsec／備份碼不符或無救援資料 → 讓上層報「救援失敗」（回 false）。
    let key: string;
    try {
      key = await passRescue(p.namespace, p.pubkey, nsec, newPassword);
    } catch {
      return false;
    }
    // 密碼此刻已重設成功；後續自動進入若失敗屬另一類問題，不能誤報「救援失敗」（審查 F3）。
    try {
      return await enterWithNsec(p, key);
    } catch {
      throw new Error(RESCUE_RESET_OK);
    }
  };

  // 用其他身分登入（ADR-0211）：在解鎖畫面清掉作用中選擇→回登入頁的名稱欄，讓使用者以
  // 顯示名稱挑另一把私鑰（名稱選、密碼解）。等同軟登出（clearActive）但不重載——直接回 SignIn。
  // 不刪任何身分：所有已記住的身分仍在登錄，打對名稱即可命中並解鎖。
  const switchIdentity = (): void => {
    const next = clearActive(profilesState);
    saveProfiles(next);
    setProfilesState(next);
    setLockedProfile(null);
  };

  // 解鎖隱藏身分（H4）：以密碼逐一嘗試隱藏身分，符合者切換過去（重載後再過解鎖閘門）。
  const unlockHidden = async (): Promise<void> => {
    const password = await prompt({ message: t("hiddenId_prompt"), password: true });
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
    await alert(t("hiddenId_fail"));
  };

  const signIn = async (name: string, relayUrl: string, password?: string) => {
    // ADR-0146：先以顯示名稱解析既有身分。名稱只是「選哪個身分」的查找鍵（非加密鍵）——
    // 命中既有＝切為作用中並重載，重用開機的解鎖/救援路徑（Fix First），不建重複；
    // 多個同名（僅可能來自舊資料）擋下不靜默進入；無命中才往下建新身分。
    const resolution = resolveSignIn(profilesState, name);
    if (resolution.kind === "enter") {
      saveProfiles(setActive(profilesState, resolution.profile.pubkey));
      location.reload();
      return;
    }
    if (resolution.kind === "ambiguous") {
      await alert(t("signIn_ambiguousName"));
      return;
    }
    if (!relayUrl) {
      const b = new BrowserChatBackend(name);
      setConn("online");
      setSelf({ ...b.self });
      setBackend(b);
      return;
    }
    localStorage.setItem(RELAY_URL_KEY, relayUrl);
    // 金鑰在此一次產生（兩條路徑共用同一把）。ADR-0140：命名空間只有**第一個身分**才用 `""`；
    // 已有身分佔用 `""` 時，新身分用自己的 pubkey 命名空間，避免讀到第一個身分的資料。
    const sk = generateSecretKey();
    const nsec = nsecEncode(sk);
    const pubkey = getPublicKey(sk);
    const namespace = pickSignInNamespace(profilesState.profiles, pubkey);
    const first: Profile = { pubkey, name, relayUrl, enterprise: false, namespace };
    let b: ChatBackend;
    if (isTauri()) {
      // B5（ADR-0053）：私鑰本機產生後存 OS 金鑰庫，不落 localStorage。
      // B2（ADR-0054）：狀態走加密 blob（TauriStorage）而非 localStorage。
      await getKeyVault().setKey(pubkey, nsec);
      const ts = new TauriStorage(namespace);
      await ts.hydrate(); // 首個身分：空
      storageRef.current = ts; // ADR-0094：與後端同一份儲存
      b = buildBackend(first, nsec, ts);
    } else {
      // 瀏覽器（ADR-0119 修正）：**絕不讓後端自己產生 nsec 並存進 localStorage**。
      // 舊版 `buildBackend(first, undefined, ls)` 不帶 nsecOverride → 後端 `generateSecretKey()` ＋
      // `storage.saveIdentity()` → **私鑰明文寫進 localStorage**（keyvault 的「拒收明文」守衛
      // 完全繞過，因為這條路根本不經過 keyvault）。ADR-0112 的紅線在這裡破了一個大洞。
      //
      // 現在：以上面產生的 nsec 交給 `buildBackend` 當 override（後端不會落地它），
      // 並以它導出 DEK 加密 localStorage。
      const ls = browserStore(namespace, nsec);
      storageRef.current = ls; // ADR-0094：與後端同一份儲存
      b = buildBackend(first, nsec, ls);
      ls.saveIdentity({ nsec: "", name }); // 只存名稱；私鑰不落地

      // 🔴 ADR-0122：**這把 nsec 使用者從沒看過**，而瀏覽器沒有 OS 金鑰庫。
      // 不以密碼包裹它，使用者按一下重新整理，身分就永久消失。所以密碼在這條路徑上**必填**
      //（`SignIn` 已擋在前面；這裡是最後一道）。磁碟上只有 Argon2id 密文，KEK 從不落盤。
      if (!password) throw new Error("瀏覽器登入必須設定本機密碼（ADR-0122）");
      await browserPassEnable(pubkey, nsec, password);
    }
    const profile: Profile = {
      pubkey,
      name,
      relayUrl,
      enterprise: false,
      namespace,
      ...(password ? { locked: true } : {}), // 瀏覽器：下次開機走解鎖畫面
    };
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
    // ADR-0118：**私鑰不在 AppStorage 裡**（Tauri 走 OS 金鑰庫、瀏覽器只存包裹過的 blob），
    // 必須顯式傳入身分——否則捆包的 identity 是 null，新機收到後才拋「缺少身分」。
    const nsec = backend?.selfNsec;
    if (!nsec) {
      setPairPhase({ kind: "error", message: "無法取得身分私鑰" });
      return;
    }
    const { offer, key } = createPairingOffer(p.relayUrl); // 載荷帶會合 relay（新機尚無設定）
    setSettingsOpen(false); // 設定面板在 DOM 中位於配對面板之後，不關會蓋住 SAS 確認鈕
    setPairPhase({ kind: "offer", code: offer.code, expiresAt: offer.expiresAt });
    const transport = webRtcPairTransport(webSocketConnector);
    void runPairSource({
      key,
      storage: store,
      identity: { nsec, name: p.name },
      profile: {
        relayUrl: p.relayUrl,
        ...(p.cloudSync ? { cloudSync: p.cloudSync } : {}),
        // ADR-0172：搬家帶上企業身分精華，讓新機（尤其行動端）還原「這是工作/企業主身分」並設閘企業 UI。
        ...(p.enterprise || p.orgOwner || p.adminPubkey || p.orgJoinToken || p.orgEscrow
          ? {
              org: {
                ...(p.enterprise ? { enterprise: true } : {}),
                ...(p.orgOwner ? { orgOwner: true } : {}),
                ...(p.adminPubkey ? { adminPubkey: p.adminPubkey } : {}),
                ...(p.orgJoinToken ? { orgJoinToken: p.orgJoinToken } : {}),
                ...(p.orgEscrow ? { orgEscrow: true } : {}),
                ...(p.orgInviteToken ? { orgInviteToken: p.orgInviteToken } : {}),
              },
            }
          : {}),
      },
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
      // ADR-0119 修正：瀏覽器必須以 nsec 導出的 DEK 加密（否則捆包裡的**真實 nsec** 與全部歷史
      // 都明文落盤）。這是 ADR-0118 修好捆包身分後**才暴露出來**的迴歸——在那之前捆包根本沒有
      // nsec，所以從未真的洩漏過。
      const ls = browserStore(namespace, nsec);
      applyPairBundle(ls, bundle);
      ls.saveIdentity({ nsec: "", name }); // 私鑰不落地；要「記住我」須另設本地密碼
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

  // 軟登出（ADR-0201）：只結束作用中 session、清 active 後重載回登入頁；**保留所有身分與資料**
  // 於本機（有密碼者下次需解鎖）。與「移除此身分／清空裝置」的破壞性動作刻意分開。
  const logout = async () => {
    if (!(await confirm({ message: t("settings_logoutConfirm"), confirmLabel: t("settings_logout") }))) return;
    saveProfiles(clearActive(profilesState));
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  // 移除此身分（ADR-0202，破壞性）：刪本機金鑰＋儲存＋登錄。若刪的是作用中，reload 後遞補或回登入。
  const removeIdentity = async (pubkey: string) => {
    const p = profilesState.profiles.find((x) => x.pubkey === pubkey);
    if (!p) return;
    if (!(await confirm({ message: t("settings_removeIdentityConfirm"), confirmLabel: t("settings_removeIdentity"), danger: true }))) return;
    await wipeIdentityLocal(p);
    saveProfiles(removeProfile(profilesState, pubkey));
    try {
      location.reload();
    } catch {
      /* 忽略 */
    }
  };

  // 清空裝置（ADR-0202，破壞性、不可逆）：刪**所有**身分的金鑰＋儲存＋WebView 資料。
  // 輸入片語（CLEAR）才執行——避免誤觸；提示先備妥救援登入碼。
  const wipeDevice = async () => {
    const word = t("wipe_confirmWord");
    const typed = await prompt({ message: t("wipe_confirm", { word }), confirmLabel: t("wipe_device") });
    if (typed === null) return; // 取消
    if (typed.trim().toUpperCase() !== word.toUpperCase()) {
      await alert(t("wipe_mismatch"));
      return;
    }
    await wipeDeviceLocal(profilesState.profiles);
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
    opts: {
      nsec?: string | undefined;
      adminPubkey?: string | undefined;
      password?: string | undefined;
      orgOwner?: boolean | undefined;
      /** 入職權杖（ADR-0156）：來自邀請碼；成員身分開機自動向管理者提出入職。 */
      orgJoinToken?: string | undefined;
      /** 公司帳號金鑰託管（ADR-0163）：入職時把 nsec 託管給雇主。 */
      orgEscrow?: boolean | undefined;
      /** 離職接管身分（ADR-0163）：以託管金鑰匯入的離職員工身分（純本機、不再入職/廣播）。 */
      orgOffboarded?: boolean | undefined;
    } = {},
  ) => {
    const sk = opts.nsec?.trim() ? nsecDecode(opts.nsec.trim()) : generateSecretKey();
    const nsec = nsecEncode(sk);
    const pubkey = getPublicKey(sk);
    const admin = enterprise && opts.adminPubkey?.trim() ? normalizeAdminPubkey(opts.adminPubkey.trim()) : undefined;
    const profile: Profile = {
      pubkey,
      name,
      relayUrl,
      enterprise,
      namespace: pubkey,
      ...(admin ? { adminPubkey: admin } : {}),
      // ADR-0155/0156：企業主標記＋核准權杖（嵌入邀請碼）；成員帶入職權杖。
      ...(opts.orgOwner ? { orgOwner: true, orgInviteToken: newInviteToken() } : {}),
      // 離職接管身分（ADR-0163）：不入職、不託管——只是本機查看用；故不帶 orgJoinToken/orgEscrow。
      ...(opts.orgOffboarded
        ? { orgOffboarded: true }
        : {
            ...(enterprise && admin && opts.orgJoinToken ? { orgJoinToken: opts.orgJoinToken } : {}),
            ...(enterprise && admin && opts.orgEscrow ? { orgEscrow: true } : {}), // ADR-0163
          }),
      ...(!isTauri() ? { locked: true } : {}), // 瀏覽器：以密碼包裹（ADR-0122）→ 下次開機走解鎖
    };
    const next = upsertProfile(profilesState, profile);
    saveProfiles(next);
    // ADR-0155：企業主建立後首次進入自動開名冊管理。Tauri 走 reload → 旗標跨越重載；
    // 瀏覽器原地切換 → 下方直接開。
    if (opts.orgOwner) {
      try {
        localStorage.setItem(ROSTER_INTRO_PREFIX + pubkey, "1");
      } catch {
        /* 忽略：開不了介紹彈窗仍可從 idbar 🗂 進入 */
      }
    }

    if (isTauri()) {
      await getKeyVault().setKey(pubkey, nsec); // B5：私鑰 → OS 金鑰庫，不落 localStorage
      // 金鑰庫記得住 → 重載後 `keyOf()` 取得回來。
      try {
        location.reload();
      } catch {
        /* 忽略 */
      }
      return;
    }

    // 瀏覽器（ADR-0119 修正）——**這裡曾經會造出一個永遠打不開的身分**：
    //
    // ADR-0112 立下「nsec 絕不明文落盤」之後，這條路變成「產生 sk → 只存名字 → `location.reload()`」。
    // 而 `sk` 只活在這個函式的作用域裡：**重載後它就消失了**。使用者若是「新產生」身分（而非匯入），
    // 他從頭到尾**沒看過那把 nsec**，重載後系統卻要他貼上 nsec 才能進去——
    // **他剛建立了一個自己永遠進不去的身分，而且它還是當前作用中的設定檔。**
    //
    // 桌面沒事（nsec 進了 OS 金鑰庫，重載後撈得回來）。壞的只有瀏覽器。
    //
    // 修法是**不要重載**：nsec 就在手上，直接原地換後端（和首次登入、解鎖走同一條路）。
    // `setBackend()` 的 effect 會自動 stop 舊後端、start 新的。
    //
    // ADR-0122 補上另一半：**把 nsec 以密碼包裹落盤**。否則「不重載」只擋得住這一次——
    // 使用者下次自己按重新整理，這個新身分照樣消失。
    if (!opts.password) throw new Error("瀏覽器新增身分必須設定本機密碼（ADR-0122）");
    await browserPassEnable(pubkey, nsec, opts.password);
    setProfilesState(next);
    await enterWithNsec(profile, nsec);
    // 只存名稱（供身分清單顯示）；私鑰不落地。要「記住我」須在設定裡啟用本地密碼（Argon2id 包裹）。
    storageRef.current?.saveIdentity({ nsec: "", name });
  };

  // ADR-0206：三欄＋Tauri 時把身分元件（切換/＋/🔒/🗂）上移到標題列——註冊渲染資料給標題列；
  // 其餘情境（經典模式、瀏覽器、未登入/無身分）傳 null，由 App 自畫 idbar。須在早期 return 前。
  useEffect(() => {
    const idInTitlebar = isTauri() && layout === "modern";
    if (!idInTitlebar || !backend || profilesState.profiles.length === 0) {
      registerIdentityControls(null);
      return;
    }
    registerIdentityControls({
      active: profilesState.active ?? "",
      options: visibleProfiles(profilesState).map((p) => ({ pubkey: p.pubkey, label: `${profileGlyph(p)} ${p.name}` })),
      switchLabel: t("idbar_switch"),
      addLabel: t("idbar_addIdentity"),
      onSwitch: switchProfile,
      onAdd: () => setAddIdOpen(true),
      unlock: shouldOfferUnlockHidden(profilesState.profiles)
        ? { label: t("idbar_unlockHidden"), onClick: () => void unlockHidden() }
        : null,
      roster:
        backend.publishRoster && activeProfile(profilesState)?.orgOwner
          ? { label: t("idbar_roster"), onClick: () => setRosterOpen(true) }
          : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 註冊器來自 context；依 layout/profiles/backend 重註冊
  }, [layout, profilesState, backend]);

  // H4（ADR-0067）：作用中身分已上鎖→解鎖畫面（不落 SignIn，避免誤建新身分）。
  if (lockedProfile && !backend)
    return <UnlockScreen name={lockedProfile.name} onUnlock={unlock} onRescue={rescue} onSwitch={switchIdentity} />;
  if (!backend || !self) {
    // ADR-0122：瀏覽器的登入畫面**必填本地密碼**（nsec 是本機產生的，使用者沒看過，
    // 而這裡沒有 OS 金鑰庫——不包裹它，重新整理一次身分就沒了）。
    //
    // `needNsec`＝有設定檔但拿不到金鑰（沒記住／已忘記）→ 唯一的出路是貼回備份的 nsec。
    const enterNsec = needNsec
      ? {
          onEnterNsec: async (nsec: string): Promise<boolean> => {
            try {
              if (getPublicKey(nsecDecode(nsec.trim())) !== needNsec.pubkey) return false;
              return await enterWithNsec(needNsec, nsec.trim());
            } catch {
              return false;
            }
          },
        }
      : {};
    return (
      <SignIn
        onSignIn={signIn}
        onPair={importFromOldDevice}
        requirePassword={!isTauri()}
        lookupName={(name) => resolveSignIn(profilesState, name).kind}
        // 入職邀請（ADR-0156）：名稱欄貼碼 → 以邀請碼的 relay/管理者建立企業成員身分，
        // 並帶入職權杖（開機自動向管理者提出入職、核准後全公司通訊錄自動同步）。
        onJoinOrg={(inv, n, pw) => {
          void addIdentity(n, inv.relayUrl, true, {
            adminPubkey: inv.adminPubkey,
            password: pw,
            orgJoinToken: inv.token,
            ...(inv.escrow ? { orgEscrow: true } : {}), // ADR-0163：公司帳號託管
          });
        }}
        {...enterNsec}
      />
    );
  }

  const activeBackend = backend;
  const setStatus = (status: Status) => {
    // 記錄為手動狀態：閒置邏輯不會覆蓋它（UI 已即時套用，故 reducer 不重複 setStatus）
    idleRef.current = reduceIdle(idleRef.current, { type: "manual", status, at: Date.now() }).state;
    activeBackend.setStatus(status, self.statusMessage);
    setSelf((x) => (x ? { ...x, status } : x));
    savePresence(self.pubkey, { status, statusMessage: self.statusMessage }); // ADR-0164：本機記住手動狀態
  };
  const setStatusMessage = (message: string) => {
    activeBackend.setStatus(self.status, message);
    setSelf((x) => (x ? { ...x, statusMessage: message } : x));
    savePresence(self.pubkey, { status: self.status, statusMessage: message }); // ADR-0164
  };
  // 更改顯示名稱（ADR-0144）：後端落地本機＋廣播給聯絡人（ADR-0061）；本地更新 self 與登錄
  // （讓切換器/重載也顯示新名）。
  const renameSelf = (name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === self.name) return true; // 空白或未變動：no-op，非錯誤
    const p = activeProfile(profilesState);
    // ADR-0146：改名不得撞到本機另一個可見身分（排除自己）——否則登入解析會歧義。
    if (nameTaken(profilesState, trimmed, p?.pubkey)) return false;
    activeBackend.setSelfName?.(trimmed);
    setSelf((x) => (x ? { ...x, name: trimmed } : x));
    if (p) {
      const next = { ...profilesState, profiles: profilesState.profiles.map((x) => (x.pubkey === p.pubkey ? { ...x, name: trimmed } : x)) };
      saveProfiles(next);
      setProfilesState(next);
    }
    return true;
  };
  // 設為當前分頁（ADR-0079 Q3）：清該對話未讀，且若當下可見則送已讀回條（切到分頁＝看到）。
  // 供側欄雙擊（openChat）與分頁列點擊（DeckTabs）共用，避免只設 activeConvo 卻漏清未讀。
  const activateConvo = (pk: string) => {
    setActiveConvo(pk);
    // ADR-0111：查這個對話有沒有封存（決定要不要顯示「歷史紀錄」入口）。非同步、不擋主視窗。
    const arch = storageRef.current?.archiveOf?.();
    if (arch) void arch.chunkCount(pk).then((n) => setArchived((a) => (a[pk] === n ? a : { ...a, [pk]: n })));
    // 視窗隱藏時：只推進本機水位（清紅點），**不**送已讀回條——沒真的看到就不該告訴對方（ADR-0108）。
    if (typeof document !== "undefined" && document.hidden) activeBackend.clearUnread?.(pk);
    else activeBackend.markRead?.(pk); // 看得到 → 水位 ＋ 回條（若開啟）
  };
  const openChat = (pk: string) => {
    setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
    activateConvo(pk); // 三欄：設為當前分頁並清未讀；經典不受影響。
    // F5：對非群組聯絡人主動建立 P2P 通道，讓輸入中等狀態卸載中繼。
    if (!groups.some((g) => g.id === pk)) activeBackend.connectPeer?.(pk);
  };

  // 把某 pk 移出作用中分頁（若正是它）：改選相鄰（ADR-0079 Q3 修正 activeConvo 幽靈）。
  const dropActive = (pk: string) => setActiveConvo((a) => nextActiveAfterRemoval(open, pk, a));

  // 關閉對話（分頁或浮動窗）：移出 open；若關的是當前分頁，改選相鄰分頁（ADR-0079 Q3）。
  const closeConvo = (pk: string) => {
    setOpen((prev) => prev.filter((x) => x !== pk));
    dropActive(pk);
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

  const toggleInvisible = () => {
    const next = !invisible;
    setInvisible(next);
    try {
      localStorage.setItem(INVISIBLE_KEY, next ? "1" : "0");
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
    // 權限請求交給通知服務（Tauri 走外掛權限、瀏覽器走 Web Notification；ADR-0076）。
    void getNotifier()
      .ensurePermission()
      .then((granted) => {
        if (granted) enable();
      });
  };

  // 通知子開關（ADR-0076）：提示音、隱藏內文預覽，本機持久化。
  const toggleNotifySound = () => {
    setNotifySound((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NOTIFY_SOUND_KEY, next ? "1" : "0");
      } catch {
        /* 忽略 */
      }
      return next;
    });
  };
  const toggleNotifyHidePreview = () => {
    setNotifyHidePreview((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NOTIFY_PREVIEW_KEY, next ? "1" : "0");
      } catch {
        /* 忽略 */
      }
      return next;
    });
  };
  // 全域通知音效（ADR-0149）：選定即試播一次（所聽即所得），本機持久化。
  const selectNotifyChime = (id: string) => {
    setNotifyChime(id);
    try {
      localStorage.setItem(NOTIFY_CHIME_KEY, id);
    } catch {
      /* 忽略 */
    }
    playChime(id);
  };

  // 刪除/封鎖後：關閉其對話視窗並清掉本地對話快取＋私有標籤（ADR-0158：不留孤兒標籤）
  const forget = (pk: string) => {
    setOpen((prev) => prev.filter((x) => x !== pk));
    dropActive(pk); // 三欄：若刪的是當前分頁，遞補相鄰（避免中欄空白/右欄幽靈，ADR-0079 修正）。
    setConvos((prev) => {
      if (!(pk in prev)) return prev;
      const next = { ...prev };
      delete next[pk];
      return next;
    });
    setGroupPrefs((prev) => {
      const next = pruneGroup(prev, pk);
      if (next !== prev) saveGroupPrefs(next);
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

  /** 送出一個檔案。`savedPath` 只有原生選檔拿得到（ADR-0103）；瀏覽器 <input> 沒有。 */
  const sendFileBytes = async (pk: string, name: string, mime: string, bytes: Uint8Array, savedPath?: string) => {
    if (!activeBackend.sendFile) return;
    // 圖片縮圖（ADR-0102）：只存本機、不進 metadata 訊息、不上中繼。非圖片回 null。
    const thumb = await makeThumbnail(bytes, mime);
    // backend 擁有檔案訊息（ADR-0093）：sendFile 會同步 emit onMessage（file.id＝傳輸 id）。
    const tid = activeBackend.sendFile(pk, { name, mime, bytes }, {
      ...(thumb ? { thumb } : {}),
      ...(savedPath ? { savedPath } : {}),
    });
    // 本機保留 blob URL：送出端也能重播/下載（語音訊息尤其需要）。以傳輸 id 併入剛 emit 的那則。
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    setConvos((prev) =>
      patchFileByTid(prev, pk, tid, { url, ...(savedPath ? { savedPath } : {}) }),
    );
    setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
  };

  /** 瀏覽器 <input type=file> / 拖放路徑：拿不到完整路徑（瀏覽器安全限制）。 */
  const sendFile = async (pk: string, f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await sendFileBytes(pk, f.name, f.type || "application/octet-stream", bytes);
  };

  /** Tauri 原生選檔（ADR-0103）：**拿得到完整路徑** → 自己送出的圖片重載後也能看原圖。 */
  const attachFile = async (pk: string) => {
    const picked = await pickFileToSend();
    if (!picked) return; // 取消，或非 Tauri（呼叫端會退回 <input>）
    await sendFileBytes(pk, picked.name, picked.mime, picked.bytes, picked.path);
  };

  // 原生拖放的送檔實作（ADR-0104）：監聽只註冊一次，故經 ref 取用**當前**這份（避免閉包陳舊）。
  dropSendRef.current = (pk, paths) => {
    if (!activeBackend.sendFile || policy.disableFiles) return; // 企業政策停用檔案時不放行
    void (async () => {
      for (const path of paths) {
        const f = await readFileAtPath(path); // 資料夾/讀不到 → null，略過
        if (f) await sendFileBytes(pk, f.name, f.mime, f.bytes, f.path);
      }
    })();
  };

  // 明文紀錄導出（ADR-0094）：每個所選格式各產一份，經 save_file（Tauri）／下載（瀏覽器）寫出本機。
  const doExport = async (keys: string[], formats: ExportFormat[]): Promise<void> => {
    const storage = storageRef.current;
    if (!storage) return;
    const selfLabel = selfRef.current?.name ?? "我";
    const stamp = new Date().toISOString().slice(0, 10);
    setExportPreselect(null);
    for (const fmt of formats) {
      // eslint-disable-next-line no-await-in-loop -- 匯出需讀封存（非同步）；且逐一另存對話框需序列化
      const text = await exportRecords(storage, fmt, { keys, selfLabel, now: Date.now() });
      // eslint-disable-next-line no-await-in-loop -- 逐一另存對話框需序列化，避免多框同時彈出
      await saveTextFile(`cinder-紀錄-${stamp}.${exportExtension(fmt)}`, exportMime(fmt), text);
    }
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
  // 公司儲存槽（ADR-0161）：企業成員＋Tauri 才提供存放入口（佇列走 savedPath 重讀）。
  const slotEnabled = (() => {
    const p = activeProfile(profilesState);
    return !!(p?.enterprise && p.adminPubkey && activeBackend.depositFile && isTauri());
  })();
  const queueSlotDeposit = (m: ChatMessage, origin: string): void => {
    const f = m.file;
    if (!f?.savedPath) return;
    updateSlotQueue((q) =>
      enqueueSlot(q, { path: f.savedPath!, name: f.name, size: f.size, mime: f.mime, origin, queuedAt: Date.now() }),
    );
  };
  const manageProps = {
    ...(activeBackend.removeContact ? { onRemoveContact: removeContact } : {}),
    ...(activeBackend.blockContact ? { onBlockContact: blockContact } : {}),
    ...(activeBackend.unblockContact
      ? { onUnblockContact: (pk: string) => activeBackend.unblockContact!(pk) }
      : {}),
    blocked,
    // 訊息請求（ADR-0121）
    requests,
    ...(activeBackend.acceptRequest
      ? {
          onAcceptRequest: (pk: string) => {
            activeBackend.acceptRequest?.(pk);
            setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk])); // 接受了就開窗
          },
        }
      : {}),
    ...(activeBackend.declineRequest
      ? {
          onDeclineRequest: (pk: string) => {
            activeBackend.declineRequest?.(pk);
            setOpen((prev) => prev.filter((k) => k !== pk));
            setConvos((prev) => {
              const { [pk]: _drop, ...rest } = prev;
              return rest;
            });
          },
        }
      : {}),
    // 預覽請求裡的訊息：**只開窗，不接受**——對方不會收到已讀回條（他不是聯絡人）。
    onOpenRequest: (pk: string) => setOpen((prev) => (prev.includes(pk) ? prev : [...prev, pk])),
    // 全部刪除（ADR-0127 防洪）：清空請求區與相關對話視窗。
    ...(activeBackend.clearRequests
      ? {
          onClearRequests: () => {
            const reqPks = new Set(requests.map((r) => r.pubkey));
            activeBackend.clearRequests?.();
            setOpen((prev) => prev.filter((k) => !reqPks.has(k)));
            setConvos((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !reqPks.has(k))));
          },
        }
      : {}),
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
    <div
      className={layout === "modern" ? "deck" : "desktop"}
      data-layout={layout}
      {...(layout !== "modern" && isNarrow && activeConvo ? { "data-showconvo": "true" } : {})}
    >
      {/* ADR-0206：三欄＋Tauri 時身分元件已上移標題列 → 不畫 idbar；其餘情境照舊。 */}
      {!(isTauri() && layout === "modern") && (profilesState.profiles.length > 0 || layout === "modern") ? (
        <div className="idbar" data-testid="identity-bar">
          {profilesState.profiles.length > 0 ? (
            <>
              <span className="idbar__icon" aria-hidden="true">
                {profileGlyph(activeProfile(profilesState))}
              </span>
              <select
                className="idbar__select"
                aria-label={t("idbar_switch")}
                value={profilesState.active ?? ""}
                onChange={(e) => switchProfile(e.target.value)}
              >
                {visibleProfiles(profilesState).map((p) => (
                  <option key={p.pubkey} value={p.pubkey}>
                    {`${profileGlyph(p)} ${p.name}`}
                  </option>
                ))}
              </select>
              <button className="idbar__add" title={t("idbar_addIdentity")} onClick={() => setAddIdOpen(true)}>
                ＋
              </button>
              {isTauri() && shouldOfferUnlockHidden(profilesState.profiles) ? (
                <button className="idbar__add" title={t("idbar_unlockHidden")} onClick={() => void unlockHidden()}>
                  🔒
                </button>
              ) : null}
              {/* 名冊管理（ADR-0155 收斂）：只對企業主身分顯示——一般與成員身分的頂欄不再有管理者按鈕。 */}
              {activeBackend.publishRoster && activeProfile(profilesState)?.orgOwner ? (
                <button
                  className="idbar__add"
                  title={t("idbar_roster")}
                  data-testid="idbar-roster"
                  onClick={() => setRosterOpen(true)}
                >
                  🗂
                </button>
              ) : null}
            </>
          ) : null}
          {/* 設定入口收斂於 idbar（ADR-0142/0216）——三欄與經典皆然，取代經典聯絡人視窗標題列的 ⚙。
              Tauri 下 ⚙ 已在自繪外框標題列（ADR-0151），idbar 就不重複畫。 */}
          {!isTauri() ? (
            <button
              className="idbar__add idbar__settings"
              aria-label={t("settings_open")}
              title={t("settings_open")}
              data-testid="idbar-settings"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙️
            </button>
          ) : null}
        </div>
      ) : null}
      {addIdOpen ? (
        <AddIdentityModal
          defaultRelayUrl={activeProfile(profilesState)?.relayUrl ?? ""}
          onCancel={() => setAddIdOpen(false)}
          onAdd={addIdentity}
          requirePassword={!isTauri()}
          nameTaken={(name) => nameTaken(profilesState, name)}
        />
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
          onPublish={(org, members, pol, groups, profile) => activeBackend.publishRoster!(org, members, pol, groups, profile)}
          initial={activeBackend.currentRoster?.() ?? null}
          {...(() => {
            // 入職邀請碼（ADR-0156）：relay＋自己的 pubkey＋核准權杖；escrow 旗標由 0163 的核取決定。
            const p = activeProfile(profilesState);
            return p?.orgOwner && p.orgInviteToken && p.relayUrl
              ? { invite: { relayUrl: p.relayUrl, adminPubkey: p.pubkey, token: p.orgInviteToken } }
              : {};
          })()}
        />
      ) : null}
      <div className="deckwrap deckwrap--left">
        {layout === "modern" ? (
          <DeckSidebar
            self={self}
            contacts={contacts}
            groups={groups}
            convos={convos}
            prefs={groupPrefs}
            unread={unread}
            onOpen={openChat}
            onStatus={setStatus}
            onStatusMessage={setStatusMessage}
            onNowPlaying={(text) => activeBackend.setNowPlaying(text)}
            onAddLabel={(id, label) => updatePrefs(withLabel(groupPrefs, id, label))}
            onRemoveLabel={(id, label) => updatePrefs(withoutLabel(groupPrefs, id, label))}
            labelOptions={allLabels(groupPrefs)}
            activeLabel={labelFilter}
            onFilterLabel={setLabelFilter}
            onSelfAvatar={broadcastSelfAvatar}
            {...(activeBackend.removeContact ? { onRemoveContact: removeContact } : {})}
            {...(activeBackend.blockContact ? { onBlockContact: blockContact } : {})}
            {...(ollama.enabled ? { onSummarize: summarizeUnread } : {})}
            {...addContactProps}
          />
        ) : (
          <ContactListWindow
            self={self}
            contacts={contacts}
            onOpen={openChat}
            onStatus={setStatus}
            onStatusMessage={setStatusMessage}
            onSelfAvatar={broadcastSelfAvatar}
            onOpenSettings={() => setSettingsOpen(true)}
            onNowPlaying={(text) => activeBackend.setNowPlaying(text)}
            unread={unread}
            {...(ollama.enabled ? { onSummarize: summarizeUnread } : {})}
            connection={conn}
            convos={convos}
            contactLabels={Object.fromEntries(contacts.map((c) => [c.pubkey, labelsOf(groupPrefs, c.pubkey)]))}
            onAddContactLabel={(pk, label) => updatePrefs(withLabel(groupPrefs, pk, label))}
            onRemoveContactLabel={(pk, label) => updatePrefs(withoutLabel(groupPrefs, pk, label))}
            {...addContactProps}
            {...manageProps}
            {...groupProps}
          />
        )}
      </div>
      {layout === "modern" ? (
        <aside className="deckwrap deckwrap--right" data-testid="deck-right">
          <DeckRight
            activeId={activeConvo}
            self={self}
            contacts={contacts}
            groups={groups}
            convos={convos}
            {...(activeConvo
              ? {
                  onInsert: (text: string) =>
                    setPendingInsert({ convo: activeConvo, text, nonce: Date.now() }),
                }
              : {})}
          />
        </aside>
      ) : null}
      {settingsOpen ? (
        <SettingsPanel
          selfName={self.name}
          onRename={renameSelf}
          onLogout={() => void logout()}
          {...(profilesState.active ? { onRemoveIdentity: () => void removeIdentity(profilesState.active!) } : {})}
          onWipeDevice={() => void wipeDevice()}
          {...(orgInfo ? { orgInfo } : {})}
          {...(() => {
            // 企業頭銜（ADR-0158）：企業成員與企業主身分才顯示編輯欄。
            const p = activeProfile(profilesState);
            if (!(p?.enterprise || p?.orgOwner) || !activeBackend.setSelfTitle) return {};
            return {
              myTitle: activeBackend.selfTitle?.() ?? "",
              onSetTitle: (title: string) => activeBackend.setSelfTitle!(title || undefined),
            };
          })()}
          {...(slotEnabled
            ? {
                // 公司儲存槽佇列（ADR-0161，員工端）。
                slotQueue,
                onSlotRetry: () => updateSlotQueue(retryFailed),
                onSlotRemove: (id: string) => updateSlotQueue((q) => removeSlot(q, id)),
              }
            : {})}
          {...(() => {
            // 離職帳號接管（ADR-0163，企業主端）：託管中但不在現行名冊在世成員＝已離職。
            const p = activeProfile(profilesState);
            if (!p?.orgOwner) return {};
            const live = new Set(
              (activeBackend.currentRoster?.()?.members ?? []).filter((m) => !m.supersededBy).map((m) => m.pubkey),
            );
            return {
              offboarded: offboardedEntries(escrow, live).map((e) => ({ pubkey: e.pubkey, name: e.name })),
              onTakeover: (pubkey: string) => {
                const e = escrow.find((x) => x.pubkey === pubkey);
                if (!e) return;
                // 以託管金鑰匯入為本機離職身分（不再入職/廣播）；切換過去查看 relay 殘留、之後可刪。
                void addIdentity(`離職·${e.name}`, e.relayUrl, false, { nsec: e.nsec, orgOffboarded: true });
              },
              onDeleteEscrow: (pubkey: string) => {
                setEscrow((prev) => {
                  const next = removeEscrow(prev, pubkey);
                  saveEscrow(backend.self.pubkey, next);
                  return next;
                });
              },
            };
          })()}
          {...(activeProfile(profilesState)?.orgOwner && isTauri()
            ? {
                // 儲存槽目錄（ADR-0161，企業主端）；空＝appData 預設槽。
                slotDirValue: slotDirVal,
                onPickSlotDir: () => {
                  void pickSlotFolder().then((d) => {
                    if (!d) return;
                    const pk = profilesState.active;
                    if (pk) {
                      setSlotDir(pk, d);
                      setSlotDirVal(d);
                    }
                  });
                },
              }
            : {})}
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
            // 排水（H3）純內部自動（見 createBackend 的 activeDrain→drainUrl，ADR-0083 完全隱藏）：不露 UI。
            const p = activeProfile(profilesState);
            if (!p) return {};
            return p.enterprise ? { relayLocked: true } : { onRelayChange: changeRelay };
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
            // 本地密碼（H4，ADR-0067）：**瀏覽器也有**（ADR-0112 的 Argon2id 在 JS 執行；
            // ADR-0122 把它接上——在那之前這個區塊被 `isTauri()` 擋掉，`browserPassEnable()`
            // 的呼叫端是 0 個，整套瀏覽器密碼保護是死碼）。示範模式（無 relay）不顯示。
            const p = activeProfile(profilesState);
            if (!p || !p.relayUrl) return {};
            const flag = (patch: { locked?: boolean; hidden?: boolean }) => {
              const next = setProfileSecurity(loadProfiles(), p.pubkey, patch);
              saveProfiles(next);
              setProfilesState(next);
            };
            return {
              security: {
                enabled: !!p.locked,
                hidden: !!p.hidden,
                browser: !isTauri(), // 文案要說明「停用＝忘記身分」（ADR-0122）
                onEnable: async (pw: string) => {
                  try {
                    if (isTauri()) await passEnable(p.namespace, p.pubkey, pw);
                    // 瀏覽器：以密碼包裹**當下記憶體裡的** nsec 落盤（磁碟上只有密文）。
                    else await browserPassEnable(p.pubkey, activeBackend.selfNsec ?? "", pw);
                    flag({ locked: true });
                    return true;
                  } catch {
                    return false;
                  }
                },
                onChangePassword: async (oldPw: string, newPw: string) => {
                  try {
                    if (isTauri()) {
                      await passChange(p.namespace, p.pubkey, oldPw, newPw);
                      return true;
                    }
                    // 瀏覽器：先以舊密碼解開（驗證），再以新密碼重新包裹。
                    const nsec = await browserPassUnlock(p.pubkey, oldPw);
                    if (!nsec) return false; // 舊密碼錯誤／遭竄改
                    await browserPassEnable(p.pubkey, nsec, newPw);
                    return true;
                  } catch {
                    return false;
                  }
                },
                onDisable: async (pw: string) => {
                  try {
                    if (isTauri()) {
                      await passDisable(p.namespace, p.pubkey, pw);
                    } else {
                      // 🔴 瀏覽器的「停用」＝**忘記這個身分**（ADR-0122）。
                      // 桌面的停用是把明文 nsec 寫回 OS 金鑰庫（信任邊界移交給 OS 帳號）；
                      // 瀏覽器**沒有那個東西**——沒有任何安全的明文去處，那正是 ADR-0112 的前提。
                      // 所以只能不再記住：下次開啟要重貼 nsec。先驗密碼，避免誤觸清掉身分。
                      if (!(await browserPassUnlock(p.pubkey, pw))) return false;
                      await browserPassForget(p.pubkey);
                    }
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
          autoAcquireAssets={autoAcquire}
          onToggleAutoAcquire={() => {
            setAutoAcquireEnabled(!autoAcquire);
            setAutoAcquire(!autoAcquire);
          }}
          notifications={notify}
          onToggleNotifications={toggleNotifications}
          notifySound={notifySound}
          onToggleNotifySound={toggleNotifySound}
          notifyChime={notifyChime}
          onSelectNotifyChime={selectNotifyChime}
          showTitlebarSettings={isTauri()}
          notifyHidePreview={notifyHidePreview}
          onToggleNotifyHidePreview={toggleNotifyHidePreview}
          notifyEvents={notifyPrefs}
          onToggleNotifyEvent={toggleNotifyEvent}
          readReceipts={readReceipts}
          onToggleReadReceipts={toggleReadReceipts}
          invisible={invisible}
          onToggleInvisible={toggleInvisible}
          ollama={ollama}
          onOllamaChange={updateOllama}
          {...(storageRef.current
            ? {
                retention: { cap: retentionCap, onChange: setRetentionCap, full: storageFull },
                onExport: () => setExportOpen(true),
              }
            : {})}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {historyOf !== null && storageRef.current?.archiveOf?.() ? (
        <HistoryWindow
          convo={historyOf}
          name={
            groups.find((g) => g.id === historyOf)?.name ??
            contacts.find((c) => c.pubkey === historyOf)?.name ??
            `${historyOf.slice(0, 12)}…`
          }
          archive={storageRef.current.archiveOf()!}
          selfLabel={self.name || "我"}
          onClose={() => setHistoryOf(null)}
        />
      ) : null}
      {exportPreselect !== null ? (
        <ExportModal
          conversations={Object.keys(convos)
            .filter((k) => (convos[k]?.length ?? 0) > 0)
            .map((k): ExportConvoItem => {
              const g = groups.find((gr) => gr.id === k);
              if (g) return { key: k, name: g.name, kind: "group" };
              const c = contacts.find((ct) => ct.pubkey === k);
              return { key: k, name: c?.name ?? `${k.slice(0, 12)}…`, kind: "contact" };
            })}
          {...(exportPreselect.length > 0 ? { initialKeys: exportPreselect } : {})}
          onExport={(keys, formats) => void doExport(keys, formats)}
          onClose={() => setExportPreselect(null)}
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
      <div className="deckwrap deckwrap--center">
      {/* ADR-0216：窄螢幕檢視切換時的返回主視窗鈕（回列表）。 */}
      {layout !== "modern" && isNarrow && activeConvo ? (
        <button className="narrowback" data-testid="narrow-back" onClick={() => setActiveConvo(null)}>
          ‹ {t("nav_back")}
        </button>
      ) : null}
      {layout === "modern" && open.length > 0 ? (
        <DeckTabs
          open={open}
          active={activeConvo}
          contacts={contacts}
          groups={groups}
          unread={unread}
          onActivate={activateConvo}
          onClose={closeConvo}
        />
      ) : null}
      {layout === "modern" && open.length === 0 ? <div className="deckcenter__empty">{t("deck_pickChat")}</div> : null}
      {open.map((pk, i) => {
        // ADR-0216：經典寬螢幕才浮動；三欄（embedded）與窄螢幕（單欄切換）不套用。
        const floating = layout !== "modern" && !isNarrow ? floatWins.get(pk, i) : undefined;
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
            <div key={pk} className={`convotab${pk === activeConvo ? " on" : ""}`}>
            <ConversationWindow
              embedded={layout === "modern"}
              {...(floating ? { floating } : {})}
              muted={isMuted(groupPrefs, pk)}
              onToggleMute={() => updatePrefs(withMuted(groupPrefs, pk, !isMuted(groupPrefs, pk)))}
              self={self}
              contact={groupContact}
              messages={convos[pk] ?? []}
              typing={false}
              nudgeSignal={0}
              {...(rewriteFn ? { onRewrite: rewriteFn } : {})}
              {...(checkAiAvailable ? { onCheckAiAvailable: checkAiAvailable } : {})}
              onSelfAvatar={broadcastSelfAvatar}
              // 下班提示（ADR-0159）：組織群組同樣適用。
              {...(orgInfo?.workHours && group.org ? { orgWorkHours: orgInfo.workHours } : {})}
              // 公司儲存槽（ADR-0161）：群組檔案同樣可存放。
              {...(slotEnabled ? { onDepositFile: (m: ChatMessage) => queueSlotDeposit(m, group.name) } : {})}
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
                      dropActive(pk); // 三欄：離開的群若是當前分頁，遞補相鄰（ADR-0079 修正）。
                      updatePrefs(pruneGroup(groupPrefs, pk));
                    },
                  }
                : {})}
              {...(storageRef.current ? { onExport: () => setExportPreselect([pk]) } : {})}
            {...((archived[pk] ?? 0) > 0 ? { onHistory: () => setHistoryOf(pk) } : {})}
            {...(dropTarget === pk ? { dropActive: true } : {})}
              {...(dropTarget === pk ? { dropActive: true } : {})}
              {...(pendingInsert?.convo === pk ? { insert: { text: pendingInsert.text, nonce: pendingInsert.nonce } } : {})}
              onFileRelocated={(messageId: string, newPath: string) => {
                // ADR-0102：使用者重新指定原圖位置 → 回寫 savedPath，下次直接讀得到。
                activeBackend.setFileSavedPath?.(pk, messageId, newPath);
                setConvos((prev) => patchFileByMsgId(prev, pk, messageId, { savedPath: newPath }));
              }}
              onClose={() => closeConvo(pk)}
            />
            </div>
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
          activeBackend.sendFile && !policy.disableFiles
            ? {
                onSendFile: (f: File) => sendFile(pk, f),
                // ADR-0103：Tauri 走原生選檔（有路徑）；瀏覽器沒有此 prop → 退回 <input type=file>。
                ...(isTauri() ? { onAttach: () => void attachFile(pk) } : {}),
              }
            : {};
        const callProps =
          activeBackend.startCall && !policy.disableCalls
            ? { onStartCall: (media: CallMedia) => activeBackend.startCall!(pk, media) }
            : {};
        const stickerProps = policy.disableStickers ? { stickersDisabled: true } : {};
        return (
          <div key={pk} className={`convotab${pk === activeConvo ? " on" : ""}`}>
          <ConversationWindow
            embedded={layout === "modern"}
            {...(floating ? { floating } : {})}
            self={self}
            contact={contact}
            p2pConnected={p2pConnected.has(pk)}
            muted={isMuted(groupPrefs, pk)}
            onToggleMute={() => updatePrefs(withMuted(groupPrefs, pk, !isMuted(groupPrefs, pk)))}
            {...(activeBackend.setContactAlias
              ? { onSetAlias: (cp: string, alias: string | undefined) => activeBackend.setContactAlias!(cp, alias) }
              : {})}
            {...(activeBackend.setContactNotifySound
              ? { onSetNotifySound: (cp: string, sid: string | undefined) => activeBackend.setContactNotifySound!(cp, sid) }
              : {})}
            onSelfAvatar={broadcastSelfAvatar}
            // 下班提示（ADR-0159）：對象是組織成員且名冊有班表 → 表定時間外顯示非阻斷橫幅。
            {...(orgInfo?.workHours && orgInfo.members.includes(pk) ? { orgWorkHours: orgInfo.workHours } : {})}
            // 公司儲存槽（ADR-0161）：檔案訊息（有本機路徑）可存入。
            {...(slotEnabled ? { onDepositFile: (m: ChatMessage) => queueSlotDeposit(m, contact.alias || contact.name) } : {})}
            // 私有標籤（ADR-0158 經典佈局入口）：資料同三欄側欄（ADR-0040，id 通用）。
            labels={labelsOf(groupPrefs, pk)}
            onAddLabel={(label: string) => updatePrefs(withLabel(groupPrefs, pk, label))}
            onRemoveLabel={(label: string) => updatePrefs(withoutLabel(groupPrefs, pk, label))}
            messages={convos[pk] ?? []}
            reactions={reactions}
            unsent={unsent}
            expired={expired}
            typing={(typingAt[pk] ?? 0) > Date.now() - TYPING_VISIBLE_MS}
            nudgeSignal={nudge[pk] ?? 0}
            onMarkRead={() => {
              // 僅在此對話「當下真的看得到」時送已讀（開著但沒看不算讀；三欄背景分頁也不算，ADR-0058/0079）。
              const hidden = typeof document !== "undefined" && document.hidden;
              if (convoVisibleIn(layout, activeConvo, pk, hidden)) activeBackend.markRead?.(pk);
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
            {...(storageRef.current ? { onExport: () => setExportPreselect([pk]) } : {})}
            {...(pendingInsert?.convo === pk ? { insert: { text: pendingInsert.text, nonce: pendingInsert.nonce } } : {})}
            onFileRelocated={(messageId: string, newPath: string) => {
              activeBackend.setFileSavedPath?.(pk, messageId, newPath);
              setConvos((prev) => patchFileByMsgId(prev, pk, messageId, { savedPath: newPath }));
            }}
            onClose={() => closeConvo(pk)}
          />
          </div>
        );
      })}
      </div>
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
  requirePassword = false,
  initialMode = null,
  nameTaken,
}: {
  /** relay 欄位預設值（帶入目前作用中身分的網址，可改）。 */
  defaultRelayUrl: string;
  /** 直接進入某類型的表單（跳過選類型步驟）；供測試/深連結。預設 null＝先選類型（ADR-0145/0155）。 */
  initialMode?: "personal" | "org" | "owner" | null;
  /** ADR-0146：本機是否已有同名（可見）身分；命中則擋下建立，維持名稱唯一以便登入解析。 */
  nameTaken?: (name: string) => boolean;
  onAdd: (
    name: string,
    relayUrl: string,
    enterprise: boolean,
    opts: {
      nsec?: string | undefined;
      adminPubkey?: string | undefined;
      password?: string | undefined;
      /** 企業主（ADR-0155）：一般身分＋名冊管理權標記。 */
      orgOwner?: boolean | undefined;
    orgJoinToken?: string | undefined;
    orgEscrow?: boolean | undefined;
    },
  ) => void;
  onCancel: () => void;
  /**
   * 瀏覽器（ADR-0122）：本地密碼**必填**——理由與首次登入完全相同
   *（新身分的 nsec 是本機產生的、使用者沒看過；這裡沒有 OS 金鑰庫）。
   */
  requirePassword?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  // ADR-0145/0155：先選類型（個人／企業成員／企業主），再填表單。null＝還在選。
  // enterprise 只屬於成員；企業主是一般身分＋orgOwner 標記（後端語意同個人）。
  const [mode, setMode] = useState<"personal" | "org" | "owner" | null>(initialMode);
  const enterprise = mode === "org";
  const [name, setName] = useState("");
  const [relayUrl, setRelayUrl] = useState(defaultRelayUrl);
  const [nsec, setNsec] = useState("");
  const [admin, setAdmin] = useState("");
  // 入職邀請碼（ADR-0156）：貼上即自動填 relay＋管理者並記下核准權杖（建立後自動入職）。
  const [inviteInput, setInviteInput] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteEscrow, setInviteEscrow] = useState(false); // ADR-0163：公司帳號託管
  // 加密備份碼匯入（ADR-0070）：偵測到備份碼即要求備份密碼；信封 relay（明文）自動預填。
  const [backupPw, setBackupPw] = useState("");
  const [backupErr, setBackupErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const isCode = isBackupCode(nsec.trim());
  // ADR-0146：本機名稱唯一——命中同名（可見）身分即擋，避免登入解析時歧義。
  const nameCollision = name.trim().length > 0 && !!nameTaken?.(name);
  const submit = () => {
    if (!name.trim() || !relayUrl.trim() || busy || nameCollision) return;
    if (requirePassword && !password) return; // ADR-0122：沒有密碼＝重載就失去這個身分
    const adminPubkey = enterprise ? admin.trim() || undefined : undefined;
    const password_ = requirePassword ? password : undefined;
    const owner = mode === "owner" ? { orgOwner: true } : {}; // ADR-0155
    const join = enterprise && inviteToken ? { orgJoinToken: inviteToken, ...(inviteEscrow ? { orgEscrow: true } : {}) } : {}; // ADR-0156/0163
    if (isCode) {
      if (!backupPw) return;
      // scrypt 解碼約需一秒（審查修正 #9）：先讓「還原中…」上畫再執行，避免無回饋凍結。
      setBusy(true);
      setTimeout(() => {
        try {
          const imported = parseBackupCode(nsec.trim(), backupPw).nsec;
          onAdd(name.trim(), relayUrl.trim(), enterprise, { nsec: imported, adminPubkey, password: password_, ...owner, ...join });
        } catch {
          setBackupErr(true); // 備份密碼錯誤：保留輸入
        } finally {
          setBusy(false);
        }
      }, 0);
      return;
    }
    try {
      onAdd(name.trim(), relayUrl.trim(), enterprise, {
        nsec: nsec.trim() || undefined,
        adminPubkey,
        password: password_,
        ...owner,
        ...join,
      });
    } catch {
      setBackupErr(true); // 非法 nsec：保留輸入
    }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("addId_title")} onClick={onCancel}>
      <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>{t("addId_title")}</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label={t("addId_close")} onClick={onCancel}>
            ×
          </span>
        </div>
        <div className="groupmodal">
          {mode === null ? (
            // 第一步（ADR-0145）：選類型。個人＝一般帳號；組織＝訂閱管理者名冊的工作身分。
            <div className="addid-choose">
              <button type="button" className="addid-mode" data-testid="addid-mode-personal" onClick={() => setMode("personal")}>
                <span className="addid-mode__ic" aria-hidden="true">👤</span>
                <span className="addid-mode__txt">
                  <span className="addid-mode__name">{t("addId_modePersonal")}</span>
                  <span className="addid-mode__hint">{t("addId_modePersonalHint")}</span>
                </span>
              </button>
              <button type="button" className="addid-mode" data-testid="addid-mode-org" onClick={() => setMode("org")}>
                <span className="addid-mode__ic" aria-hidden="true">🏢</span>
                <span className="addid-mode__txt">
                  <span className="addid-mode__name">{t("addId_modeOrg")}</span>
                  <span className="addid-mode__hint">{t("addId_modeOrgHint")}</span>
                </span>
              </button>
              {/* 企業主（ADR-0155）：一般身分＋名冊管理權；建立後直接進名冊管理。 */}
              <button type="button" className="addid-mode" data-testid="addid-mode-owner" onClick={() => setMode("owner")}>
                <span className="addid-mode__ic" aria-hidden="true">🗂</span>
                <span className="addid-mode__txt">
                  <span className="addid-mode__name">{t("addId_modeOwner")}</span>
                  <span className="addid-mode__hint">{t("addId_modeOwnerHint")}</span>
                </span>
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="settings__reveal"
                data-testid="addid-change-mode"
                onClick={() => setMode(null)}
              >
                {t("addId_changeMode")}
              </button>
              <p className="hint">
                {mode === "owner" ? `🗂 ${t("addId_modeOwner")}` : enterprise ? `🏢 ${t("addId_modeOrg")}` : `👤 ${t("addId_modePersonal")}`}
              </p>
              <input
                className="groupmodal__name"
                placeholder={t("signIn_displayName")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="groupmodal__name"
                placeholder={t("addId_relay")}
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
              />
              {/* 瀏覽器（ADR-0122）：必填。沒有它，重新整理就失去這個新身分。 */}
              {requirePassword ? (
                <>
                  <input
                    className="groupmodal__name"
                    type="password"
                    placeholder={t("signIn_password")}
                    aria-label={t("signIn_password")}
                    data-testid="addid-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="hint">{t("signIn_passwordWhy")}</p>
                </>
              ) : null}
              {/* 組織身份才有管理者名冊訂閱欄（ADR-0047）＋入職邀請碼貼入欄（ADR-0156）。 */}
              {enterprise ? (
                <>
                  <input
                    className="groupmodal__name"
                    data-testid="addid-invite"
                    placeholder={t("addId_invite")}
                    value={inviteInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInviteInput(v);
                      const inv = parseOrgInvite(v);
                      if (inv) {
                        // 邀請碼自動填入（可再手改）；權杖記下供建立後自動入職。
                        setRelayUrl(inv.relayUrl);
                        setAdmin(inv.adminPubkey);
                        setInviteToken(inv.token);
                        setInviteEscrow(inv.escrow === true); // ADR-0163
                      }
                    }}
                  />
                  {inviteToken ? (
                    <p className="hint" data-testid="addid-invite-ok">{t("addId_inviteApplied")}</p>
                  ) : null}
                  {/* 公司帳號金鑰託管揭露（ADR-0163）：邀請碼帶 escrow 時明示同意。 */}
                  {inviteEscrow ? (
                    <p className="settings__warn" data-testid="addid-escrow">{t("signIn_joinEscrow")}</p>
                  ) : null}
                  <input
                    className="groupmodal__name"
                    data-testid="addid-admin"
                    placeholder={t("addId_admin")}
                    value={admin}
                    onChange={(e) => setAdmin(e.target.value)}
                  />
                </>
              ) : null}
              <input
                className="groupmodal__name"
                placeholder={t("addId_import")}
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
                  placeholder={t("settings_backupCodePw")}
                  value={backupPw}
                  onChange={(e) => {
                    setBackupPw(e.target.value);
                    setBackupErr(false);
                  }}
                />
              ) : null}
              {backupErr ? <p className="settings__warn">{t("addId_error")}</p> : null}
              {nameCollision ? (
                <p className="settings__warn" data-testid="addid-name-taken">{t("addId_nameTaken")}</p>
              ) : null}
              <button
                className="groupmodal__create"
                data-testid="add-identity-confirm"
                disabled={!name.trim() || !relayUrl.trim() || (isCode && !backupPw) || busy || nameCollision}
                onClick={submit}
              >
                {busy ? t("addId_busy") : t("addId_submit")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 組織名冊管理（ADR-0047）：每行「npub 名稱」→ 簽章發布 → 顯示供 relay 佈建的 allowlist。 */
export function RosterAdminModal({
  selfNpub,
  onPublish,
  onCancel,
  invite,
  initial,
}: {
  selfNpub: string;
  onPublish: (
    org: string,
    members: OrgMember[],
    policy?: OrgPolicy,
    groups?: OrgGroup[],
    profile?: { welcome?: string; workHours?: { start: string; end: string } },
  ) => string[];
  onCancel: () => void;
  /** 入職邀請碼組件（ADR-0156）：一鍵複製給員工；未提供（缺權杖/relay）則不顯示。 */
  invite?: { relayUrl: string; adminPubkey: string; token: string };
  /** 現行名冊（ADR-0157）：預填組織名/成員/政策/公司設定——修一項不必重打整份。 */
  initial?: OrgRosterDoc | null;
}): JSX.Element {
  const { t } = useI18n();
  const [inviteCopied, setInviteCopied] = useState(false);
  // 公司帳號金鑰託管（ADR-0163）：勾選後邀請碼帶 escrow 旗標，員工端貼碼時明示並託管私鑰。
  const [escrowInvite, setEscrowInvite] = useState(false);
  const inviteCode = invite ? makeOrgInvite({ ...invite, ...(escrowInvite ? { escrow: true } : {}) }) : undefined;
  const copyInvite = (): void => {
    if (!inviteCode) return;
    try {
      void navigator.clipboard?.writeText(inviteCode);
      setInviteCopied(true);
    } catch {
      /* 剪貼簿不可用：欄位本身可手動全選複製 */
    }
  };
  // 預填（ADR-0157）：以現行名冊帶入；成員行＝「npub 名稱」（排除已輪替作廢者）。
  const [org, setOrg] = useState(initial?.org ?? "");
  const [text, setText] = useState(() =>
    initial
      ? initial.members
          .filter((m) => !m.supersededBy)
          .map((m) => `${npubEncode(m.pubkey)} ${m.name}`)
          .join("\n")
      : selfNpub
        ? `${selfNpub} 管理者`
        : "",
  );
  const [groupText, setGroupText] = useState("");
  const [rotText, setRotText] = useState("");
  const [pol, setPol] = useState<OrgPolicy>(initial?.policy ?? {});
  // 訊息保留天數（ADR-0160）：留空＝預設 7 天；1–365 才併入政策。
  const [ttlDays, setTtlDays] = useState(
    initial?.policy?.messageTtlDays !== undefined ? String(initial.policy.messageTtlDays) : "",
  );
  // relay 檔案上限（ADR-0162）：留空＝關（維持 P2P）；1–16 MB 才併入政策。
  const [relayFilesMb, setRelayFilesMb] = useState(
    initial?.policy?.relayFilesMaxMb !== undefined ? String(initial.policy.relayFilesMaxMb) : "",
  );
  // 公司設定（ADR-0157）：歡迎詞/基本規範＋表定上下班時間。
  const [welcome, setWelcome] = useState(initial?.welcome ?? "");
  const [workStart, setWorkStart] = useState(initial?.workHours?.start ?? "");
  const [workEnd, setWorkEnd] = useState(initial?.workHours?.end ?? "");
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
    // 訊息保留天數（ADR-0160）：1–365 整數才生效；併入政策一起簽發。
    const ttlParsed = parseInt(ttlDays.trim(), 10);
    // relay 檔案上限（ADR-0162）：1–16 整數 MB 才生效。
    const relayMbParsed = parseInt(relayFilesMb.trim(), 10);
    const polOut: OrgPolicy = {
      ...pol,
      ...(Number.isInteger(ttlParsed) && ttlParsed >= 1 && ttlParsed <= 365 ? { messageTtlDays: ttlParsed } : {}),
      ...(Number.isInteger(relayMbParsed) && relayMbParsed >= 1 && relayMbParsed <= 16 ? { relayFilesMaxMb: relayMbParsed } : {}),
    };
    try {
      const anyPol = Object.values(polOut).some(Boolean);
      // 公司設定（ADR-0157）：兩端皆填且不相等才帶班表（相等/單端＝視為未設）。
      const profile = {
        ...(welcome.trim() ? { welcome: welcome.trim() } : {}),
        ...(workStart && workEnd && workStart !== workEnd ? { workHours: { start: workStart, end: workEnd } } : {}),
      };
      setAllowlist(
        onPublish(
          org.trim() || "組織",
          finalMembers,
          anyPol ? polOut : undefined,
          groups.length ? groups : undefined,
          Object.keys(profile).length > 0 ? profile : undefined,
        ),
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
          {/* 入職邀請碼（ADR-0156）：員工在登入畫面或「企業成員」表單貼上即自動加入。 */}
          {inviteCode ? (
            <>
              <div className="groupmodal__label">{t("roster_inviteHint")}</div>
              <div className="settings__keyrow">
                <input className="groupmodal__name" readOnly value={inviteCode} data-testid="roster-invite-code" style={{ flex: 1 }} />
                <button type="button" data-testid="roster-invite-copy" onClick={copyInvite}>
                  {inviteCopied ? "✓" : t("roster_inviteCopy")}
                </button>
              </div>
              {/* 公司帳號金鑰託管（ADR-0163）：勾選＝此邀請建立的是公司帳號、雇主持有金鑰備份。 */}
              <label className="groupmodal__item">
                <input
                  type="checkbox"
                  data-testid="roster-escrow"
                  checked={escrowInvite}
                  onChange={() => {
                    setEscrowInvite((v) => !v);
                    setInviteCopied(false);
                  }}
                />
                <span>{t("roster_escrow")}</span>
              </label>
            </>
          ) : null}
          <input className="groupmodal__name" placeholder="組織名稱" value={org} onChange={(e) => setOrg(e.target.value)} />
          <div className="groupmodal__label">成員（每行：npub 名稱）</div>
          <textarea
            className="groupmodal__name"
            rows={6}
            aria-label="成員清單"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {/* 公司設定（ADR-0157）：歡迎詞／基本規範＋表定上下班時間。 */}
          <div className="groupmodal__label">{t("roster_welcomeLabel")}</div>
          <textarea
            className="groupmodal__name"
            rows={3}
            aria-label={t("roster_welcomeLabel")}
            data-testid="roster-welcome"
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
          />
          <div className="groupmodal__label">{t("roster_workHoursLabel")}</div>
          <div className="settings__keyrow">
            <input
              className="groupmodal__name"
              type="time"
              aria-label="start"
              data-testid="roster-work-start"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
            />
            <span aria-hidden="true">–</span>
            <input
              className="groupmodal__name"
              type="time"
              aria-label="end"
              data-testid="roster-work-end"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
            />
          </div>
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
          {/* 訊息保留天數（ADR-0160）：需搭配自架 relay 的 MAX_TTL_DAYS 放寬上限。 */}
          <div className="groupmodal__label">{t("roster_ttlLabel")}</div>
          <input
            className="groupmodal__name"
            type="number"
            min={1}
            max={365}
            placeholder="7"
            data-testid="roster-ttl-days"
            value={ttlDays}
            onChange={(e) => setTtlDays(e.target.value)}
          />
          {/* relay 檔案上限（ADR-0162）：需搭配自架 relay 的 MAX_FILE_MB 開關。 */}
          <div className="groupmodal__label">{t("roster_relayFilesLabel")}</div>
          <input
            className="groupmodal__name"
            type="number"
            min={1}
            max={16}
            placeholder="0"
            data-testid="roster-relay-files"
            value={relayFilesMb}
            onChange={(e) => setRelayFilesMb(e.target.value)}
          />
          <div className="groupmodal__label">組織群組（可選，每行：群組名稱, npub, npub…；名稱前綴 ! 為公告頻道）</div>
          <textarea
            className="groupmodal__name"
            rows={4}
            aria-label="組織群組"
            placeholder="!全體公告, npub1…, npub1…"
            value={groupText}
            onChange={(e) => setGroupText(e.target.value)}
          />
          <div className="groupmodal__label">身分輪替（可選，換裝置/遺失，每行：舊npub 新npub 名稱）</div>
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
