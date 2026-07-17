import {
  applyGroupControl,
  BoundedSet,
  buildAuthEvent,
  canPostToGroup,
  CALL_SIGNAL_KIND,
  createHeartbeat,
  createNudge,
  createTyping,
  decodePresence,
  deletionTarget,
  type Filter,
  groupTarget,
  groupReceiptMode,
  generateSecretKey,
  getPublicKey,
  HEARTBEAT_ACTIVE_MS,
  HEARTBEAT_IDLE_MS,
  heartbeatCadenceMs,
  isMentioned,
  jitter,
  KIND,
  listEntries,
  TIMESTAMP_JITTER_SECONDS,
  messageExpiry,
  npubDecode,
  npubEncode,
  nsecDecode,
  newGroupId,
  nsecEncode,
  Outbox,
  parseGroupControl,
  PresenceTracker,
  mergeBootstrapPool,
  normalizeRelay,
  ORG_ROSTER_KIND,
  reactionTarget,
  RelayClient,
  RELAY_LIST_KIND,
  buildSnapshotEvent,
  buildSnapshotPurge,
  openSnapshotEvent,
  SNAPSHOT_KIND,
  rosterAllowlist,
  rosterRemap,
  shouldAdoptRoster,
  signOrgRoster,
  verifyOrgRoster,
  relayHintOf,
  shouldAdoptList,
  verifyRelayList,
  PRESENCE_SIGNAL_KIND,
  SDP_SIGNAL_KIND,
  threadRoot,
  unwrapMessage,
  selfCopyTarget,
  type WrappedMessage,
  wrapDeletion,
  wrapGroupControl,
  wrapGroupMessage,
  wrapMessage,
  wrapFileMessage,
  wrapGroupFile,
  wrapPresenceState,
  parseFileMeta,
  wrapReaction,
  wrapReceipt,
  receiptOf,
  FILE_CHUNK_BYTES,
  parseFileChunk,
  policyTtlSeconds,
  splitFileChunks,
  wrapFileChunk,
  wrapProfile,
  parseProfile,
  sanitizeTitle,
  validAvatarDataUri,
  wrapOrgJoin,
  parseOrgJoin,
  type CallMedia,
  type Group,
  type GroupControl,
  type NostrEvent,
  type OrgGroup,
  type OrgMember,
  type OrgPolicy,
  type OrgRosterDoc,
  type OrgWorkHours,
  type OutgoingFile,
  type PresencePayload,
  type ReceiptType,
  type PresenceState,
  type PubkeyHex,
  readNudge,
  readPresenceState,
  readTyping,
  type ReceivedFile,
  type RelayClientHandlers,
  type RelayListDoc,
  type Rumor,
  type SecretKey,
} from "@cinder/core";
import { buildRtcConfig } from "./rtc-config.js";
import { WebRtcCall } from "./webrtc-call.js";
import { WebRtcTransfer } from "./webrtc.js";
import { buildSnapshotContent, mergeSnapshotContent, parseSnapshotContent } from "../storage/cloud-snapshot.js";
import { getDeviceId } from "../storage/device-id.js";
import type { AppStorage, MessageStatus, StoredMessage } from "../storage/types.js";
import type {
  ChatBackend,
  ChatBackendEvents,
  ChatMessage,
  ConnectionState,
  Contact,
  Self,
  Status,
} from "./types.js";

/** pool relay 連續離線超過此時間即標記 hint 可能陳舊（ADR-0036）。 */
export const RELAY_STALE_MS = 5 * 60_000;
/** 主路由離線時的冗餘廣播座數上限（ADR-0039）。 */
export const REDUNDANT_K = 2;
/**
 * 身分守衛（ADR-0122）：呼叫端傳了 `expectPubkey` 卻無法取得那把金鑰。
 *
 * **不要把它當成「沒有身分」而去產生一把新的**——那會把使用者換成另一個人。
 * App 收到這個錯誤時應該去要 nsec（解鎖畫面／貼上 nsec），而不是建立新身分。
 */
export const IDENTITY_UNAVAILABLE = "IDENTITY_UNAVAILABLE";
/** 身分守衛（ADR-0122）：解出來的 pubkey 與 `expectPubkey` 不符（錯的金鑰／儲存毀損）。 */
export const IDENTITY_MISMATCH = "IDENTITY_MISMATCH";

const PRESENCE_TIMEOUT_MS = 90_000; // 3× 心跳（30s）：容忍偶發丟包/抖動，不因單次遲到就翻離線（ADR-0059）

/**
 * 訊息請求區的數量上限（ADR-0127 防洪）。超過就 FIFO 逐出最舊（連同其訊息／封存）。
 *
 * 100 遠超任何正常情境——真的同時有 100 個陌生人在等你確認，那已經是被灌爆了。此時逐出最舊
 * ＋提供「全部刪除」是合理的；讓它無界成長才是問題（記憶體與儲存都會被撐爆）。
 */
const MAX_REQUESTS = 100;

/** 早到群訊緩存的上限（ADR-0131）：防止惡意假 `g` tag 撐爆記憶體。 */
const MAX_PENDING_GROUPS = 32;
const MAX_PENDING_PER_GROUP = 64;
const nowSec = () => Math.floor(Date.now() / 1000);

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…`;

/**
 * 持久化訊息 → UI 訊息映射（含檔案附件，ADR-0093）。檔案訊息不含位元組：
 * `sent`＝已送出（outgoing）或已存本機（有 savedPath）時為 size，否則 0（metadata-only，
 * 例：位元組落在另一台裝置）；`url` 於重載後永遠沒有（App 不保管位元組）。
 */
/**
 * 訊息時間（ADR-0108）：採**發送者宣告的送出時間**（`rumor.created_at`，經 rumor 雜湊驗證，
 * 中繼改不了），而非接收端的 `Date.now()`（下載時間）。
 *
 * 用下載時間會壞掉：離線一天後上線，中繼把整天的留言一次回放 → 每則都被蓋上「現在」，
 * 時間全錯；而 NIP-59 的 `jitteredPast()` 又把**外層**時戳隨機往前推，回放順序本就不是送出
 * 順序 → 顯示順序＝到達順序＝隨機。ADR-0107 之後更糟：兩台裝置的下載時間必然不同，
 * 同一個對話在手機與電腦上會長得不一樣。也因此，下載時間根本無法當跨裝置的已讀水位鍵。
 *
 * 箝制未來時戳：壞掉或惡意的時鐘不得把訊息永遠釘在對話頂端。
 */
function msgTime(rumor: Rumor): number {
  return Math.min(rumor.created_at * 1000, Date.now());
}

function storedToChat(m: StoredMessage): ChatMessage {
  return {
    id: m.id,
    outgoing: m.outgoing,
    text: m.text,
    at: m.at,
    ...(m.sender !== undefined ? { sender: m.sender } : {}),
    ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}),
    ...(m.mentionsMe ? { mentionsMe: true } : {}),
    ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}),
    ...(m.status !== undefined ? { status: m.status } : {}),
    ...(m.receipts ? { receipts: { ...m.receipts } } : {}), // 群組每成員回條（ADR-0095）
    ...(m.file
      ? {
          file: {
            id: m.file.tid,
            name: m.file.name,
            mime: m.file.mime,
            size: m.file.size,
            sent: m.outgoing || m.file.savedPath ? m.file.size : 0,
            incoming: !m.outgoing,
            ...(m.file.savedPath ? { savedPath: m.file.savedPath } : {}),
            ...(m.file.thumb ? { thumb: m.file.thumb } : {}), // ADR-0102：縮圖跨 session 存活
          },
        }
      : {}),
  };
}

/**
 * 建立一個已接好收發的 RelayClient（真實 WebSocket 或測試替身）。
 * `onStatus` 可選：回報連線狀態變化（連線中/上線/離線）。
 */
export type RelayConnector = (
  handlers: RelayClientHandlers,
  onStatus?: (state: ConnectionState) => void,
) => RelayClient;

/** 可關閉的 relay client：`close` 停止重連並斷線（清除 hint 時釋放連線）。 */
export type CloseableRelayClient = RelayClient & { close?: () => void };

const RECONNECT_MAX_MS = 15_000;

/** 正規化 relay URL（trim、去尾斜線）；非 ws(s) 或空值回傳 undefined。 */
export function normalizeRelayUrl(url: string | undefined): string | undefined {
  const u = url?.trim().replace(/\/+$/, "");
  if (!u || !/^wss?:\/\//i.test(u)) return undefined;
  // 與 core `normalizeRelay` 對齊：協定/主機小寫，避免同一站因大小寫被當兩座 → 重複連線（審查 L7）。
  try {
    const parsed = new URL(u);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return u;
  }
}

/** 以真實 WebSocket 連上 relay 的連接器，含指數退避自動重連與狀態回報。 */
export function webSocketConnector(url: string): RelayConnector {
  return (handlers, onStatus) => {
    let ws: WebSocket;
    let open = false;
    let attempt = 0;
    let pending: string[] = [];

    let stopped = false;
    const client: CloseableRelayClient = new RelayClient(
      { send: (data) => (open ? ws.send(data) : pending.push(data)) },
      handlers,
    );
    client.close = () => {
      stopped = true;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    };

    const connect = () => {
      onStatus?.("connecting");
      ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        open = true;
        attempt = 0;
        onStatus?.("online");
        for (const m of pending) ws.send(m);
        pending = [];
      });
      ws.addEventListener("message", (e: MessageEvent) => {
        client.receive(typeof e.data === "string" ? e.data : "");
      });
      ws.addEventListener("close", () => {
        open = false;
        if (stopped) return; // 已清除 hint：不再重連
        onStatus?.("offline");
        const delay = Math.min(1000 * 2 ** attempt, RECONNECT_MAX_MS);
        attempt += 1;
        setTimeout(connect, delay);
      });
      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
      });
    };

    connect();
    return client;
  };
}

/**
 * 真實 relay 後端：身分與訊息本機持久化（{@link AppStorage}），
 * 經注入的連接器連上 relay 收發（NIP-17/59 Gift Wrap 私訊、心跳、輸入中、Nudge）。
 */
/** 多中繼路由選項（ADR-0034）；未提供 `connectorFor` 時為單 relay 模式。 */
export interface RelayPoolOptions {
  /** 自己的 home relay URL（用於與聯絡人 hint 比對去重、組分享字串）。 */
  relayUrl?: string;
  /** 依 URL 建立外部 relay 連線的工廠。 */
  connectorFor?: (url: string) => RelayConnector;
  /** 硬編碼錨點 relay（ADR-0039）：恆連保底 + 引導清單來源。 */
  anchors?: string[];
  /** 維護者公鑰：驗證帶內 relay 清單事件（ADR-0039）；未設則不學清單。 */
  maintainerPubkey?: string;
  /** home 因長期離線自動遞補到健康引導座時通知（ADR-0039）。 */
  onHomeSwitched?: (newUrl: string) => void;
  /** 企業組織名冊的管理者公鑰（ADR-0047）；設定後訂閱並自動採用名冊、同步通訊錄。 */
  orgAdminPubkey?: string;
  /**
   * 開機初始狀態與自訂狀態文字（ADR-0164）：本機記住的手動狀態，**建構時就 seed 進 self**，
   * 讓 `start()` 的首拍 `beat()` 直接尊重（尤其「離線」須靜默，不能事後補正——否則已漏一拍）。
   * 未提供＝沿用預設 `online`／空字串。
   */
  initialStatus?: Status;
  initialStatusMessage?: string;
  /**
   * 入職權杖（ADR-0156，成員側）：來自邀請碼。設定後每次開機檢查——名冊尚未包含自己
   * 即把 `{name, token}` 加密送給管理者（冪等；管理者對已在冊者忽略）。
   */
  orgJoinToken?: string;
  /** 公司帳號金鑰託管（ADR-0163，成員側）：邀請碼 escrow 旗標。入職請求附上 nsec 託管。 */
  orgEscrow?: boolean;
  /**
   * 企業主（ADR-0155/0156，管理者側）：訂閱**自己簽章**的名冊（重啟後找回 lastRoster），
   * 並開啟入職請求的自動核准管線。
   */
  orgOwner?: boolean;
  /** 企業主的核准權杖（ADR-0156）：入職請求帶相同權杖才自動核准；未設＝不自動核准。 */
  orgInviteToken?: string;
  /** 企業 TURN 伺服器（ADR-0048）：供強制 TURN 政策使用；relay-only 時的 ICE 中繼。 */
  turnServers?: RTCIceServer[];
  /**
   * 私鑰由外部（OS 金鑰庫）提供而非 localStorage（B5，ADR-0053）。設定後以此為身分
   * 私鑰、**不寫入** identity blob；未設則沿用既有行為（從 storage 讀/自動產生）。
   */
  nsecOverride?: string;
  /**
   * 🔴 **這應該是誰**（ADR-0122）。呼叫端已經知道作用中身分的 pubkey 時務必傳入。
   *
   * 設定後：
   *  - 儲存裡沒有身分、也沒有 `nsecOverride` → **拋 `IDENTITY_UNAVAILABLE`**，
   *    而**不是**產生一把新金鑰。
   *  - 解出來的 pubkey 與期待不符 → 拋 `IDENTITY_MISMATCH`。
   *
   * 為什麼要有這個：瀏覽器版曾經在重載時拿不到 nsec（金鑰只在記憶體），於是走進
   * 「沒有身分 → `generateSecretKey()`」這條路——**使用者按一下重新整理就變成另一個人**，
   * 舊資料全部讀不出來，而且新的明文 nsec 被寫進 localStorage。
   *
   * 「安靜地做錯的事」是這個專案反覆出現的失敗模式。這條守衛是對它的一般性防禦：
   * 只要呼叫端知道期待值，任何原因造成的身分不符都會**大聲失敗**。
   */
  expectPubkey?: PubkeyHex;
  /** 搬家排水（ADR-0066 H3）：額外訂閱這座「舊 home」的自家收件匣；到期與否由 App 層判定。 */
  drainUrl?: string;
  /**
   * 加密雲端快照（ADR-0071 J2）：設定後於開機與定時檢查發佈狀態快照
   * （NIP-44 加密給自己、`d`＝deviceId）。未設＝不發佈；接收合併（J3）恆開。
   */
  cloudSync?: { mode: "basic" | "full"; deviceId: string };
  /**
   * durable 搬家通知（ADR-0069 T2/T3）：home 持續死亡逾門檻或清單標 draining/retired
   * 時呼叫，App 執行保命名空間搬家（H2）＋排水（H3）＋重載。未設＝維持 session 遞補現況。
   */
  onHomeMigrate?: (newUrl: string, reason: "dead" | "retired") => void;
  /** T2 門檻（ms）：home 連續離線超過此值→durable 搬家。預設 24 小時；測試可縮。 */
  homeDeadMs?: number;
  /** T3 分批延遲（ms）產生器（防羊群）；預設隨機 0–6 小時。測試可注入定值。 */
  retireDelayMs?: () => number;
}

export class RelayChatBackend implements ChatBackend {
  readonly self: Self;
  readonly selfNpub: string;
  readonly selfNsec: string;
  /** 分享用字串：`npub…@wss://…`（設定了 home relay 時），否則同 selfNpub（home 遞補後即時反映）。 */
  get selfShareUri(): string {
    return this.homeUrl ? `${this.selfNpub}@${this.homeUrl}` : this.selfNpub;
  }
  private readonly sk: SecretKey;
  private readonly client: CloseableRelayClient;
  /** `this.client` 實際連往的 URL（不變）；home 遞補時 effective home 才變。 */
  private readonly originalHomeUrl: string | undefined;
  /** 目前 effective home（ADR-0039 可自動遞補）。 */
  private homeUrl: string | undefined;
  private readonly connectorFor: ((url: string) => RelayConnector) | undefined;
  /** 搬家排水的舊 home（ADR-0066 H3）：只多訂閱其收件匣，不參與發送路由。 */
  private readonly drainUrl: string | undefined;
  /** 加密雲端快照設定（ADR-0071）；undefined＝不發佈（接收合併恆開）。 */
  private readonly cloudSync: { mode: "basic" | "full"; deviceId: string } | undefined;
  private snapTimer: ReturnType<typeof setInterval> | undefined;
  /** 企業政策禁止快照上雲（ADR-0071）：名冊採用時設定，即刻停止發佈。 */
  private cloudBackupBlocked = false;
  /** durable 搬家（ADR-0069 T2/T3）：通知回呼、T2 門檻、T3 延遲、一次性 latch。 */
  private readonly onHomeMigrate: ((newUrl: string, reason: "dead" | "retired") => void) | undefined;
  private readonly homeDeadMs: number;
  private readonly retireDelayFn: (() => number) | undefined;
  private migrateFired = false;
  private retireTimer: ReturnType<typeof setTimeout> | undefined;
  /** 引導座（錨點 ∪ 已採用清單，ADR-0039）：恆連保底、冗餘廣播與 home 遞補來源。 */
  private readonly bootstrapSeats = new Set<string>();
  private readonly maintainerPubkey: string | undefined;
  /** 企業名冊管理者公鑰與最近採用的名冊（ADR-0047）。 */
  private readonly orgAdminPubkey: string | undefined;
  private lastRoster: OrgRosterDoc | null = null;
  /** 入職權杖（ADR-0156 成員側）：開機時名冊未含自己 → 送入職請求。 */
  private readonly orgJoinToken: string | undefined;
  /** 公司帳號金鑰託管（ADR-0163 成員側）：true＝入職請求附上 nsec 託管給管理者。 */
  private readonly orgEscrowSelf: boolean;
  /** 企業主旗標與核准權杖（ADR-0156 管理者側）。 */
  private readonly orgOwnerFlag: boolean;
  private readonly orgInviteToken: string | undefined;
  /** 首份名冊發佈前收到的入職請求（ADR-0156）：發佈時自動併入。 */
  private readonly pendingJoins = new Map<PubkeyHex, string>();
  /** relay 檔案分塊重組（ADR-0162）：tid → 收到的塊。防禦上限見 receiveFileChunk。 */
  private readonly chunkAsm = new Map<
    string,
    { sender: PubkeyHex; name: string; mime: string; total: number; parts: Map<number, Uint8Array>; at: number }
  >();
  /** 不完整重組的逾時（秒，審查修正）：超時未收齊即回收，避免一格永久佔用卡死接收。 */
  private static readonly CHUNK_ASM_TTL_SEC = 120;
  /** 企業 TURN 伺服器與強制 TURN 政策狀態（ADR-0048）：供 WebRTC ICE 設定。 */
  private readonly turnServers: RTCIceServer[] | undefined;
  private forceTurn = false;
  private readonly onHomeSwitched: ((url: string) => void) | undefined;
  private lastList: RelayListDoc | null;
  /** 外部 relay 連線（正規化 URL → client），惰性建立（ADR-0034）。 */
  private readonly relayPool = new Map<string, CloseableRelayClient>();
  /** 跨 relay 事件去重（同一事件可能經多個 relay 抵達）。 */
  private readonly seenEvt = new BoundedSet<string>(4096, 2048);
  /** 各 relay 連線狀態（home + pool），供設定面板顯示（ADR-0034 後續）。 */
  private readonly relayStates = new Map<string, ConnectionState>();
  /** 各 relay 連續離線的起點（ms）；上線即清除（ADR-0036 陳舊偵測）。 */
  private readonly offlineSince = new Map<string, number>();
  /** 各發送頻道的最近內容簽章（防抖：見 emitIfChanged）。 */
  private readonly emitSigs = new Map<string, string>();
  private readonly presence = new PresenceTracker();
  private readonly statuses = new Map<PubkeyHex, PresencePayload>();
  private nowPlaying = "";
  /** 隱身（ADR-0088 (d)）：完全不廣播心跳（對 relay 與聯絡人皆顯示離線），但仍正常收發。 */
  private invisible = false;
  // 送達/已讀回條（ADR-0058）。
  /**
   * 早到的回條（ADR-0107）：訊息 id → 尚未套用的回條們。
   *
   * NIP-59 的 `jitteredPast()` 把外層 wrap 的 `created_at` **隨機往前推**（隱私設計），
   * 所以中繼回放的順序是亂的——**對方的回條可能比我的自封副本更早抵達我的另一台裝置**。
   * 若直接丟棄，那則訊息會永遠卡在 `sent`，即使早已送達/已讀。故先暫存，待該訊息（自封副本）
   * 抵達時原樣重放。群組回條逐成員，故存整筆回條而非單一狀態。
   */
  private readonly pendingReceipts = new Map<string, { from: PubkeyHex; type: ReceiptType; groupId?: string }[]>();
  /** 早到群訊緩存（ADR-0131）：指向本地還不存在的群組的訊息，待加入後重放（有界）。 */
  private readonly pendingGroupMsgs = new Map<string, { sender: PubkeyHex; rumor: Rumor }[]>();
  /** 已送出的最新「已讀」水位訊息 id（避免重複送已讀回條）。
   *  鍵：1:1 為對方 pubkey；群組為 `<groupId>:<發訊者pubkey>`（每位發訊者各一條水位，ADR-0095）。 */
  private readonly lastReadSent = new Map<string, string>();
  /** 已讀回條開關（opt-in，預設關；關閉時不送也不顯示他人已讀——互惠）。 */
  private readReceipts = false;
  // 訊息去重（審查 P1-4）：有界，逐出最舊；儲存層與 UI 層另有去重兜底。
  private readonly seenMsg = new BoundedSet<string>(8192, 4096);
  /** 檔案訊息關聯（ADR-0093）：傳輸 id → {對話, 訊息 id}；用來把 P2P 位元組與中繼 metadata
   *  對到同一則檔案訊息（避免收到 metadata 又收到位元組時重出兩則）。本 session 記憶體狀態。 */
  private readonly fileMsgByTid = new Map<string, { contact: PubkeyHex; msgId: string }>();
  /** 群訊扇出追蹤（ADR-0095）：每個 wrap 的 event id → 該群訊的送出狀態（多 wrap 共用一個 state）。 */
  private readonly fanout = new Map<string, { convo: string; messageId: string; pending: number; ok: boolean }>();
  /**
   * 未讀數（ADR-0110）：對話 → 未讀則數。**增量維護**，不是每收一則訊息就重掃全部歷史。
   *
   * ADR-0108 的初版實作在每一則收訊時重算「所有對話的所有訊息」——在 LocalStorage 下
   * 等於重新解析每個對話的完整歷史（實測 5 萬則的對話光載入就 47ms）。開機時全量算一次，
   * 之後收訊 +1、清未讀歸零，皆為 O(1)。
   */
  private readonly unread = new Map<string, number>();
  /** 每個對話最新一則**他人**訊息的時間（ADR-0110）：讓 `clearUnread` 免掃全對話即可推進水位。 */
  private readonly lastIncomingAt = new Map<string, number>();
  /**
   * 收件箱水位（ADR-0109 S4）：中繼 URL → 該座送過的最大外層 `created_at`（秒）。
   * 供重連時做增量抓取（`since`）。逐中繼——不同中繼的事件集合不同，共用全域水位會漏事件。
   * 只在記憶體：session 內重連走增量，App 重啟仍全量抓一次。
   */
  private readonly inboxWatermark = new Map<string, number>();
  private contacts: {
    pubkey: PubkeyHex;
    name: string;
    relayUrl?: string;
    alias?: string;
    notifySound?: string;
    avatar?: string;
    title?: string;
  }[];
  /** 自己的廣播頭像（ADR-0154）：null＝從未設定；""＝已移除（持續廣播移除記號）。 */
  private myAvatar: string | null = null;
  /** 自己的企業頭銜（ADR-0158）：三態語意同 myAvatar。 */
  private myTitle: string | null = null;
  private blocked: { pubkey: PubkeyHex; name: string }[];
  /** 訊息請求（ADR-0121）：陌生人傳來訊息但你還沒接受。**不是聯絡人。** */
  private requests: { pubkey: PubkeyHex; name: string; relayUrl?: string; avatar?: string; title?: string }[];
  private groups: Group[];
  private readonly transfer: WebRtcTransfer;
  private readonly call: WebRtcCall;
  private handlers: ChatBackendEvents | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private renderTimer: ReturnType<typeof setInterval> | undefined;
  /** 可靠訊息（kind 1059 DM/群訊/群控）的節流外送匣（ADR-0041）。 */
  private readonly outbox: Outbox;
  private pumpTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly storage: AppStorage,
    connector: RelayConnector,
    name?: string,
    pool?: RelayPoolOptions,
  ) {
    this.homeUrl = normalizeRelayUrl(pool?.relayUrl);
    this.originalHomeUrl = this.homeUrl;
    const drain = normalizeRelayUrl(pool?.drainUrl);
    this.drainUrl = drain !== this.homeUrl ? drain : undefined;
    this.cloudSync = pool?.cloudSync;
    this.onHomeMigrate = pool?.onHomeMigrate;
    this.homeDeadMs = pool?.homeDeadMs ?? 24 * 3600_000;
    this.retireDelayFn = pool?.retireDelayMs;
    this.connectorFor = pool?.connectorFor;
    this.maintainerPubkey = pool?.maintainerPubkey;
    this.orgAdminPubkey = pool?.orgAdminPubkey;
    this.orgJoinToken = pool?.orgJoinToken; // ADR-0156
    this.orgEscrowSelf = pool?.orgEscrow === true; // ADR-0163
    this.orgOwnerFlag = pool?.orgOwner === true;
    this.orgInviteToken = pool?.orgInviteToken;
    this.turnServers = pool?.turnServers;
    this.onHomeSwitched = pool?.onHomeSwitched;
    for (const a of pool?.anchors ?? []) {
      const norm = normalizeRelay(a);
      if (norm && norm !== this.homeUrl) this.bootstrapSeats.add(norm);
    }
    this.lastList = storage.loadBootstrapList();
    for (const r of this.lastList?.relays ?? []) {
      const norm = normalizeRelay(r);
      if (norm && norm !== this.homeUrl) this.bootstrapSeats.add(norm);
    }
    let identity = storage.loadIdentity();
    if (pool?.nsecOverride) {
      // B5（ADR-0053）：私鑰由 OS 金鑰庫提供，不落 localStorage identity blob。
      identity = { nsec: pool.nsecOverride, name: name?.trim() || identity?.name || "我" };
    } else if (!identity) {
      // 🔴 ADR-0122：呼叫端知道這應該是誰，卻拿不到金鑰 → **絕不產生新的**。
      // 靜默產生＝把使用者換成另一個人，還會用新身分覆蓋掉他原本的資料。
      if (pool?.expectPubkey) throw new Error(IDENTITY_UNAVAILABLE);
      const sk = generateSecretKey();
      identity = { nsec: nsecEncode(sk), name: name?.trim() || "我" };
      storage.saveIdentity(identity);
    } else if (name && name.trim() && name.trim() !== identity.name) {
      identity = { ...identity, name: name.trim() };
      storage.saveIdentity(identity);
    }
    this.sk = nsecDecode(identity.nsec);
    const pubkey = getPublicKey(this.sk);
    if (pool?.expectPubkey && pubkey !== pool.expectPubkey) throw new Error(IDENTITY_MISMATCH);
    // ADR-0164：以本機記住的狀態 seed（尤其離線須從第一拍就靜默）；未提供＝預設 online/空。
    this.self = { pubkey, name: identity.name, status: pool?.initialStatus ?? "online", statusMessage: pool?.initialStatusMessage ?? "" };
    this.selfNpub = npubEncode(pubkey);
    this.selfNsec = identity.nsec;
    this.contacts = storage.loadContacts();
    this.myAvatar = storage.loadSelfAvatar(); // ADR-0154：開機廣播帶上頭像（或移除記號）
    this.myTitle = storage.loadSelfTitle(); // ADR-0158：企業頭銜同理
    this.blocked = storage.loadBlocked();
    this.requests = storage.loadRequests();
    this.groups = storage.loadGroups();
    this.outbox = new Outbox({
      send: (evt) => this.publishAddressed(evt),
      onDrop: (evt, reason) => {
        // 快照發佈失敗（拒收/重試耗盡）→ 清節流記錄讓 30 分後重試（審查修正 #5）。
        if (evt.kind === SNAPSHOT_KIND) this.clearSnapshotThrottle();
        // 明確拒收或重試耗盡 → 標記該訊息為傳送失敗（ADR-0095：UI 顯示紅色重試圖示）。
        console.warn(`[outbox] 事件 ${evt.id.slice(0, 8)}… 未送達：${reason}`);
        this.markFailed(evt.id);
      },
    });
    this.client = connector(
      {
        onEvent: (_sub, event) => this.onEvent(event, this.homeUrl),
        onOk: (id, accepted, message) => {
          this.outbox.onOk(id, accepted, message);
          if (accepted) this.markSent(id); // Tier 1（ADR-0058）：relay 接受＝已送中繼
        },
        // NIP-42 AUTH（ADR-0057）：回應挑戰；認證成功後重掛訂閱（解「訂閱早於認證」）。
        authSigner: (challenge) => buildAuthEvent(challenge, this.homeUrl ?? "", this.sk),
        onAuthenticated: (client) => this.subscribeOn(client, this.homeUrl),
      },
      (state) => this.onConnection(state),
    );
    this.transfer = new WebRtcTransfer(
      this.sk,
      {
      publishSignal: (evt) => this.publishAddressed(evt),
      onOutgoingProgress: (peer, id, sent, total) => this.handlers?.onFileProgress?.(peer, id, sent, total),
      onIncoming: (peer, file) => {
        if (this.isBlocked(peer)) return;
        this.ensureKnown(peer); // ADR-0121：陌生人傳檔同樣只進請求區

        this.onFileBytes(peer, file);
      },
      onTyping: (peer) => {
        if (!this.isBlocked(peer)) this.handlers?.onTyping(peer);
      },
      onPresence: (peer, p) => {
        // ADR-0088 (e)：P2P 收到的在線狀態與 relay 心跳**同源處理**（同一套判離線狀態機，
        // 避免雙來源閃爍）。同源就必須**同樣完整**——ADR-0109 的兩件事這裡都要有：
        //   1. 自報節奏（`p.hb`）→ 容忍窗依對方節奏算，否則閒置者（5 分鐘一則）被誤判離線；
        //   2. IDLE→ACTIVE 的喚醒補發 → 否則「唯一在線的聯絡人只走 P2P」時我永遠不會加速。
        if (this.isBlocked(peer)) return;
        const wasIdle = !this.anyContactOnline();
        this.presence.observe(peer, nowSec(), p.hb);
        this.statuses.set(peer, { s: p.s as PresenceState, m: p.m, np: p.np });
        if (wasIdle && this.anyContactOnline()) {
          this.beat();
          this.scheduleBeat();
        }
      },
      onError: (peer, reason) => this.handlers?.onFileError?.(peer, reason),
      },
      () => this.rtcConfig(),
    );
    this.call = new WebRtcCall(
      this.sk,
      {
        publishCallSignal: (evt) => this.publishAddressed(evt),
        onState: (peer, state, media) => this.handlers?.onCallState?.(peer, state, media),
        onLocalStream: (stream) => this.handlers?.onCallLocalStream?.(stream),
        onRemoteStream: (stream) => this.handlers?.onCallRemoteStream?.(stream),
        onError: (reason) => this.handlers?.onFileError?.(this.self.pubkey, reason),
      },
      () => this.rtcConfig(),
      (pubkey) => this.isBlocked(pubkey),
    );
  }

  start(handlers: ChatBackendEvents): void {
    this.handlers = handlers;
    this.resubscribe();
    this.beat();
    this.broadcastProfile(); // ADR-0061：把自己的顯示名稱廣播給聯絡人
    this.maybeSendOrgJoin(); // ADR-0156：入職請求（名冊尚未收錄自己時，每次開機重送直到入冊）
    this.broadcastGroups(); // ADR-0068：管理員把自建群組快照廣播給成員（換機自癒）
    this.maybePublishSnapshot(); // ADR-0071：雲端快照（開機檢查；內容有變＋每日至多一次）
    this.reconcileCloudOff(); // 審查修正 #6：關閉狀態的雲端殘留對帳
    this.snapTimer = setInterval(() => this.maybePublishSnapshot(), 30 * 60_000);
    this.scheduleBeat();
    this.renderTimer = setInterval(() => {
      this.emitContacts();
      this.maybeSucceedHome(); // home 長期離線 → 自動遞補健康引導座（ADR-0039）
      this.maybeMigrateHome(); // home 死亡逾門檻 → durable 搬家通知（ADR-0069 T2）
      this.emitRelayPool(); // stale 隨時間推移改變；簽章防抖，沒變不發
    }, 1000);
    // 外送匣節流泵（ADR-0041）：以固定間隔在併發上限內送出、退避重試、丟棄逾時在途。
    this.pumpTimer = setInterval(() => this.outbox.pump(), 200);
    this.emitContacts();
    // 回放本機持久化的歷史訊息：每對話一次批次交付（避免逐則 O(n²) 狀態更新與全開視窗）。
    for (const c of this.contacts) {
      const msgs = this.storage.loadMessages(c.pubkey);
      if (msgs.length === 0) continue;
      for (const m of msgs) this.seenMsg.add(m.id);
      handlers.onHistory?.(c.pubkey, msgs.map(storedToChat));
    }
    // 回放持久化的回應（並標記已見，避免 relay 重送時重複處理）
    for (const r of this.storage.loadReactions()) {
      this.seenMsg.add(r.id);
      handlers.onReaction?.(r.messageId, r.emoji, r.mine);
    }
    // 回放已收回的訊息
    for (const id of this.storage.loadDeleted()) {
      handlers.onUnsend?.(id);
    }
    // 回放群組與其歷史訊息（同樣批次交付）
    this.emitGroups();
    for (const g of this.groups) {
      const msgs = this.storage.loadMessages(g.id);
      if (msgs.length === 0) continue;
      for (const m of msgs) this.seenMsg.add(m.id);
      handlers.onHistory?.(g.id, msgs.map(storedToChat));
    }
    this.emitBlocked();
    this.emitRequests(); // ADR-0121：重載後請求區仍在
    // ADR-0108：未讀由儲存推導 → 重新載入後徽章仍在。開機時全量重算一次（ADR-0110：僅此一次）。
    this.recountAllUnread();
    this.emitUnread();
  }

  /** 聯絡人某 relay hint 是否屬於外部 relay（非 home）。 */
  private foreignUrlOf(contact: { relayUrl?: string }): string | undefined {
    const url = normalizeRelayUrl(contact.relayUrl);
    return url && url !== this.homeUrl ? url : undefined;
  }

  /** effective home 的連線：未遞補時為原始 this.client，遞補後為對應引導座。 */
  private homeClient(): CloseableRelayClient {
    if (this.homeUrl && this.homeUrl !== this.originalHomeUrl) {
      return this.poolClient(this.homeUrl) ?? this.client;
    }
    return this.client;
  }

  /** 取得（必要時建立）外部 relay 連線；單 relay 模式回傳 undefined。 */
  private poolClient(url: string): RelayClient | undefined {
    if (!this.connectorFor) return undefined;
    let client = this.relayPool.get(url);
    if (!client) {
      client = this.connectorFor(url)(
        {
          onEvent: (_sub, event) => this.onEvent(event, url),
          // NIP-42 AUTH（ADR-0057）：外部 relay 的挑戰回應 + 認證後重掛該 relay 訂閱。
          authSigner: (challenge) => buildAuthEvent(challenge, url, this.sk),
          onAuthenticated: (client) => this.subscribeOn(client, url),
        },
        // 外部 relay 重連後重掛該 relay 的訂閱；不驅動 UI 主連線指示（ADR-0034）。
        (state) => {
          this.trackRelayState(url, state);
          if (state === "online") this.resubscribeRelay(url);
        },
      );
      this.relayPool.set(url, client);
      // onStatus 可能在註冊前同步觸發（測試替身）；註冊後補發一次 pool 快照。
      this.emitRelayPool();
    }
    return client;
  }

  /**
   * Addressed 事件（帶收件人 `p` tag）→ 收件人的 relay；無 hint 退回 home。
   * 主路由離線時，冗餘廣播到健康引導座（ADR-0036 雙發一般化為 ADR-0039 有界冗餘）。
   */
  /**
   * 可靠訊息（kind 1059 DM/群訊/群控）改走節流外送匣：以 OK 確認、暫時失敗退避重試、
   * 重連補送（ADR-0041）。延遲敏感的信令/輸入中仍走 {@link publishAddressed} 直送。
   */
  private publishReliable(evt: NostrEvent): void {
    this.outbox.enqueue(evt);
    this.outbox.pump(); // 立即嘗試送出（在併發上限內）；其餘由泵計時器與 OK 回覆續送。
  }

  private publishAddressed(evt: NostrEvent): void {
    const to = evt.tags.find((t) => t[0] === "p")?.[1];
    const contact = to ? this.contacts.find((c) => c.pubkey === to) : undefined;
    const url = contact ? this.foreignUrlOf(contact) : undefined;
    const primaryUrl = url ?? this.homeUrl;
    const primary = url ? this.poolClient(url) : this.homeClient();
    (primary ?? this.client).publish(evt); // 一律投入主路由（離線則入其重連佇列）
    if (primaryUrl !== undefined && this.relayStates.get(primaryUrl) === "offline") {
      for (const seat of this.healthySeats(primaryUrl)) seat.publish(evt);
    }
  }

  /** 健康的引導座（home + 錨點/清單座，狀態非 offline），排除 `exclude`，去重、上限 K。 */
  private healthySeats(exclude: string | undefined): CloseableRelayClient[] {
    // home 遞補後其 URL 亦在 bootstrapSeats，需去重避免對同一座重複 publish。
    const seen = new Set<string>(exclude ? [exclude] : []);
    const urls: string[] = [];
    if (this.homeUrl && !seen.has(this.homeUrl) && this.relayStates.get(this.homeUrl) !== "offline") {
      urls.push(this.homeUrl);
      seen.add(this.homeUrl);
    }
    for (const url of this.bootstrapSeats) {
      if (!seen.has(url) && this.relayStates.get(url) !== "offline") {
        urls.push(url);
        seen.add(url);
      }
    }
    const out: CloseableRelayClient[] = [];
    for (const url of urls) {
      const client = url === this.homeUrl ? this.homeClient() : this.poolClient(url);
      if (client) out.push(client);
      if (out.length >= REDUNDANT_K) break;
    }
    return out;
  }

  /** 對某個 relay 掛訂閱：完整收件箱 + 該 relay 上發心跳的聯絡人 presence。 */
  /**
   * 掛上這條連線的所有訂閱——**合併為單一 REQ**（ADR-0109 S3）。
   *
   * 過去是 9 個獨立的 REQ ＝ 每次（重）連線 9 個 DO request，而 `resubscribe()` 有 11 個
   * 呼叫點（含每加一個聯絡人）。NIP-01 的 REQ 本來就吃多個 filter（OR 語意），而：
   * - 本後端的 `onEvent` **完全忽略 subId**，一律依 `event.kind` 分派；
   * - 從不註冊 `onEose`、從不 `unsubscribe`；
   * - 中繼端 `buildEntry()` 已跨所有 filter 收集 kinds 建索引、`handleReq()` 已逐 filter
   *   重播並以 event id 去重。
   *
   * 故合併是純客戶端改動，語意完全不變。
   */
  private subscribeOn(client: RelayClient, url: string | undefined): void {
    const authors = this.contacts
      .filter((c) => (this.foreignUrlOf(c) ?? this.homeUrl) === url)
      .map((c) => c.pubkey);
    const all = this.contacts.map((c) => c.pubkey);
    const me = [this.self.pubkey];
    const filters: Filter[] = [
      // F5：presence 心跳已彙整音樂狀態（np），不再單獨訂閱 MUSIC。
      { kinds: [KIND.HEARTBEAT], authors },
      // ADR-0120：typing/nudge 已 NIP-59 封裝 → 外層作者是**一次性臨時金鑰**，`authors: all`
      // 永遠不會命中。改為只靠 `#p`（與 Gift Wrap 收件箱同形）。
      //
      // 🔴 副作用：過去是這個 `authors` 過濾器在擋陌生人。拿掉之後**任何人都能對你發 nudge**
      // （而 nudge 會震動裝置、跳通知）→ 把關移到 `senderOfSealed()`，見該處。
      //
      // 附帶好處：這兩個 REQ 不再把整份聯絡人清單交給中繼。
      { kinds: [KIND.TYPING], "#p": me },
      { kinds: [KIND.NUDGE], "#p": me },
      { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": me, ...this.inboxSince(url) },
      // 自己的雲端快照（ADR-0071 J3）：接收合併恆開——換機還原不需任何前置設定。
      { kinds: [SNAPSHOT_KIND], authors: me },
      { kinds: [SDP_SIGNAL_KIND], "#p": me },
      { kinds: [CALL_SIGNAL_KIND], "#p": me },
      { kinds: [PRESENCE_SIGNAL_KIND], "#p": me }, // 封裝的在線狀態（ADR-0129）
      // 帶內引導清單（ADR-0039）：訂閱維護者簽章的 relay 清單事件。
      ...(this.maintainerPubkey ? [{ kinds: [RELAY_LIST_KIND], authors: [this.maintainerPubkey] }] : []),
      // 檔案塊（ADR-0162）：組織小檔案經 relay 暫存；未啟用的站不會有這類事件，訂閱無成本。
      { kinds: [KIND.FILE_WRAP], "#p": me },
      // 企業組織名冊（ADR-0047）：訂閱管理者簽章的名冊事件。
      ...(this.orgAdminPubkey ? [{ kinds: [ORG_ROSTER_KIND], authors: [this.orgAdminPubkey] }] : []),
      // 企業主（ADR-0156）：訂閱**自己**簽章的名冊——重啟後找回 lastRoster，自動核准不失憶。
      ...(this.orgOwnerFlag ? [{ kinds: [ORG_ROSTER_KIND], authors: [this.self.pubkey] }] : []),
    ];
    client.subscribe("all", filters);
  }

  /**
   * 收件箱的增量抓取窗（ADR-0109 S4）：`since = 該中繼上收過的最大外層 created_at − 2 天`。
   *
   * **那個「− 2 天」不是保險，是必要的**：NIP-59 的 `jitteredPast()` 把 Gift Wrap 的**外層**
   * `created_at` 隨機往前推最多 `TIMESTAMP_JITTER_SECONDS`（2 天，隱私設計）。所以剛發出的
   * 訊息，其外層時戳可能落在兩天前——天真地用 `since = 上次連線時間` **會漏訊息**。
   *
   * 逐中繼追蹤（不同中繼的事件集合不同，共用全域水位會漏事件）。水位只在記憶體：session 內
   * 的重連走增量，App 重啟仍全量抓一次（重連遠比重啟頻繁，效益已大半取得，且不必動儲存層）。
   *
   * 註：這**不省 request**（一個 REQ 就是一個 request，回幾筆不影響），省的是 rows read／
   * DO duration／頻寬／啟動延遲——ADR-0107 讓收件箱翻倍後更有感。
   */
  private inboxSince(url: string | undefined): { since?: number } {
    const seen = url !== undefined ? this.inboxWatermark.get(url) : undefined;
    if (seen === undefined) return {}; // 沒水位（首次連上這座）→ 全量
    return { since: seen - TIMESTAMP_JITTER_SECONDS };
  }

  private resubscribeRelay(url: string): void {
    const client = this.relayPool.get(url);
    if (client) this.subscribeOn(client, url);
  }

  private resubscribe(): void {
    this.subscribeOn(this.client, this.originalHomeUrl);
    if (!this.connectorFor) return;
    // 引導座（錨點/清單，ADR-0039）與聯絡人 hint 的外部 relay 都連線並掛訂閱。
    for (const url of this.bootstrapSeats) if (url !== this.homeUrl) this.poolClient(url);
    // 搬家排水（ADR-0066 H3）：舊 home 也連線——subscribeOn 會掛自家收件匣，收訊走既有去重。
    if (this.drainUrl && this.drainUrl !== this.homeUrl) this.poolClient(this.drainUrl);
    for (const c of this.contacts) {
      const url = this.foreignUrlOf(c);
      if (url) this.poolClient(url);
    }
    for (const [url, client] of this.relayPool) this.subscribeOn(client, url);
  }

  /** 採用帶內收到的維護者 relay 清單（ADR-0039）：驗簽已在 onEvent 完成。 */
  private adoptRelayList(doc: RelayListDoc): void {
    if (!shouldAdoptList(this.lastList, doc)) return;
    this.lastList = doc;
    this.storage.saveBootstrapList(doc);
    let added = false;
    for (const r of doc.relays) {
      const norm = normalizeRelay(r);
      if (norm && norm !== this.homeUrl && !this.bootstrapSeats.has(norm)) {
        this.bootstrapSeats.add(norm);
        added = true;
      }
    }
    if (added && this.connectorFor) {
      this.resubscribe(); // 新引導座連線並掛收件箱訂閱
      this.emitRelayPool();
    }
    this.scheduleRetirementIfNeeded(); // 清單標我的 home 為 draining/retired → T3 撤離（ADR-0069）
  }

  /** 當前 WebRTC ICE 設定（ADR-0048）：強制 TURN 政策生效時只走 relay 候選。 */
  private rtcConfig(): RTCConfiguration | undefined {
    return buildRtcConfig(this.forceTurn, this.turnServers);
  }

  /**
   * 身分輪替遷移（ADR-0052）：對名冊宣告的每筆「舊 npub → 新 npub」，若本機原本認得舊
   * npub（聯絡人或群成員），把 1:1 歷史與群組成員資格接續到新 npub，並通知 UI「◯◯ 已更新
   * 金鑰」。回傳是否有任何遷移發生（供 adoptRoster 決定是否重載聯絡人）。
   */
  private applyRotations(doc: OrgRosterDoc): boolean {
    const self = this.self.pubkey;
    const groups = this.storage.loadGroups();
    let migrated = false;
    for (const { from, to } of rosterRemap(doc)) {
      if (from === self || to === self) continue;
      const known = this.contacts.some((c) => c.pubkey === from) || groups.some((g) => g.members.includes(from));
      if (!known) continue;
      this.storage.remapContact(from, to);
      this.statuses.delete(from);
      const name =
        doc.members.find((m) => m.pubkey === to)?.name ??
        doc.members.find((m) => m.pubkey === from)?.name ??
        to.slice(0, 8);
      this.handlers?.onIdentityRotated?.(from, to, name);
      migrated = true;
    }
    return migrated;
  }

  /**
   * 採用帶內收到的管理者組織名冊（ADR-0047）：驗簽已在 onEvent 完成。
   * 工作身分聯絡人由名冊**權威管理**——移除名冊外者（撤銷/離職）、匯入名冊成員。
   */
  private adoptRoster(doc: OrgRosterDoc): void {
    if (!shouldAdoptRoster(this.lastRoster, doc)) return;
    this.lastRoster = doc;
    if (doc.policy) this.handlers?.onPolicy?.(doc.policy); // 企業政策（ADR-0048）
    // 組織資訊（ADR-0157）：公司名稱/歡迎詞/班表＋在世成員（供下班靜音判定）。
    this.handlers?.onOrgInfo?.({
      org: doc.org,
      members: rosterAllowlist(doc),
      ...(doc.welcome ? { welcome: doc.welcome } : {}),
      ...(doc.workHours ? { workHours: doc.workHours } : {}),
    });
    this.forceTurn = doc.policy?.forceTurn === true; // 強制 TURN 生效於後續新建的 WebRTC 連線
    this.cloudBackupBlocked = doc.policy?.disableCloudBackup === true; // 禁止快照上雲（ADR-0071）
    const self = this.self.pubkey;
    // ADR-0052：先把本機認得的舊 npub 接續到新 npub（歷史/群資格遷移），再以在世成員對帳。
    let changed = this.applyRotations(doc);
    if (changed) this.contacts = this.storage.loadContacts();
    // 僅在世成員（排除已輪替的舊 npub）為權威通訊錄——舊 npub 於下方撤銷、新 npub 於下方匯入。
    const desired = doc.members.filter((m) => m.pubkey !== self && !m.supersededBy);
    const desiredKeys = new Set(desired.map((m) => m.pubkey));
    // 撤銷：移除名冊外的（非封鎖）聯絡人
    for (const c of this.contacts) {
      if (!desiredKeys.has(c.pubkey) && !this.isBlocked(c.pubkey)) {
        this.storage.removeContact(c.pubkey);
        this.statuses.delete(c.pubkey);
        changed = true;
      }
    }
    // 匯入：名冊成員（既有則略過；帶 relay hint）
    for (const m of desired) {
      if (this.isBlocked(m.pubkey) || this.contacts.some((c) => c.pubkey === m.pubkey)) continue;
      const hint = normalizeRelayUrl(m.relayUrl);
      this.storage.addContact({ pubkey: m.pubkey, name: m.name, ...(hint && hint !== this.homeUrl ? { relayUrl: hint } : {}) });
      changed = true;
    }
    if (changed) {
      this.contacts = this.storage.loadContacts();
      this.resubscribe();
      this.emitContacts();
    }
    this.reconcileOrgGroups(doc);
  }

  /**
   * 組織群組對帳（ADR-0049）：加入名冊中含自己的群、移除名冊外的組織群。
   * 只動 `org` 旗標標記的名冊群——管理者自建的臨時群（admin 亦等於自身）不受影響。
   */
  private reconcileOrgGroups(doc: OrgRosterDoc): void {
    const adminPk = this.orgAdminPubkey;
    if (!adminPk) return;
    const self = this.self.pubkey;
    const orgGroups = doc.groups ?? [];
    const desiredIds = new Set(orgGroups.filter((g) => g.members.includes(self)).map((g) => g.id));
    let changed = false;
    for (const g of this.storage.loadGroups()) {
      if (g.org && !desiredIds.has(g.id)) {
        this.storage.removeGroup(g.id);
        changed = true;
      }
    }
    for (const og of orgGroups) {
      if (!og.members.includes(self)) continue;
      this.storage.saveGroup({
        id: og.id,
        name: og.name,
        admin: adminPk,
        members: og.members,
        org: true,
        ...(og.announce ? { announce: true } : {}),
      });
      changed = true;
    }
    if (changed) {
      this.groups = this.storage.loadGroups();
      this.emitGroups();
    }
  }

  private beat(): void {
    // 隱身（ADR-0088 (d)）或離線：完全不廣播在線信標（對方靠 60s 判離線）。
    if (this.invisible || this.self.status === "offline") return;
    // (e) P2P 卸載：對已開資料通道的聯絡人，**完整**在線狀態（含 s/m/np）直送資料通道、不經 relay。
    // `hb` 自報節奏（ADR-0109）：閒置時每 5 分鐘一則；不帶節奏收端會用固定短窗誤判離線。
    const cadenceMs = this.beatInterval();
    let allP2P = this.contacts.length > 0;
    for (const c of this.contacts) {
      const sent = this.transfer.sendPresence(c.pubkey, {
        s: this.self.status,
        m: this.self.statusMessage,
        np: this.nowPlaying,
        hb: cadenceMs,
      });
      if (!sent) allP2P = false;
    }
    // 心跳抑制（ADR-0088 (e)）：所有聯絡人都有活的 P2P 通道時，不再經 relay 廣播。
    if (allP2P) return;
    // 🔴 ADR-0129：relay 心跳降為**無內容存活信標**——只證明「我在線」＋節奏（`hb`），
    // **不再帶 s/m/np**。狀態內容改走封裝（見 broadcastPresenceState），relay 再也讀不到你的
    // 自訂狀態文字與正在聽的音樂。節奏本來就能從時戳觀察，明寫不構成新的元資料洩漏。
    const beacon = createHeartbeat(this.sk, { cadenceMs });
    // 信標發到 pool 中所有 relay：對方未記錄我的 relay 也看得到我在線（ADR-0034）。
    this.client.publish(beacon);
    for (const client of this.relayPool.values()) client.publish(beacon);
  }

  /**
   * 送出當下在線狀態給某聯絡人（ADR-0129）：有 P2P 走資料通道，否則**封裝**走 relay
   *（僅在對方在線時——ephemeral 到不了離線的人，白費且多洩漏一則）。供「對方剛上線」的補送用。
   */
  private sendPresenceState(pubkey: PubkeyHex): void {
    if (this.invisible || this.self.status === "offline") return;
    const state = { s: this.self.status as PresenceState, m: this.self.statusMessage, np: this.nowPlaying, hb: this.beatInterval() };
    if (this.transfer.sendPresence(pubkey, state)) return; // P2P 直送
    if (this.presence.statusOf(pubkey, Date.now()) !== "online") return;
    this.publishAddressed(wrapPresenceState(state, this.sk, pubkey));
  }

  /**
   * 狀態改變時（ADR-0129）：把新狀態**封裝**送給每位「在線 ✕ 無 P2P」的聯絡人。
   *
   * P2P 的聯絡人由 `beat()` 的資料通道直送、離線的收不到 ephemeral——所以這裡只補「在線但沒 P2P」
   * 這個小集合。改變稀疏 ＋ 集合小 → 封裝的發佈量遠小於「每 60 秒 × 全部聯絡人」（否則會炸穿免費層）。
   */
  private broadcastPresenceState(): void {
    if (this.invisible || this.self.status === "offline") return;
    const state = { s: this.self.status as PresenceState, m: this.self.statusMessage, np: this.nowPlaying, hb: this.beatInterval() };
    for (const c of this.contacts) {
      if (this.transfer.hasOpenChannel(c.pubkey)) continue; // P2P 由 beat 直送
      if (this.presence.statusOf(c.pubkey, Date.now()) !== "online") continue; // 離線的收不到
      this.publishAddressed(wrapPresenceState(state, this.sk, c.pubkey));
    }
  }

  /**
   * 觀察到某人的在線信號（心跳信標 **或** 封裝狀態，ADR-0129）——共用「補送＋喚醒握手」。
   *
   * **兩個接收路徑都要走這裡**：我的補送（catch-up）會讓封裝 PRESENCE 比信標**先到**，若只在
   * 心跳路徑做喚醒，對方的 PRESENCE 先到就會把他提前標成在線，導致我收到他信標時 `wasIdle`
   * 已是 false、喚醒被抑制（實測踩過）。所以誰先到都在這裡觸發。
   *
   * `wasIdle`（全域：本來沒人在線）與 `wasOnline`（這位先前是否在線）都在 `observe` **之前**判。
   */
  private observeContactPresence(pubkey: PubkeyHex, observedAtSec: number, cadenceMs: number | undefined): void {
    const wasIdle = !this.anyContactOnline();
    const wasOnline = this.presence.statusOf(pubkey, Date.now()) === "online";
    this.presence.observe(pubkey, observedAtSec, cadenceMs);
    // 對方剛上線（離線→上線）→ 把我當下的狀態封裝補送給他（否則他只看得到我在線、卻沒有我的
    // 狀態文字/音樂——那些只在改變時發、他錯過了）。只補給聯絡人。一輪即止（第二次 observe 後
    // wasOnline 為真，不再回補）。
    if (!wasOnline && this.isContact(pubkey)) this.sendPresenceState(pubkey);
    // 喚醒握手（ADR-0109）：有人上線 → 立刻補發信標並切回 ACTIVE，讓對方一個 RTT 內看到我。
    // **只在 IDLE→ACTIVE 轉換時**——否則兩端互相觸發成風暴。
    if (wasIdle && this.anyContactOnline()) {
      this.beat();
      this.scheduleBeat();
    }
  }

  /** 是否有任一聯絡人在線（決定心跳快慢，ADR-0109）。 */
  private anyContactOnline(): boolean {
    const now = Date.now();
    return this.contacts.some((c) => this.presence.statusOf(c.pubkey, now) === "online");
  }

  /**
   * 目前的心跳節奏（ADR-0109）：有人在線 → 60 秒；沒人在線 → 5 分鐘。
   *
   * 閒置時的心跳是在**對空氣廣播**——這是中繼 request 的 92%，也是本專案免費額度的天花板。
   */
  private beatInterval(): number {
    return this.anyContactOnline() ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_IDLE_MS;
  }

  /**
   * 以抖動間隔自我重排下一次心跳（F5：分散中繼負載）。
   * 節奏每次重新計算（ADR-0109）：有人在線 60 秒、沒人在線 5 分鐘。
   *
   * **必須先清掉既有計時器**——IDLE→ACTIVE 轉換時會重新呼叫本函式，若不清除，
   * 原本的閒置計時器會與新的快速計時器**並存**，變成兩條心跳鏈（成本不減反增）。
   */
  private scheduleBeat(): void {
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.beat();
      this.scheduleBeat();
    }, jitter(this.beatInterval()));
  }

  /** 跨 relay 事件去重：已見過回傳 true；容量超限折半清理（保留較新）。 */
  private seenBefore(id: string): boolean {
    if (this.seenEvt.has(id)) return true;
    this.seenEvt.add(id); // BoundedSet 自行修剪
    return false;
  }

  private onEvent(event: NostrEvent, url?: string): void {
    // 收件箱水位（ADR-0109 S4）：記錄**這座中繼**送過的最大外層 created_at，供下次重連做增量。
    // 刻意在去重之前更新——即使這顆事件已從別座中繼收過，它確實存在於**這座**中繼上，
    // 水位仍應前進（否則對這座中繼永遠抓全量）。
    if (url !== undefined && event.kind === KIND.OFFLINE_DM_GIFT_WRAP) {
      const prev = this.inboxWatermark.get(url) ?? 0;
      if (event.created_at > prev) this.inboxWatermark.set(url, event.created_at);
    }
    if (this.seenBefore(event.id)) return;
    if (event.kind === SNAPSHOT_KIND) {
      this.receiveSnapshot(event); // 加密雲端快照（ADR-0071 J3）
      return;
    }
    if (event.kind === RELAY_LIST_KIND) {
      if (this.maintainerPubkey) {
        const doc = verifyRelayList(event, this.maintainerPubkey);
        if (doc) this.adoptRelayList(doc);
      }
      return;
    }
    if (event.kind === KIND.FILE_WRAP) {
      this.receiveFileChunk(event); // ADR-0162：組織檔案分塊
      return;
    }
    if (event.kind === ORG_ROSTER_KIND) {
      if (this.orgAdminPubkey) {
        const doc = verifyOrgRoster(event, this.orgAdminPubkey);
        if (doc) this.adoptRoster(doc);
      } else if (this.orgOwnerFlag && event.pubkey === this.self.pubkey) {
        // ADR-0156：企業主找回自己簽章的名冊（重啟後 lastRoster 失憶的解方）。
        // 只記狀態，不走 adoptRoster 的通訊錄對帳（管理者的聯絡人不受名冊管理）。
        const doc = verifyOrgRoster(event, this.self.pubkey);
        if (doc && shouldAdoptRoster(this.lastRoster, doc)) {
          this.lastRoster = doc;
          // 名冊到位 → 清掉排隊中的入職請求（逐一核准併入）。
          if (this.pendingJoins.size > 0) {
            const queued = [...this.pendingJoins];
            this.pendingJoins.clear();
            for (const [pk, name] of queued) this.approveJoin(pk, name);
          }
        }
      }
      return;
    }
    switch (event.kind) {
      case KIND.HEARTBEAT: {
        // 🔴 ADR-0129：心跳現在是**無內容存活信標**，不再帶 s/m/np（那些改走封裝的 PRESENCE 事件）。
        // 舊版客戶端仍可能在 content 帶狀態 → 有內容就沿用（過渡相容），無內容就只更新在線與否。
        if (event.content) this.statuses.set(event.pubkey, decodePresence(event.content));
        this.observeContactPresence(event.pubkey, event.created_at, heartbeatCadenceMs(event));
        return;
      }
      case PRESENCE_SIGNAL_KIND: {
        // 封裝的在線狀態（ADR-0129）：解出真實寄件人與 {s,m,np}。只採用**聯絡人**的
        //（陌生人不得往你的介面注入在線狀態，比照 ADR-0121）。
        let opened;
        try {
          opened = readPresenceState(event, this.sk);
        } catch {
          return;
        }
        if (!this.isContact(opened.sender)) return;
        this.statuses.set(opened.sender, { s: opened.state.s, m: opened.state.m, np: opened.state.np });
        // 外層 created_at 被 jitter（不可用），以本機時間觀察在線；自報節奏供容忍窗。
        this.observeContactPresence(opened.sender, Math.floor(Date.now() / 1000), opened.state.hb);
        this.emitContacts();
        return;
      }
      case KIND.TYPING: {
        const sender = this.senderOfSealed(event, readTyping);
        if (sender) this.handlers?.onTyping(sender);
        return;
      }
      case KIND.NUDGE: {
        const sender = this.senderOfSealed(event, readNudge);
        if (sender) this.handlers?.onNudge(sender);
        return;
      }
      case KIND.OFFLINE_DM_GIFT_WRAP:
        this.receiveDm(event);
        return;
      case CALL_SIGNAL_KIND:
        this.call.onCallSignalEvent(event);
        return;
      case SDP_SIGNAL_KIND:
        this.transfer.onSignalEvent(event);
        return;
    }
  }

  /**
   * 解出封裝 ephemeral 事件（typing / nudge）的**真實寄件人**，並把關（ADR-0120）。
   *
   * ## 🔴 這裡的把關比封裝本身更容易被漏掉
   *
   * 封裝之後訂閱過濾器不能再帶 `authors`（外層作者是臨時金鑰）。而**過去正是那個
   * `authors: [聯絡人們]` 在擋陌生人**——拿掉它以後，任何人都能對你發 nudge，
   * 而 nudge 會**震動裝置、跳通知**。那是現成的騷擾管道。
   *
   * 漏掉這道把關不會有任何錯誤訊息，只是變得可被騷擾——所以有測試釘住。
   *
   * `read` 失敗＝舊版明文格式（未封裝）。**只收不發**（ADR-0120 決策 5）：收下不會讓自己
   * 洩漏任何東西，只是讓還沒更新的對方能繼續顯示打字狀態。所有客戶端更新後即可移除此退路。
   */
  private senderOfSealed(
    event: NostrEvent,
    read: (e: NostrEvent, sk: SecretKey) => PubkeyHex,
  ): PubkeyHex | undefined {
    let sender: PubkeyHex;
    try {
      sender = read(event, this.sk);
    } catch {
      sender = event.pubkey; // 過渡：舊版明文格式
    }
    if (this.isBlocked(sender)) return undefined;
    if (!this.contacts.some((c) => c.pubkey === sender)) return undefined; // 陌生人不得觸發 typing/nudge
    return sender;
  }

  private receiveDm(event: NostrEvent): void {
    let opened;
    try {
      opened = unwrapMessage(event, this.sk);
    } catch {
      return;
    }
    const { sender, rumor } = opened;

    // 以 **rumor.id** 去重（ADR-0107），不是外層 wrap id：給對方的那份與自封副本是兩顆
    // 不同的 wrap，但內層 rumor 相同。發送裝置送出時已把 rumor.id 記進 seenMsg，
    // 自己的自封副本回流時便在此自然丟棄——無需特例。
    // （同一顆外層事件的跨中繼重複，已由 onEvent 的 seenEvt 擋掉。）
    if (this.seenMsg.has(rumor.id)) return;
    this.seenMsg.add(rumor.id);

    /** 自封副本：這是**我自己**發出的訊息，經中繼回到我的另一台裝置（ADR-0107）。 */
    const selfCopy = sender === this.self.pubkey;
    if (!selfCopy && this.isBlocked(sender)) return;

    // 群組路由僅限「群訊/群控」——群組**回條**也帶 `g` tag（ADR-0095），必須落到下方回條處理，
    // 不能被這裡吞掉（否則發訊者永遠收不到群組送達/已讀）。
    const groupId = groupTarget(rumor);
    if (groupId && (rumor.kind === KIND.CHAT || rumor.kind === KIND.GROUP_CONTROL)) {
      this.receiveGroup(sender, rumor, groupId);
      return;
    }

    // 自封副本的「對話」是**收件人**（rumor 內層 `to` tag），不是寄件人（寄件人就是我自己）。
    // 絕不可 ensureContact(自己)——那會在聯絡人清單裡生出一個「我」。
    //
    // `convo` 可能為 null：回應／收回／回條以 `e` tag 指定目標訊息，與對話無關，故不帶 `to`。
    // 它們必須在下方**先**處理完；只有真正要建立訊息的分支（檔案/文字）才強制要有 convo。
    const convo = selfCopy ? selfCopyTarget(rumor) : sender;
    // 自封副本＝**我**發給某人的訊息回到我的另一台裝置 → 那個人是我主動聯絡的 → 真聯絡人。
    // 別人發來的 → 走 `ensureKnown()`：不認識就進「訊息請求」，不是聯絡人清單（ADR-0121）。
    if (convo) {
      if (selfCopy) this.ensureContact(convo);
      else this.ensureKnown(convo);
    }
    if (!selfCopy) this.learnRelayHint(sender, rumor);

    if (rumor.kind === KIND.REACTION) {
      const target = reactionTarget(rumor);
      if (!target) return;
      // 自封副本＝我自己按的回應（在另一台裝置上按的）→ mine。
      this.storage.addReaction({ id: rumor.id, messageId: target, emoji: rumor.content, mine: selfCopy });
      this.handlers?.onReaction?.(target, rumor.content, selfCopy);
      return;
    }

    if (rumor.kind === KIND.DELETE) {
      const target = deletionTarget(rumor);
      if (!target) return;
      this.storage.markDeleted(target);
      this.handlers?.onUnsend?.(target);
      return;
    }

    const receipt = receiptOf(rumor);
    if (receipt) {
      // ADR-0058：標記自己訊息的送達/已讀；帶 groupId 者為群組回條（ADR-0095）。
      this.applyReceipt(sender, receipt.messageId, receipt.type, receipt.groupId);
      return;
    }

    const profile = parseProfile(rumor);
    if (profile) {
      // ADR-0061：以對方自選暱稱更新顯示名稱（僅在變動時）。
      // **請求區的人也算**（ADR-0121）：否則請求清單只看得到 `npub1abc…`，使用者無從判斷；
      // 而且 `acceptRequest()` 會把那個陳舊的縮寫帶進聯絡人。
      const known =
        this.contacts.find((c) => c.pubkey === sender) ?? this.requests.find((r) => r.pubkey === sender);
      if (known) {
        let changed = false;
        if (profile.name && profile.name !== known.name) {
          this.storage.updateContactName(sender, profile.name);
          changed = true;
        }
        // ADR-0154：對方廣播的頭像。""＝移除記號 → 清掉；缺席＝無變更（不清不改）。
        const incoming = profile.avatar === "" ? undefined : profile.avatar;
        if (profile.avatar !== undefined && incoming !== known.avatar) {
          this.storage.updateContactAvatar(sender, incoming);
          changed = true;
        }
        // ADR-0158：對方廣播的企業頭銜（同 avatar 語意）。
        const incomingTitle = profile.title === "" ? undefined : profile.title;
        if (profile.title !== undefined && incomingTitle !== known.title) {
          this.storage.updateContactTitle(sender, incomingTitle);
          changed = true;
        }
        if (changed) {
          this.contacts = this.storage.loadContacts();
          this.requests = this.storage.loadRequests();
          this.emitContacts();
          this.emitRequests();
        }
      }
      // 尚未送過自己的個人檔給對方（例如對方單向加我）→ 回送一次，讓對方也學到我的暱稱。
      // **但只回給真正的聯絡人**（ADR-0121）：對還在請求區的陌生人回送，等於向他確認
      // 「這把金鑰是活的、有人在線上」——那是垃圾訊息發送者最想要的回饋。
      if (this.isContact(sender) && !this.profileSentTo.has(sender)) this.sendProfileTo(sender);
      return;
    }

    const orgJoin = parseOrgJoin(rumor);
    if (orgJoin) {
      // ADR-0156：入職請求——只有企業主身分、且權杖相符才處理（自動核准）。
      this.handleOrgJoin(sender, orgJoin);
      return;
    }

    // 以下分支要建立訊息 → 必須知道歸屬哪個對話。
    // 自封副本卻無 `to` 標記＝舊格式或損壞，無從歸檔（ADR-0107）。
    if (!convo) return;

    const fileMeta = parseFileMeta(rumor);
    if (fileMeta) {
      // 儲存槽存放（ADR-0161／審查修正）：改由 P2P file-begin 幀直接攜帶 `origin`，
      // 不再走 relay metadata——舊格式若殘留帶 slot 的 metadata 一律忽略、不建訊息。
      if (fileMeta.slot !== undefined) return;
      // 檔案 metadata（ADR-0093）：讓收件人**所有裝置**都知道有檔案；位元組另走 P2P。
      // 以 tid 去重（位元組可能已先到並建了訊息）；仍回送已送達回條讓 sender 有投遞可見度（G3）。
      // 自封副本 → 我的另一台裝置：看得到 metadata，但**沒有位元組、也沒有縮圖**
      //（位元組只走 P2P 到對方；縮圖是本機產物）——ADR-0093/0107 的刻意取捨。
      if (!this.fileMsgByTid.has(fileMeta.tid)) {
        this.ensureFileMessage(convo, fileMeta, {
          msgId: rumor.id,
          outgoing: selfCopy,
          sent: 0,
          at: msgTime(rumor), // ADR-0108
          ...(selfCopy ? { status: "sent" as const } : {}),
        });
        if (selfCopy) this.applyPendingReceipts(rumor.id);
        if (!selfCopy) this.bumpUnread(convo, msgTime(rumor)); // O(1)（ADR-0110）
      }
      if (!selfCopy) this.publishReliable(wrapReceipt("delivered", this.sk, sender, rumor.id));
      return;
    }

    const expirySec = messageExpiry(rumor);
    const expiresAt = expirySec !== undefined ? expirySec * 1000 : undefined;
    const replyTo = threadRoot(rumor); // 對話串回覆（ADR-0051）
    const extra = {
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    };
    // 自封副本＝我在另一台裝置發的訊息 → outgoing，狀態 `sent`（它確實已進中繼）。
    // 之後對方的回條本來就定址給我 → **我的每一台裝置都收得到** → 狀態自動收斂為送達/已讀。
    const status = selfCopy ? ("sent" as const) : undefined;
    const message = {
      id: rumor.id,
      contact: convo,
      outgoing: selfCopy,
      text: rumor.content,
      at: msgTime(rumor), // ADR-0108：送出時間，非下載時間
      ...(status ? { status } : {}),
      ...extra,
    };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(convo, {
      id: rumor.id,
      outgoing: selfCopy,
      text: rumor.content,
      at: message.at,
      ...(status ? { status } : {}),
      ...extra,
    });
    if (!selfCopy) this.bumpUnread(convo, message.at); // 未讀 +1（O(1)，ADR-0110）
    if (selfCopy) {
      this.applyPendingReceipts(rumor.id); // 回條若比自封副本先到，在此補套用（ADR-0107）
      return; // 不對自己回送已送達回條
    }
    this.publishReliable(wrapReceipt("delivered", this.sk, sender, rumor.id)); // ADR-0058 Tier 2：已送達回條
  }

  /**
   * 暫存一筆「早到的回條」（ADR-0107）：目標訊息尚未抵達本機（自封副本還在路上）。
   * 有界（Map 保序 → 逐出最舊）：對永不抵達的目標（例如超過 7 天 TTL、或惡意灌入）不無限成長。
   */
  private deferReceipt(messageId: string, from: PubkeyHex, type: ReceiptType, groupId?: string): void {
    const queue = this.pendingReceipts.get(messageId) ?? [];
    queue.push({ from, type, ...(groupId ? { groupId } : {}) });
    this.pendingReceipts.set(messageId, queue);
    while (this.pendingReceipts.size > 1024) {
      const oldest = this.pendingReceipts.keys().next().value;
      if (oldest === undefined) break;
      this.pendingReceipts.delete(oldest);
    }
  }

  /**
   * 緩存一則指向未知群組的訊息（ADR-0131）——群組實例化後由 {@link drainPendingGroup} 重放。
   *
   * 有界（每群 64、總群 32，FIFO 逐出）＋以 rumor.id 去重（跨中繼重複不重複緩存，避免重放時
   * `bumpUnread` 重複計數）。惡意假 `g` tag 只會佔一小段有界記憶體後被逐出，**從不重放、從不入庫**。
   */
  private deferGroupMsg(groupId: string, sender: PubkeyHex, rumor: Rumor): void {
    const queue = this.pendingGroupMsgs.get(groupId) ?? [];
    if (queue.some((m) => m.rumor.id === rumor.id)) return; // 去重
    queue.push({ sender, rumor });
    while (queue.length > MAX_PENDING_PER_GROUP) queue.shift();
    this.pendingGroupMsgs.set(groupId, queue);
    while (this.pendingGroupMsgs.size > MAX_PENDING_GROUPS) {
      const oldest = this.pendingGroupMsgs.keys().next().value;
      if (oldest === undefined) break;
      this.pendingGroupMsgs.delete(oldest);
    }
  }

  /** 群組實例化後（ADR-0131）：把早到、緩存的群訊依送出時間重放；先刪緩存避免重放時又 defer 回去。 */
  private drainPendingGroup(groupId: string): void {
    const queue = this.pendingGroupMsgs.get(groupId);
    if (!queue) return;
    this.pendingGroupMsgs.delete(groupId);
    for (const m of [...queue].sort((a, b) => msgTime(a.rumor) - msgTime(b.rumor))) {
      this.receiveGroup(m.sender, m.rumor, groupId);
    }
  }

  /** 重放先前暫存的「早到回條」（ADR-0107）：自封副本抵達後，才有訊息可標。 */
  private applyPendingReceipts(messageId: string): void {
    const queue = this.pendingReceipts.get(messageId);
    if (!queue) return;
    this.pendingReceipts.delete(messageId); // 先刪再放，避免重放時又被 defer 回去
    for (const r of queue) this.applyReceipt(r.from, messageId, r.type, r.groupId);
  }

  /** 處理帶 `g` tag 的群組訊息/控制。訊息識別用 rumor.id（跨成員一致，ADR-0095）。 */
  private receiveGroup(sender: PubkeyHex, rumor: Rumor, groupId: string): void {
    this.learnRelayHint(sender, rumor); // 僅更新既有聯絡人；陌生成員不會被灌入（ADR-0036）
    if (rumor.kind === KIND.GROUP_CONTROL) {
      const control = parseGroupControl(rumor);
      if (control) this.applyControl(sender, control);
      return;
    }
    if (rumor.kind !== KIND.CHAT) return;
    if (this.isBlocked(sender)) return;
    const g = this.groups.find((gr) => gr.id === groupId);
    if (!g) {
      // 🔴 未知群組（尚未被加入）→ **緩存**，待 group-create/snapshot 實例化後重放（ADR-0131）。
      // NIP-59 jitter 讓群訊可能比 group-create **先到**——舊版直接丟棄＝一被加進群就漏掉開頭幾則。
      this.deferGroupMsg(groupId, sender, rumor);
      return;
    }
    if (!canPostToGroup(g, sender)) return; // 非成員/公告群非管理者不得發訊（ADR-0049）
    // 群組檔案（ADR-0124）：kind CHAT ＋ `g` tag ＋ `file` tag。位元組另走 P2P；
    // 這則 metadata 只是讓每位成員（的每一台裝置）都知道「有這個檔案」——與 1:1 同一套。
    const fileMeta = parseFileMeta(rumor);
    if (fileMeta) {
      const selfCopyFile = sender === this.self.pubkey;
      this.ensureFileMessage(groupId, fileMeta, {
        msgId: rumor.id,
        outgoing: selfCopyFile,
        sent: 0,
        at: msgTime(rumor), // ADR-0108：送出時間，非下載時間
        sender,
        ...(selfCopyFile ? { status: "sent" as const } : {}),
      });
      return;
    }

    const expirySec = messageExpiry(rumor);
    const expiresAt = expirySec !== undefined ? expirySec * 1000 : undefined;
    const mine = isMentioned(rumor, this.self.pubkey); // @提及我（ADR-0050）
    const replyTo = threadRoot(rumor); // 對話串回覆（ADR-0051）
    const extra = {
      sender,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(mine ? { mentionsMe: true } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    };
    // 群訊識別用**內層 rumor.id**（跨成員一致、openWrap 已驗雜湊）；外層 wrap id 每人不同，
    // 拿來當 id 會讓回條/引用對不回發訊者（ADR-0095 修正；`eventId` 僅用於 wrap 去重）。
    const id = rumor.id;
    // 自封副本＝我在另一台裝置發的群訊（ADR-0107）：群訊原本只扇出給**其他**成員，
    // 於是自己的另一台裝置看不到自己發的群訊。標為 outgoing/`sent`，且不對自己回條。
    const selfCopy = sender === this.self.pubkey;
    const status = selfCopy ? ("sent" as const) : undefined;
    const body = {
      id,
      outgoing: selfCopy,
      text: rumor.content,
      at: msgTime(rumor), // ADR-0108：送出時間，非下載時間
      ...(status ? { status } : {}),
      ...extra,
    };
    this.storage.appendMessage({ ...body, contact: groupId });
    this.handlers?.onMessage(groupId, body);
    if (!selfCopy) this.bumpUnread(groupId, body.at); // 未讀 +1（O(1)，ADR-0110）
    if (selfCopy) {
      this.applyPendingReceipts(id); // 其他成員的回條可能比自封副本先到
      return;
    }
    // 分級送達回條（ADR-0095）：小群（≤GROUP_RECEIPT_COUNT_MAX）才回；大群完全不記（零額外流量）。
    if (groupReceiptMode(g.members.length) !== "off") {
      this.publishReliable(wrapReceipt("delivered", this.sk, sender, id, { groupId }));
    }
  }

  private applyControl(from: PubkeyHex, control: GroupControl): void {
    const exists = this.groups.some((g) => g.id === control.id);
    if ((control.type === "group-create" || control.type === "group-snapshot") && !exists) {
      // 授權/同意檢查：封鎖者不得拉你入群；你不在名單就不加入。
      // 快照對白紙裝置＝實例化（ADR-0068 換機自癒），守門同 create。
      if (this.isBlocked(from)) return;
      if (!control.members.includes(this.self.pubkey)) return;
      // 管理者強制為驗證後的寄件人（不信任 payload 的 admin 欄位）；
      // 不自動把其他成員塞進個人聯絡人（避免被強行灌入聯絡人清單）。
      this.storage.saveGroup({ id: control.id, name: control.name, admin: from, members: control.members });
      this.groups = this.storage.loadGroups();
      this.emitGroups();
      this.drainPendingGroup(control.id); // ADR-0131：重放在 group-create 之前先到的群訊
      return;
    }
    if (control.type === "group-create") return; // 已存在：不重複建立（對帳走快照）
    const g = this.groups.find((gr) => gr.id === control.id);
    if (!g) return;
    const updated = applyGroupControl(g, control, from);
    if (!updated.members.includes(this.self.pubkey)) this.storage.removeGroup(g.id);
    else this.storage.saveGroup(updated);
    this.groups = this.storage.loadGroups();
    this.emitGroups();
  }

  private emitGroups(): void {
    this.handlers?.onGroups?.(this.groups.map((g) => ({ ...g, members: [...g.members] })));
  }

  private isBlocked(pubkey: PubkeyHex): boolean {
    return this.blocked.some((b) => b.pubkey === pubkey);
  }

  /** 從解密後的 rumor 學習寄件人的 relay hint（ADR-0035）；變動時更新並重掛訂閱。 */
  private learnRelayHint(sender: PubkeyHex, rumor: Rumor): void {
    const url = normalizeRelayUrl(relayHintOf(rumor));
    if (url === undefined) return; // 無 hint 或非法：不動現有值
    // 與自己 home 相同時存為「無 hint」（路由等價）。
    const next = url !== this.homeUrl ? url : undefined;
    // **請求區的人也要學 hint**（ADR-0121）：他們是「還沒接受的陌生人」，但你一旦按下接受，
    // 回信就得直達他所在的中繼。這個 hint 只在 rumor（已解密的內層）裡，錯過就沒有第二次。
    const known = this.contacts.find((c) => c.pubkey === sender) ?? this.requests.find((r) => r.pubkey === sender);
    if (!known || known.relayUrl === next) return;
    this.storage.updateContactRelay(sender, next);
    this.contacts = this.storage.loadContacts();
    this.requests = this.storage.loadRequests();
    this.resubscribe();
  }

  private isContact(pubkey: PubkeyHex): boolean {
    return this.contacts.some((c) => c.pubkey === pubkey);
  }

  /**
   * 有人從外部聯絡我（訊息、傳檔）——**不認識就進「訊息請求」，不是聯絡人清單**（ADR-0121）。
   *
   * 過去這裡直接 `ensureContact()`：任何知道你 npub 的人傳一則訊息，就**自動成為你的聯絡人**
   * ——會跳通知、能 nudge 你（震動）、能看到你的上線狀態。沒有任何確認步驟，因為
   * 「好友請求」這個概念在專案裡根本不存在。
   *
   * 現在他停在請求區：**不跳通知、不能 nudge、不訂閱他的上線狀態、不回送我的個人檔**。
   * 訊息照收（Nostr 上擋不掉——中繼一定會轉發指名你的 1059），但由你決定要不要理他。
   */
  private ensureKnown(pubkey: PubkeyHex): void {
    if (this.isBlocked(pubkey) || this.isContact(pubkey)) return;
    if (this.requests.some((r) => r.pubkey === pubkey)) return;
    this.storage.addRequest({ pubkey, name: shortNpub(npubEncode(pubkey)) });
    this.requests = this.storage.loadRequests();
    // 防洪（ADR-0127）：超過上限 → FIFO 逐出最舊的請求，連同其訊息與封存一起清
    //（走 declineRequest 的同一條清理路徑）。否則陌生人可用大量 pubkey 把請求區與儲存撐爆。
    while (this.requests.length > MAX_REQUESTS) {
      const oldest = this.requests[0];
      if (!oldest) break;
      this.storage.removeRequest(oldest.pubkey);
      this.storage.removeContact(oldest.pubkey); // 清訊息／封存
      this.requests = this.storage.loadRequests();
    }
    this.emitRequests();
  }

  /** 接受訊息請求（ADR-0121）：請求 → 聯絡人。此後才會通知、才收得到 nudge、才看得到上線狀態。 */
  acceptRequest(pubkey: PubkeyHex): void {
    const req = this.requests.find((r) => r.pubkey === pubkey);
    if (!req || this.isBlocked(pubkey)) return;
    this.storage.removeRequest(pubkey);
    // 把請求期間學到的 relay hint（ADR-0035）一起帶過來——否則回信只會走 home relay。
    this.storage.addContact({ pubkey, name: req.name, ...(req.relayUrl ? { relayUrl: req.relayUrl } : {}) });
    this.requests = this.storage.loadRequests();
    this.contacts = this.storage.loadContacts();
    this.resubscribe(); // 現在才訂閱他的上線心跳
    this.recountUnread(pubkey); // 接受後未讀才算數（請求期間刻意不點亮徽章）
    this.emitRequests();
    this.emitContacts();
    this.sendProfileTo(pubkey); // ADR-0061：接受了才把自己的暱稱給他
  }

  /** 刪除訊息請求（ADR-0121）：連同他傳來的訊息一起清掉。不封鎖——他還能再傳一次。 */
  declineRequest(pubkey: PubkeyHex): void {
    this.storage.removeRequest(pubkey);
    this.storage.removeContact(pubkey); // 不是聯絡人 → 這裡的作用是**清掉他的訊息與封存**
    this.requests = this.storage.loadRequests();
    this.emitRequests();
  }

  /** 全部刪除訊息請求（ADR-0127 防洪）：被灌爆時一次清空，連同所有訊息／封存。不封鎖。 */
  clearRequests(): void {
    for (const r of this.requests) {
      this.storage.removeRequest(r.pubkey);
      this.storage.removeContact(r.pubkey);
    }
    this.requests = this.storage.loadRequests();
    this.emitRequests();
  }

  private emitRequests(): void {
    this.handlers?.onRequests?.(this.requests.map((r) => ({ pubkey: r.pubkey, name: r.name })));
  }

  private ensureContact(pubkey: PubkeyHex): void {
    if (this.isBlocked(pubkey)) return;
    if (this.contacts.some((c) => c.pubkey === pubkey)) return;
    const contact = { pubkey, name: shortNpub(npubEncode(pubkey)) };
    this.storage.addContact(contact);
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
  }

  /** 以 `npub…` 或 `npub…@wss://…`（亦可空白分隔）新增聯絡人；hint 供多中繼路由。 */
  addContact(input: string, relayUrl?: string): void {
    const [rawNpub, inlineHint] = input.trim().split(/[@\s]+/, 2);
    const pubkey = npubDecode((rawNpub ?? "").trim());
    // 自我防呆（ADR-0055）：不得加自己作用中身分（跨身分連結風險；App 層另擋其他自身身分）。
    if (pubkey === this.self.pubkey || this.isBlocked(pubkey) || this.contacts.some((c) => c.pubkey === pubkey)) return;
    const hint = normalizeRelayUrl(relayUrl ?? inlineHint);
    this.storage.addContact({
      pubkey,
      name: shortNpub((rawNpub ?? "").trim()),
      ...(hint && hint !== this.homeUrl ? { relayUrl: hint } : {}),
    });
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
    this.sendProfileTo(pubkey); // ADR-0061：加好友時把自己的顯示名稱送給對方
  }

  removeContact(pubkey: PubkeyHex): void {
    this.storage.removeContact(pubkey);
    this.statuses.delete(pubkey); // 釋放狀態快取，避免殘留
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
  }

  /**
   * 設定/清除聯絡人本地暱稱（ADR-0148）：只寫本機儲存並重發聯絡人清單——**不廣播、不送對方/中繼站**。
   * 空字串或 undefined＝清除，退回廣播名。
   */
  setContactAlias(pubkey: PubkeyHex, alias: string | undefined): void {
    this.storage.setContactAlias(pubkey, alias);
    this.contacts = this.storage.loadContacts();
    this.emitContacts();
  }

  /**
   * 設定/清除依聯絡人通知音效（ADR-0149）：只寫本機儲存並重發聯絡人清單——**不廣播、不送對方/中繼站**。
   * 空/undefined＝清除，播放退回全域預設。
   */
  setContactNotifySound(pubkey: PubkeyHex, soundId: string | undefined): void {
    this.storage.setContactNotifySound(pubkey, soundId);
    this.contacts = this.storage.loadContacts();
    this.emitContacts();
  }

  /**
   * 設定/移除自己的廣播頭像（ADR-0154）：落地本機 → 比照改名（ADR-0144）清掉「已送過」
   * 記號全量重播。移除持久化為 `""`（繼續廣播移除記號，晚上線的聯絡人也會清掉舊圖）。
   * 格式不合（非白名單 data URI 或超長）回 false 不套用——縮圖產生端壞掉時的最後防線。
   */
  setSelfAvatar(avatar: string | undefined): boolean {
    const next = avatar || ""; // undefined/"" 統一為移除記號
    if (next !== "" && !validAvatarDataUri(next)) return false;
    if (next === this.myAvatar) return true; // 無變更不重播
    this.myAvatar = next;
    this.storage.saveSelfAvatar(next);
    this.profileSentTo.clear();
    this.broadcastProfile();
    return true;
  }

  /** 自己目前的廣播頭像（ADR-0154）；未設定或已移除回 undefined。 */
  selfAvatar(): string | undefined {
    return this.myAvatar || undefined;
  }

  /**
   * 設定/移除自己的企業頭銜（ADR-0158）：清洗（收斂空白/截斷 24 字）→ 落地 →
   * 比照改名清 profileSentTo 全量重播。空/undefined＝移除（持久化 "" 持續廣播移除記號）。
   */
  setSelfTitle(title: string | undefined): void {
    const next = title ? sanitizeTitle(title) : "";
    if (next === this.myTitle) return; // 無變更不重播
    this.myTitle = next;
    this.storage.saveSelfTitle(next);
    this.profileSentTo.clear();
    this.broadcastProfile();
  }

  /** 自己目前的企業頭銜（ADR-0158）；未設定或已移除回 undefined。 */
  selfTitle(): string | undefined {
    return this.myTitle || undefined;
  }

  blockContact(pubkey: PubkeyHex): void {
    const existing =
      this.contacts.find((c) => c.pubkey === pubkey) ?? this.requests.find((r) => r.pubkey === pubkey);
    const name = existing?.name ?? shortNpub(npubEncode(pubkey));
    this.storage.blockContact({ pubkey, name }); // 也會清掉請求（ADR-0121）
    this.statuses.delete(pubkey);
    this.blocked = this.storage.loadBlocked();
    this.contacts = this.storage.loadContacts();
    this.requests = this.storage.loadRequests();
    this.emitRequests();
    this.resubscribe();
    this.emitContacts();
    this.emitBlocked();
  }

  unblockContact(pubkey: PubkeyHex): void {
    this.storage.unblockContact(pubkey);
    this.blocked = this.storage.loadBlocked();
    this.emitBlocked();
  }

  /**
   * 清除指向某座 relay 的所有聯絡人 hint（ADR-0036 後續）：
   * 相關聯絡人改回 home 路由，關閉該座連線並自 pool 移除。
   */
  clearRelayHint(url: string): void {
    const norm = normalizeRelayUrl(url);
    if (!norm) return;
    for (const c of this.contacts) {
      if (this.foreignUrlOf(c) === norm) this.storage.updateContactRelay(c.pubkey, undefined);
    }
    this.contacts = this.storage.loadContacts();
    this.relayPool.get(norm)?.close?.();
    this.relayPool.delete(norm);
    this.relayStates.delete(norm);
    this.offlineSince.delete(norm);
    this.resubscribe(); // presence 分組回到 home
    this.emitRelayPool();
  }

  /** 確認保留某座 stale relay：重置離線計時，暫時隱藏警告（ADR-0036 後續）。 */
  acknowledgeRelayStale(url: string): void {
    const norm = normalizeRelayUrl(url);
    if (!norm || !this.offlineSince.has(norm)) return;
    this.offlineSince.set(norm, Date.now());
    this.emitRelayPool();
  }

  /**
   * home 連續離線超過門檻且有健康引導座時，自動遞補 effective home（ADR-0039）。
   * 只切換 effective home（不拆原始連線）：presence 分組、hint 廣播、分享字串隨之更新。
   */
  private maybeSucceedHome(): void {
    if (!this.connectorFor || !this.homeUrl) return;
    const since = this.offlineSince.get(this.homeUrl);
    if (since === undefined || Date.now() - since <= RELAY_STALE_MS) return;
    const healthy = [...this.bootstrapSeats].find(
      (u) => u !== this.homeUrl && this.relayStates.get(u) === "online",
    );
    if (!healthy) return;
    this.homeUrl = healthy;
    this.resubscribe();
    this.beat(); // 立即在新 home 廣播在線
    if (this.handlers) this.onHomeSwitched?.(healthy);
  }

  /**
   * 搬家目標（ADR-0069）：清單序首個 accepting 且 ok 且**在線**且 ≠ 原 home——
   * 決定性選座讓同帳號多台裝置各自搬也選到同一座（緩解 split-brain）；
   * 清單沒涵蓋的錨點座接在其後作為保底。
   */
  private pickMigrationTarget(): string | undefined {
    const entries = this.lastList ? listEntries(this.lastList) : [];
    const known = new Set(entries.map((e) => e.url));
    for (const url of this.bootstrapSeats) {
      if (!known.has(url)) entries.push({ url, accepting: true, weight: 1, status: "ok" });
    }
    for (const e of entries) {
      if (!e.accepting || e.status !== "ok") continue;
      const url = normalizeRelayUrl(e.url);
      if (!url || url === this.originalHomeUrl) continue;
      if (this.relayStates.get(url) === "online") return url;
    }
    return undefined;
  }

  /** home（profile 所指的原始座）離線起點；跨 session 以 localStorage 持久化（不可用時退回本 session）。 */
  private homeDownSince(): number | undefined {
    const url = this.originalHomeUrl;
    if (!url) return undefined;
    const key = `nb.homeDownAt.${this.self.pubkey.slice(0, 8)}`;
    if (this.relayStates.get(url) === "online") {
      try {
        localStorage.removeItem(key);
      } catch {
        /* 忽略 */
      }
      return undefined;
    }
    const mem = this.offlineSince.get(url);
    if (mem === undefined) return undefined; // 尚未觀察到離線（connecting 不算死）
    try {
      const raw = localStorage.getItem(key);
      const persisted = raw ? Number(raw) : Number.NaN;
      if (Number.isFinite(persisted)) return Math.min(persisted, mem);
      localStorage.setItem(key, String(mem));
      return mem;
    } catch {
      return mem;
    }
  }

  /** T2（ADR-0069）：home 持續死亡逾門檻且有健康目標 → durable 搬家通知（一次性）。 */
  private maybeMigrateHome(): void {
    if (!this.onHomeMigrate || this.migrateFired || !this.originalHomeUrl) return;
    const downAt = this.homeDownSince();
    if (downAt === undefined || Date.now() - downAt <= this.homeDeadMs) return;
    const target = this.pickMigrationTarget();
    if (!target) return;
    this.migrateFired = true;
    this.onHomeMigrate(target, "dead");
  }

  /** T3（ADR-0069）：採用的清單把我的 home 標 draining/retired → 分批隨機延遲後撤離。 */
  private scheduleRetirementIfNeeded(): void {
    if (!this.onHomeMigrate || this.migrateFired || this.retireTimer !== undefined) return;
    if (!this.originalHomeUrl || !this.lastList) return;
    const mine = listEntries(this.lastList).find((e) => e.url === this.originalHomeUrl);
    if (!mine || mine.status === "ok") return;
    const delay = this.retireDelayFn?.() ?? Math.floor(Math.random() * 6 * 3600_000);
    this.retireTimer = setTimeout(() => {
      if (this.migrateFired) return;
      const target = this.pickMigrationTarget();
      if (!target) return;
      this.migrateFired = true;
      this.onHomeMigrate?.(target, "retired");
    }, delay);
  }

  /** 記錄某座 relay 的狀態與連續離線起點，並發出 pool 快照。 */
  private trackRelayState(url: string, state: ConnectionState): void {
    this.relayStates.set(url, state);
    if (state === "offline") {
      if (!this.offlineSince.has(url)) this.offlineSince.set(url, Date.now());
    } else if (state === "online") {
      this.offlineSince.delete(url);
    }
    this.emitRelayPool();
  }

  private relayEntry(url: string, home: boolean): { url: string; state: ConnectionState; home: boolean; stale: boolean } {
    const since = this.offlineSince.get(url);
    return {
      url,
      state: this.relayStates.get(url) ?? "connecting",
      home,
      stale: since !== undefined && Date.now() - since > RELAY_STALE_MS,
    };
  }

  /** 通知 relay pool（home 優先）各座連線狀態；快照沒變則靜默（防抖）。 */
  private emitRelayPool(): void {
    if (!this.handlers?.onRelayPool) return;
    const list = [
      this.relayEntry(this.homeUrl ?? "", true),
      ...[...this.relayPool.keys()]
        .filter((url) => url !== this.homeUrl)
        .map((url) => this.relayEntry(url, false)),
    ];
    const sig = list.map((r) => `${r.url}|${r.state}|${r.stale}`).join(",");
    this.emitIfChanged("relayPool", sig, () => this.handlers?.onRelayPool?.(list));
  }

  private emitBlocked(): void {
    this.handlers?.onBlocked?.(this.blocked.map((b) => ({ pubkey: b.pubkey, name: b.name })));
  }

  private onConnection(state: ConnectionState): void {
    this.trackRelayState(this.originalHomeUrl ?? "", state);
    this.handlers?.onConnection?.(state);
    // 重連成功後重新訂閱並發送心跳（RelayClient 不會自動重送訂閱）
    if (state === "online" && this.handlers) {
      this.resubscribe();
      this.beat();
      this.outbox.onReconnect(); // 補送重連前未確認的可靠訊息（ADR-0041）
    }
  }

  private emitContacts(): void {
    if (!this.handlers) return;
    const now = Date.now();
    const contacts: Contact[] = this.contacts.map((c) => {
      // ADR-0119 修正：改用 `statusOf()`（容忍窗＝2.5 × 對方**自報**的心跳節奏，ADR-0109）。
      // 舊版硬比 90 秒（＝3× 舊的 30 秒心跳）——但 ADR-0109 之後閒置聯絡人每 **300 秒**才發一次
      // 心跳，90 秒的窗會把「在線但閒置」的人判成離線（每 5 分鐘只亮 90 秒，一直閃）。
      // 引擎當時還自相矛盾：決定我方心跳快慢的 `anyContactOnline()` 用的是正確的 statusOf()。
      const online = this.presence.statusOf(c.pubkey, now) === "online";
      const payload = this.statuses.get(c.pubkey);
      return {
        pubkey: c.pubkey,
        name: c.name,
        ...(c.alias ? { alias: c.alias } : {}), // ADR-0148：本地暱稱（有設才帶）
        ...(c.notifySound ? { notifySound: c.notifySound } : {}), // ADR-0149：依聯絡人通知音效
        ...(c.avatar ? { avatar: c.avatar } : {}), // ADR-0154：對方廣播的頭像
        ...(c.title ? { title: c.title } : {}), // ADR-0158：對方廣播的企業頭銜
        status: online ? payload?.s ?? "online" : "offline",
        statusMessage: (online ? payload?.m : undefined) ?? "",
        nowPlaying: (online ? payload?.np : undefined) ?? "",
      };
    });
    // 只在實際內容變動時才通知（避免每秒無謂的 React 重渲染）。
    this.emitIfChanged("contacts", JSON.stringify(contacts), () => this.handlers?.onContacts(contacts));
  }

  /** 內容簽章防抖：同一頻道簽章未變則不重發（收斂 emitContacts/emitRelayPool 的重複樣式）。 */
  private emitIfChanged(channel: string, sig: string, emit: () => void): void {
    if (this.emitSigs.get(channel) === sig) return;
    this.emitSigs.set(channel, sig);
    emit();
  }

  setStatus(status: Status, message?: string): void {
    this.self.status = status;
    if (message !== undefined) this.self.statusMessage = message;
    if (status !== "offline") {
      this.beat(); // 存活信標（P2P 完整狀態 + relay 無內容信標）
      this.broadcastPresenceState(); // ADR-0129：改變的狀態封裝給在線✕無P2P 的聯絡人
    }
  }

  /** 隱身開關（ADR-0088 (d)）：開＝停止一切在線廣播（relay＋P2P），仍正常收發；關＝立即復出廣播。 */
  setInvisible(invisible: boolean): void {
    this.invisible = invisible;
    if (!invisible) {
      this.beat();
      this.broadcastPresenceState(); // 復出：重新封裝送出當下狀態（ADR-0129）
    }
  }

  setNowPlaying(text: string): void {
    // F5：音樂彙整進在線狀態；ADR-0129：改變時封裝送出（relay 不再明文看到你在聽什麼）。
    this.nowPlaying = text;
    this.beat();
    this.broadcastPresenceState();
  }

  /**
   * 更改顯示名稱（ADR-0144）：更新記憶體→落地本機（nsec 不明文，只更名，ADR-0112）→ 把新名
   * 廣播給所有聯絡人（ADR-0061）。空白或未變動則忽略。
   */
  setSelfName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.self.name) return;
    this.self.name = trimmed;
    this.storage.saveIdentity({ nsec: "", name: trimmed });
    // 清掉「已送過 profile」記號，讓每個聯絡人都重新收到新名字（否則 sendProfileTo 會略過）。
    this.profileSentTo.clear();
    this.broadcastProfile();
  }

  sendMessage(to: PubkeyHex, text: string, ttlSeconds?: number, mentions?: PubkeyHex[], replyTo?: string): void {
    // 你主動回覆一個請求＝你接受了他（ADR-0121）。不接受就送訊息會很怪：對方在你的清單裡
    // 永遠是「請求」，你卻在跟他聊天。**主動聯絡的人就是聯絡人。**
    if (this.requests.some((r) => r.pubkey === to)) this.acceptRequest(to);
    // 送出時間固定一次（ADR-0108）：同一個值既寫進 rumor.created_at、也當本機 `at`。
    // 否則發送裝置存毫秒 `Date.now()`、其他裝置存 `created_at * 1000`（秒截斷），
    // 同一則訊息會差最多 999ms → 已讀水位比較就不精確了。
    const now = nowSec();
    const disappearAt = ttlSeconds ? now + ttlSeconds : undefined;
    const wrapped = wrapMessage(text, this.sk, to, {
      now,
      ...(disappearAt !== undefined ? { disappearAt } : {}),
      // 組織保留政策（ADR-0160）：閱後即焚不受影響（disappearAt 語意優先）。
      ...(disappearAt === undefined ? this.orgExpiration(now) : {}),
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    const id = wrapped.id; // 內層 rumor id（ADR-0107）：對方與自己的其他裝置都指涉同一則
    const extra = {
      ...(disappearAt !== undefined ? { expiresAt: disappearAt * 1000 } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const message = { id, contact: to, outgoing: true, text, at: now * 1000, status: "sending" as const, ...extra };
    this.seenMsg.add(id); // 自封副本回流到本機時據此丟棄（ADR-0107）
    this.storage.appendMessage(message);
    this.handlers?.onMessage(to, { id, outgoing: true, text, at: message.at, status: "sending" as const, ...extra });
    // 先存後送：確保同步（測試網路）回來的 OK/回條找得到已存訊息才更新狀態（ADR-0058）。
    this.publishWrapped(to, id, wrapped);
  }

  /**
   * 把對話鍵解析成**收件人清單**（ADR-0119）。
   *
   * `groupId` **不是 pubkey**（16 bytes hex vs 32）。過去 `sendReaction`／`unsendMessage`
   * 直接把對話鍵當 pubkey 丟進 NIP-44 → **群組裡按回應或收回訊息直接拋錯**（桌面與行動端皆然）。
   * 群組**無共用金鑰**（ADR-0027），所以正確做法是**扇給每位其他成員**——與群訊同一套。
   */
  private recipientsOf(convo: string): PubkeyHex[] | null {
    const group = this.groups.find((g) => g.id === convo);
    if (!group) return [convo]; // 1:1
    const others = group.members.filter((m) => m !== this.self.pubkey);
    return others.length > 0 ? others : null; // 空群：沒有人可送
  }

  sendReaction(to: PubkeyHex, messageId: string, emoji: string): void {
    const recipients = this.recipientsOf(to);
    if (!recipients) return;
    const wrapped = wrapReaction(emoji, this.sk, recipients, messageId);
    // 回應不追蹤送出狀態（無 tick）→ 直接送；含自封副本讓自己的其他裝置也看得到（ADR-0107）。
    for (const evt of wrapped.events) this.publishReliable(evt);
    this.publishReliable(wrapped.selfCopy);
    this.seenMsg.add(wrapped.id);
    this.storage.addReaction({ id: wrapped.id, messageId, emoji, mine: true });
    this.handlers?.onReaction?.(messageId, emoji, true);
  }

  /** 本 session 已送過個人檔的對象（避免收到對方個人檔時來回反覆傳送）。 */
  private readonly profileSentTo = new Set<PubkeyHex>();

  /** ADR-0061：把自己的顯示名稱與頭像（加密個人檔）送給某聯絡人；帶 home hint（ADR-0066）。 */
  private sendProfileTo(pubkey: PubkeyHex): void {
    this.profileSentTo.add(pubkey);
    // 頭像（ADR-0154）/頭銜（ADR-0158）：null＝從未設定 → 欄位缺席（不影響對方）；""＝移除記號照送。
    const profile = {
      name: this.self.name,
      ...(this.myAvatar !== null ? { avatar: this.myAvatar } : {}),
      ...(this.myTitle !== null ? { title: this.myTitle } : {}),
    };
    // hint 讓「每次開機廣播」同時成為全聯絡人的路由刷新——搬家後自動改道、陳舊自癒。
    this.publishReliable(wrapProfile(profile, this.sk, pubkey, this.homeUrl ? { relayHint: this.homeUrl } : {}));
  }

  /** 廣播自己的顯示名稱給所有聯絡人（開機時，讓既有聯絡人也學到暱稱）。 */
  private broadcastProfile(): void {
    for (const c of this.contacts) this.sendProfileTo(c.pubkey);
  }

  /** 每群每日至多一次的快照節流（非敏感時間戳；localStorage 不可用時放行、僅靠 session 一次）。 */
  private groupSnapshotDue(groupId: string): boolean {
    const key = `nb.groupSnapAt.${this.self.pubkey.slice(0, 8)}.${groupId}`;
    try {
      const last = Number(localStorage.getItem(key) ?? 0);
      if (Date.now() - last < 86_400_000) return false;
      localStorage.setItem(key, String(Date.now()));
      return true;
    } catch {
      return true;
    }
  }

  /**
   * ADR-0068：管理員開機把自建群組的權威快照廣播給成員——nsec 換機的成員（白紙裝置）
   * 收到即重建群組，既有成員冪等對帳。組織群排除（名冊已是更強權威，ADR-0049）。
   */
  private broadcastGroups(): void {
    for (const g of this.groups) {
      if (g.admin !== this.self.pubkey || g.org) continue;
      const recipients = g.members.filter((m) => m !== this.self.pubkey);
      if (recipients.length === 0 || !this.groupSnapshotDue(g.id)) continue;
      const control: GroupControl = { type: "group-snapshot", id: g.id, name: g.name, admin: g.admin, members: g.members };
      for (const evt of wrapGroupControl(control, this.sk, recipients, this.homeUrl ? { relayHint: this.homeUrl } : {})) {
        this.publishReliable(evt);
      }
    }
  }

  /**
   * 合併自己的雲端快照（ADR-0071 J3）：交換律語意——多台裝置的快照任意順序合併
   * 收斂一致。補回的對話以 onHistory 重放（App 端僅在該對話尚未載入時採用）。
   */
  private receiveSnapshot(event: NostrEvent): void {
    if (event.pubkey !== this.self.pubkey) return; // 只信自己的快照
    const plain = openSnapshotEvent(event, this.sk);
    if (!plain) return;
    const content = parseSnapshotContent(plain);
    if (!content) return;
    this.handlers?.onCloudSyncMode?.(content.mode); // 模式隨快照傳播（App 端決定是否採用，審查修正 #1）
    const { changed, convos } = mergeSnapshotContent(this.storage, content);
    if (!changed) return;
    this.contacts = this.storage.loadContacts();
    this.blocked = this.storage.loadBlocked();
    this.groups = this.storage.loadGroups();
    this.resubscribe(); // 新聯絡人的 hint／新群組成員的 presence 分組
    this.emitContacts();
    this.emitGroups();
    this.emitBlocked();
    for (const convo of convos) {
      const msgs = this.storage.loadMessages(convo);
      for (const m of msgs) this.seenMsg.add(m.id);
      this.handlers?.onHistory?.(convo, msgs.map(storedToChat));
      this.recountUnread(convo); // 快照注入了訊息 → 該對話的未讀需重算（ADR-0110）
    }
    if (convos.length > 0) this.emitUnread();
  }

  private snapshotThrottleKey(deviceId: string): string {
    return `nb.snapPub.${this.self.pubkey.slice(0, 8)}.${deviceId}`;
  }

  /** 快照發佈節流（ADR-0071）：內容有變＋每日至多一次；localStorage 不可用時放行。 */
  private snapshotDue(contentHash: string): boolean {
    const key = this.snapshotThrottleKey(this.cloudSync?.deviceId ?? "");
    try {
      const raw = localStorage.getItem(key);
      const last = raw ? (JSON.parse(raw) as { at: number; hash: string }) : undefined;
      if (last && (last.hash === contentHash || Date.now() - last.at < 86_400_000)) return false;
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), hash: contentHash }));
      return true;
    } catch {
      return true;
    }
  }

  /** 快照發佈失敗時清除節流記錄，讓下次 30 分檢查重試（審查修正 #5：TOCTOU 回滾）。 */
  private clearSnapshotThrottle(): void {
    try {
      localStorage.removeItem(this.snapshotThrottleKey(this.cloudSync?.deviceId ?? ""));
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 關閉狀態對帳（審查修正 #6）：曾發佈過快照（留有節流記錄）但現在未啟用備份
   * → 開機補發 purge。切關當下的 flush 競態由此兜底，「已關閉＝雲端零殘留」最終一致。
   */
  private reconcileCloudOff(): void {
    if (this.cloudSync) return;
    try {
      const deviceId = getDeviceId();
      const key = this.snapshotThrottleKey(deviceId);
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        this.purgeCloudSnapshot(deviceId);
      }
    } catch {
      /* localStorage 不可用（測試/受限環境）：略過 */
    }
  }

  /** 開機/定時檢查：內容有變且未達每日上限才發佈快照（ADR-0071 J2）。 */
  private maybePublishSnapshot(): void {
    if (!this.cloudSync || this.cloudBackupBlocked) return;
    const content = buildSnapshotContent(this.storage, this.cloudSync.mode);
    const hash = JSON.stringify({ ...content, at: 0 }); // 比對不含產生時間
    if (!this.snapshotDue(hash)) return;
    this.publishReliable(buildSnapshotEvent(JSON.stringify(content), this.sk, this.cloudSync.deviceId));
  }

  /** 立即備份（設定面板「立即備份」；跳過節流）。 */
  publishSnapshotNow(): void {
    if (!this.cloudSync || this.cloudBackupBlocked) return;
    const content = buildSnapshotContent(this.storage, this.cloudSync.mode);
    this.publishReliable(buildSnapshotEvent(JSON.stringify(content), this.sk, this.cloudSync.deviceId));
  }

  /** 關閉雲端快照＝立即清除 relay 上此裝置的快照（purge；「已關閉」必須立即為真）。 */
  purgeCloudSnapshot(deviceId: string): void {
    this.publishReliable(buildSnapshotPurge(this.sk, deviceId));
  }

  /** 寫入並廣播訊息狀態（只前進，由儲存層守門）。 */
  private setMsgStatus(convo: string, messageId: string, status: MessageStatus): void {
    this.storage.setMessageStatus(convo, messageId, status);
    this.handlers?.onMessageStatus?.(convo, messageId, status);
  }

  /**
   * Tier 1（ADR-0058）：relay 接受某事件＝已送中繼。1:1 與群訊都走扇出（任一 OK 即 sent）。
   * **自封副本不在 `fanout` 裡**（ADR-0107）——它成功與否不影響狀態。
   */
  private markSent(eventId: string): void {
    const fan = this.fanout.get(eventId);
    if (!fan) return;
    this.fanout.delete(eventId);
    fan.pending -= 1;
    if (fan.ok) return;
    fan.ok = true; // 任一 wrap 進了中繼即視為已送出
    this.setMsgStatus(fan.convo, fan.messageId, "sent");
  }

  /**
   * 送出失敗（ADR-0095）：外送匣重試耗盡或被明確拒收。需**所有**（定址給對方的）wrap
   * 都放棄且無任一成功才算失敗——群訊部分成員送達仍算送出；1:1 只有一顆，語意等同直接標 failed。
   */
  private markFailed(eventId: string): void {
    const fan = this.fanout.get(eventId);
    if (!fan) return;
    this.fanout.delete(eventId);
    fan.pending -= 1;
    if (fan.ok || fan.pending > 0) return; // 已有成功、或還有 wrap 在途 → 先不判失敗
    this.setMsgStatus(fan.convo, fan.messageId, "failed");
  }

  /** 套用收到的送達/已讀回條到自己送出的訊息（ADR-0058；群組見 ADR-0095）。 */
  private applyReceipt(from: PubkeyHex, messageId: string, type: ReceiptType, groupId?: string): void {
    if (groupId) {
      this.applyGroupReceipt(from, messageId, type, groupId);
      return;
    }
    if (type === "read") {
      if (!this.readReceipts) return; // 互惠：自己關閉已讀就不顯示他人已讀
      // 水位：把該對話中、時間不晚於目標訊息的自己訊息全標為已讀。
      const msgs = this.storage.loadMessages(from);
      const target = msgs.find((m) => m.id === messageId);
      if (!target) {
        this.deferReceipt(messageId, from, "read"); // 回條早於自封副本（ADR-0107）
        return;
      }
      // 水位＝把時間不晚於目標的自己訊息全標為已讀。**一次批次**（ADR-0110）：
      // 逐則呼叫時，持久化層每則都要重寫整個對話 → O(k×n)（實測 5 萬則歷史下凍結 3.5 秒）。
      const ids = msgs.filter((m) => m.outgoing && m.at <= target.at && m.status !== "read").map((m) => m.id);
      for (const id of this.storage.setMessageStatusBulk(from, ids, "read")) {
        this.handlers?.onMessageStatus?.(from, id, "read");
      }
      return;
    }
    // 目標訊息尚未抵達本機（自封副本可能還在路上——中繼回放順序是亂的）→ 暫存，稍後重放。
    if (!this.storage.loadMessages(from).some((m) => m.id === messageId)) {
      this.deferReceipt(messageId, from, "delivered");
      return;
    }
    this.setMsgStatus(from, messageId, "delivered");
  }

  /**
   * 群組回條（ADR-0095）：記在該訊息的**每成員回條表**（誰送達/誰已讀），而非單一 scalar。
   * 大群（mode off）直接丟棄——我們本來就不送、也不該接受別人塞進來的回條。
   * 已讀仍受互惠開關約束（自己關已讀就不收別人的已讀）。已讀採水位語意（含更早的自己訊息）。
   */
  private applyGroupReceipt(from: PubkeyHex, messageId: string, type: ReceiptType, groupId: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return;
    if (groupReceiptMode(group.members.length) === "off") return; // 大群不記
    if (!group.members.includes(from)) return; // 非成員的回條不收
    if (type === "read" && !this.readReceipts) return; // 互惠

    const msgs = this.storage.loadMessages(groupId);
    const target = msgs.find((m) => m.id === messageId);
    // 目標群訊尚未抵達本機（自封副本還在路上）→ 暫存，待它抵達時重放（ADR-0107）。
    if (!target) {
      this.deferReceipt(messageId, from, type, groupId);
      return;
    }
    // 送達只標該則；已讀採水位（把不晚於目標的自己訊息一併標為此成員已讀）。
    // 同樣走批次（ADR-0110）——群組水位逐則寫回一樣是 O(k×n)。
    const ids = msgs
      .filter((m) => m.outgoing && (type === "delivered" ? m.id === messageId : m.at <= target.at))
      .map((m) => m.id);
    for (const [id, receipts] of this.storage.setMessageReceiptBulk(groupId, ids, from, type)) {
      this.handlers?.onMessageReceipts?.(groupId, id, receipts);
    }
  }

  /**
   * 開啟對話時呼叫（ADR-0058 Tier 3）：啟用已讀回條時送「已讀到最新」水位回條。
   * 群組（ADR-0095）：小群才送——且回條要**分別送給每位發訊者**（群訊來自多人），
   * 每人各一則指向「他最新那則」的水位回條；大群完全不送。
   */
  /**
   * 從儲存重算某個對話的未讀數與最新收訊時間（ADR-0108/0110）。
   *
   * 這是 **O(該對話長度)**，所以**只在必要時**呼叫：開機、快照合併、對話變動。
   * 收訊的熱路徑走 {@link bumpUnread}（O(1)）——原本每收一則訊息就重掃**所有對話的所有訊息**
   * （ADR-0108 的實作缺陷），在 LocalStorage 下等於重新解析每個對話的完整歷史。
   */
  private recountUnread(convo: string): void {
    const mark = this.storage.loadReadAt()[convo] ?? 0;
    let unread = 0;
    let latest = 0;
    for (const m of this.storage.loadMessages(convo)) {
      if (m.outgoing) continue;
      if (m.at > latest) latest = m.at;
      if (m.at > mark) unread += 1;
    }
    this.lastIncomingAt.set(convo, latest);
    if (unread > 0) this.unread.set(convo, unread);
    else this.unread.delete(convo);
  }

  /** 全量重算（僅開機與快照合併後）。 */
  private recountAllUnread(): void {
    for (const c of this.contacts) this.recountUnread(c.pubkey);
    for (const g of this.groups) this.recountUnread(g.id);
  }

  /** 收到一則他人訊息：未讀 +1、推進最新收訊時間（O(1)，ADR-0110）。 */
  private bumpUnread(convo: string, at: number): void {
    if (at > (this.lastIncomingAt.get(convo) ?? 0)) this.lastIncomingAt.set(convo, at);
    // 訊息請求**不點亮未讀徽章**（ADR-0121）：徽章和通知是同一條注意力管道，
    // 陌生人不該碰得到。他的存在由「請求區」呈現，那裡有你要做的決定。
    // （`recountAllUnread()` 只掃聯絡人與群組 → 重載後本來就不會算他；兩邊要一致。）
    if (this.requests.some((r) => r.pubkey === convo)) return;
    if (at <= (this.storage.loadReadAt()[convo] ?? 0)) return; // 晚到的舊訊息：水位之下＝已讀
    this.unread.set(convo, (this.unread.get(convo) ?? 0) + 1);
    this.emitUnread();
  }

  private emitUnread(): void {
    this.handlers?.onUnread?.(Object.fromEntries(this.unread));
  }

  /**
   * 清除某對話的未讀＝推進本機已讀水位（ADR-0108）。
   *
   * **一律持久化，與「是否送已讀回條」無關。** 這兩件事不同：已讀回條是**隱私選擇**
   * （告訴對方我讀了，opt-in 預設關）；本機水位是 **UX**（記得自己讀到哪，應永遠有效）。
   * 若把水位掛在 `markRead()` 上，大多數使用者（回條關閉）的未讀狀態就永遠不會被保存。
   */
  clearUnread(convo: string): void {
    const latest = this.lastIncomingAt.get(convo) ?? 0; // 增量維護（ADR-0110）→ 免掃全對話
    if (latest === 0) return; // 無收訊 → 沒有水位可推進
    this.storage.setReadAt(convo, latest); // 單調遞增，倒退忽略
    if (!this.unread.has(convo)) return;
    this.unread.delete(convo);
    this.emitUnread();
  }

  markRead(convo: PubkeyHex): void {
    this.clearUnread(convo); // 本機水位一律推進（ADR-0108）——與下方的回條設定無關
    if (!this.readReceipts) return; // 已讀回條：opt-in（ADR-0058 互惠）
    // 🔴 請求區的訊息**絕不送已讀回條**（ADR-0121）：那等於向垃圾訊息發送者回報
    // 「這個 npub 是活的、有人真的讀了」——那正是他最想要的東西。看，但不要回話。
    if (this.requests.some((r) => r.pubkey === convo)) return;
    const group = this.groups.find((g) => g.id === convo);
    if (group) {
      if (groupReceiptMode(group.members.length) === "off") return; // 大群不記
      // 每位發訊者的最新一則＝送給他的已讀水位。
      const latestBy = new Map<PubkeyHex, string>();
      for (const m of this.storage.loadMessages(convo)) {
        if (m.outgoing || !m.sender || m.sender === this.self.pubkey) continue;
        latestBy.set(m.sender, m.id);
      }
      for (const [author, msgId] of latestBy) {
        const key = `${convo}:${author}`;
        if (this.lastReadSent.get(key) === msgId) continue; // 已送過同一水位
        this.lastReadSent.set(key, msgId);
        this.publishReliable(wrapReceipt("read", this.sk, author, msgId, { groupId: convo }));
      }
      return;
    }
    const incoming = this.storage.loadMessages(convo).filter((m) => !m.outgoing);
    const latest = incoming[incoming.length - 1];
    if (!latest || this.lastReadSent.get(convo) === latest.id) return; // 無收訊或已送過同一水位
    this.lastReadSent.set(convo, latest.id);
    this.publishReliable(wrapReceipt("read", this.sk, convo, latest.id));
  }

  /** 設定已讀回條開關（opt-in + 互惠；ADR-0058）。 */
  setReadReceipts(enabled: boolean): void {
    this.readReceipts = enabled;
  }

  unsendMessage(to: PubkeyHex, messageId: string): void {
    const recipients = this.recipientsOf(to);
    if (!recipients) {
      // 空群仍要在本機收回（否則使用者按了收回卻什麼都沒發生）。
      this.storage.markDeleted(messageId);
      this.handlers?.onUnsend?.(messageId);
      return;
    }
    const wrapped = wrapDeletion(this.sk, recipients, messageId);
    // 自封副本是**必要**的（ADR-0107）：否則在手機收回的訊息，仍留在自己的電腦上。
    for (const evt of wrapped.events) this.publishReliable(evt);
    this.publishReliable(wrapped.selfCopy);
    this.seenMsg.add(wrapped.id);
    this.storage.markDeleted(messageId);
    this.handlers?.onUnsend?.(messageId);
  }

  sendFile(to: PubkeyHex, file: OutgoingFile, opts: { thumb?: string; savedPath?: string } = {}): string {
    // 🔴 群組（ADR-0124）：`to` 是 groupId（32 字元），不是 pubkey（64 字元）。
    // 直接往下走會把它丟進 NIP-44 → `second arg must be public key`，**當場爆炸**。
    // 而 UI 從來沒擋過群組裡的 📎，所以這是使用者點得到的路徑。
    const group = this.groups.find((g) => g.id === to);
    if (group) return this.sendGroupFile(group, file, opts);

    // 位元組預設走 P2P；組織政策 relayFilesMaxMb（ADR-0162）啟用且對象為名冊在世成員、
    // 檔案 ≤ 上限時改走 relay 加密分塊（離線也送得到）。metadata 訊息兩種路徑皆照發。
    const relayMb = this.lastRoster?.policy?.relayFilesMaxMb;
    const viaRelay =
      !!relayMb &&
      file.bytes.length <= relayMb * 1024 * 1024 &&
      !!this.lastRoster?.members.some((m) => m.pubkey === to && !m.supersededBy);
    const tid = viaRelay ? this.transfer.newTransferId() : this.transfer.sendFile(to, file);
    const meta = { tid, name: file.name, size: file.bytes.length, mime: file.mime };
    const now = nowSec(); // 同一個送出時間寫進 rumor 也當本機 `at`（ADR-0108）
    const wrapped = wrapFileMessage(this.sk, to, meta, {
      now,
      ...this.orgExpiration(now), // ADR-0160
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
    });
    const id = wrapped.id;
    this.seenMsg.add(id);
    // 訊息 id＝metadata 的 rumor id（ADR-0107，供回條與自己的其他裝置對得上）；file.id＝tid。
    this.ensureFileMessage(to, meta, { msgId: id, outgoing: true, sent: 0, status: "sending", at: now * 1000 });
    if (opts.thumb) this.setFileThumb(to, id, opts.thumb);
    // 送出端原檔路徑（ADR-0103）：原生選檔才有；讓自己送出的圖片重載後也讀得回原圖。
    if (opts.savedPath) this.storage.setFileSavedPath(to, id, opts.savedPath);
    this.publishWrapped(to, id, wrapped);
    if (viaRelay) {
      // 分塊經外送匣節流背景送出；無逐塊進度——送端直接標傳輸完成（ADR-0162 已知限制）。
      const parts = splitFileChunks(file.bytes);
      for (let seq = 0; seq < parts.length; seq++) {
        this.publishReliable(
          wrapFileChunk(
            { tid, seq, total: parts.length, name: file.name, mime: file.mime, data: parts[seq]! },
            this.sk,
            to,
            { now, ...this.orgExpiration(now) },
          ),
        );
      }
      this.handlers?.onFileProgress?.(to, tid, file.bytes.length, file.bytes.length);
    }
    return tid;
  }

  /**
   * 群組傳檔（ADR-0124）：**metadata 扇給每位成員、位元組對每位成員各走一條 P2P**。
   *
   * 群組沒有共用金鑰（ADR-0027），所以「送給群組」在協定層不存在——只有「分別送給每一位」。
   * 而位元組**必須送 N 份**：P2P 沒有群播，明文又不能上中繼。這是隱私的代價。
   */
  private sendGroupFile(
    group: Group,
    file: OutgoingFile,
    opts: { thumb?: string; savedPath?: string } = {},
  ): string {
    if (!canPostToGroup(group, this.self.pubkey)) return ""; // 公告群僅管理者可發（ADR-0049）
    const members = group.members.filter((m) => m !== this.self.pubkey);

    // **所有成員共用同一個 tid**：metadata 只有一個（rumor 跨成員共用），若每條 P2P 各自產 id，
    // 收件端就對不回同一則訊息——位元組到了，卻不知道它屬於哪一則。
    const tid = this.transfer.newTransferId();
    for (const m of members) this.transfer.sendFile(m, file, tid);

    const meta = { tid, name: file.name, size: file.bytes.length, mime: file.mime };
    const now = nowSec();
    const wrapped = wrapGroupFile(meta, this.sk, this.self.pubkey, group, {
      now,
      ...this.orgExpiration(now), // ADR-0160
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
    });
    const id = wrapped.id;
    this.seenMsg.add(id);
    this.ensureFileMessage(group.id, meta, {
      msgId: id,
      outgoing: true,
      sent: 0,
      status: "sending",
      at: now * 1000,
      sender: this.self.pubkey, // 群訊要知道誰發的
    });
    if (opts.thumb) this.setFileThumb(group.id, id, opts.thumb);
    if (opts.savedPath) this.storage.setFileSavedPath(group.id, id, opts.savedPath);
    this.publishWrapped(group.id, id, wrapped);
    return tid;
  }

  /** 回填某圖片訊息的縮圖（ADR-0102）：由前端產生（需 canvas），只存本機、不外送。 */
  setFileThumb(contact: PubkeyHex, messageId: string, thumb: string): void {
    this.storage.setFileThumb(contact, messageId, thumb);
    this.handlers?.onFileThumb?.(contact, messageId, thumb);
  }

  /**
   * 建立（或取回）一則檔案訊息（ADR-0093）：以 `tid` 去重——中繼 metadata 與 P2P 位元組
   * 任一先到都只產生一則訊息。持久化僅存 metadata（無位元組），並 emit 給 UI。回傳訊息 id。
   */
  private ensureFileMessage(
    contact: PubkeyHex,
    meta: { tid: string; name: string; size: number; mime: string },
    opts: {
      msgId: string;
      outgoing: boolean;
      sent: number;
      status?: MessageStatus;
      at?: number;
      /** 群組檔案（ADR-0124）：發送者 pubkey——否則群裡分不出是誰傳的。 */
      sender?: PubkeyHex;
    },
  ): string {
    const existing = this.fileMsgByTid.get(meta.tid);
    if (existing) return existing.msgId;
    // ADR-0108：時間取自 metadata 的 rumor（送出時間）。位元組先於 metadata 抵達時無 rumor
    // 可依（P2P 直連，本來就是即時的）→ 退回本機時間。
    const at = opts.at ?? Date.now();
    const stored: StoredMessage = {
      id: opts.msgId,
      contact,
      outgoing: opts.outgoing,
      text: "",
      at,
      file: { tid: meta.tid, name: meta.name, size: meta.size, mime: meta.mime },
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.sender ? { sender: opts.sender } : {}), // 群組檔案（ADR-0124）
    };
    this.storage.appendMessage(stored);
    this.fileMsgByTid.set(meta.tid, { contact, msgId: opts.msgId });
    this.handlers?.onMessage(contact, {
      id: opts.msgId,
      outgoing: opts.outgoing,
      text: "",
      at,
      ...(opts.sender ? { sender: opts.sender } : {}), // 群組檔案（ADR-0124）
      file: { id: meta.tid, name: meta.name, mime: meta.mime, size: meta.size, sent: opts.sent, incoming: !opts.outgoing },
      ...(opts.status ? { status: opts.status } : {}),
    });
    return opts.msgId;
  }

  /** 收到 P2P 檔案位元組（ADR-0093）：關聯到檔案訊息（位元組可能早於 metadata），交 App 另存。 */
  /**
   * relay 檔案分塊（ADR-0162）：解密 → 驗塊 → 重組；收齊走既有 onFileBytes 收檔路徑
   * （儲存槽/另存/縮圖全部照舊）。只收**聯絡人**的塊（組織內功能；陌生人塊＝垃圾儲存向量）。
   */
  private receiveFileChunk(event: NostrEvent): void {
    let opened;
    try {
      opened = unwrapMessage(event, this.sk);
    } catch {
      return;
    }
    const { sender, rumor } = opened;
    if (this.isBlocked(sender) || !this.contacts.some((c) => c.pubkey === sender)) return;
    const chunk = parseFileChunk(rumor);
    if (!chunk) return;
    // 審查修正：收端**重新驗證**組織政策的大小上限（發送端的 relayFilesMaxMb 只是自律，
    // 改過的客戶端可繞過）。有政策時以其換算最大塊數；無政策（非組織聯絡人）沿用核心硬上限。
    const maxMb = this.lastRoster?.policy?.relayFilesMaxMb;
    if (maxMb !== undefined && chunk.total > Math.ceil((maxMb * 1024 * 1024) / FILE_CHUNK_BYTES)) return;
    let asm = this.chunkAsm.get(chunk.tid);
    if (!asm) {
      this.sweepChunkAsm(); // 先回收逾時的不完整重組（審查修正：避免一格永久佔用卡死）
      if (this.chunkAsm.size >= 8) return; // 併發重組上限（防記憶體）
      asm = { sender, name: chunk.name, mime: chunk.mime, total: chunk.total, parts: new Map(), at: nowSec() };
      this.chunkAsm.set(chunk.tid, asm);
    }
    if (asm.sender !== sender || asm.total !== chunk.total) return; // 塊間不一致＝丟棄
    asm.parts.set(chunk.seq, chunk.data);
    if (asm.parts.size < asm.total) return;
    // 收齊 → 重組 → 走既有收檔路徑。
    this.chunkAsm.delete(chunk.tid);
    let size = 0;
    for (const p of asm.parts.values()) size += p.length;
    const bytes = new Uint8Array(size);
    let off = 0;
    for (let i = 0; i < asm.total; i++) {
      const part = asm.parts.get(i);
      if (!part) return; // 理論不可能（size 檢查過）；防禦
      bytes.set(part, off);
      off += part.length;
    }
    this.onFileBytes(sender, { id: chunk.tid, name: asm.name, mime: asm.mime, bytes });
  }

  /** 回收逾時未收齊的分塊重組（審查修正）：防單一聯絡人以殘缺傳輸永久佔滿 8 格。 */
  private sweepChunkAsm(): void {
    const cutoff = nowSec() - RelayChatBackend.CHUNK_ASM_TTL_SEC;
    for (const [tid, asm] of this.chunkAsm) if (asm.at < cutoff) this.chunkAsm.delete(tid);
  }

  private onFileBytes(peer: PubkeyHex, file: ReceivedFile): void {
    // 儲存槽存放（ADR-0161／審查修正）：`origin` 隨 P2P 幀本身到達 → 直接判定為存放，
    // 不進聊天訊息流、無競態。只收**名冊在世成員**（企業主端）；其餘忽略（不塞垃圾）。
    if (file.origin !== undefined) {
      if (this.orgOwnerFlag && this.lastRoster?.members.some((m) => m.pubkey === peer && !m.supersededBy)) {
        this.handlers?.onSlotDeposit?.(peer, {
          tid: file.id,
          name: file.name,
          mime: file.mime,
          origin: file.origin,
          bytes: file.bytes,
        });
      }
      return;
    }
    const existing = this.fileMsgByTid.get(file.id);
    const msgId = existing?.msgId ?? `bf-${file.id}`;
    if (!existing) {
      // 位元組先到：以位元組自帶的 metadata 先建一則（sent=size＝位元組已在本機）。
      this.ensureFileMessage(
        peer,
        { tid: file.id, name: file.name, size: file.bytes.length, mime: file.mime },
        { msgId, outgoing: false, sent: file.bytes.length },
      );
    }
    // 交 App：跳「另存新檔」對話框、寫入使用者選定路徑後以 setFileSavedPath 回填（App 不保管位元組）。
    //
    // 🔴 第一個參數是**對話鍵**，不是 peer（ADR-0124）。App 拿它當 convo 用
    //（`patchFileByMsgId(prev, pk, …)`、`setFileThumb(pk, …)`），介面上它也叫 `contact`。
    // 1:1 時 peer 就是對話鍵，所以一直沒事；但**群組檔案的對話鍵是 groupId**——傳 peer
    // 會讓收到的位元組被寫進「跟那位成員的 1:1 對話」，而不是群組裡。
    this.handlers?.onFileBytes?.(existing?.contact ?? peer, msgId, file);
  }

  /** 回填某檔案訊息收檔後的本機儲存路徑（ADR-0093）：App 另存完成後呼叫，持久化路徑。 */
  setFileSavedPath(contact: PubkeyHex, messageId: string, savedPath: string): void {
    this.storage.setFileSavedPath(contact, messageId, savedPath);
  }

  /**
   * 存入公司儲存槽（ADR-0161，員工端）：位元組走現有 P2P、metadata 帶 `slot` 標記——
   * 兩端不建聊天訊息、不發自封副本（自己的其他裝置無需知道）。
   */
  depositFile(to: PubkeyHex, file: OutgoingFile, origin: string): string {
    // 審查修正：儲存槽存放的 `origin` **隨 P2P file-begin 幀傳**（不再另發 relay metadata）——
    // 收端從幀本身即知是存放，消除「位元組先於 metadata 到達」的競態與 pendingSlots 無界成長。
    // 存放只在企業主在線時 P2P 直送（ADR-0161 佇列），無離線遞送需求，故不需 relay metadata。
    return this.transfer.sendFile(to, file, undefined, origin);
  }

  /**
   * 管理者佈建（ADR-0047）：以自身金鑰簽章並發布組織名冊到中繼；
   * 回傳供 relay `allowedAuthors` 佈建的 pubkey 清單。只有把此身分 pubkey 設為
   * `adminPubkey` 的成員會採用此名冊。
   */
  publishRoster(
    org: string,
    members: OrgMember[],
    policy?: OrgPolicy,
    groups?: OrgGroup[],
    profile?: { welcome?: string; workHours?: OrgWorkHours },
  ): PubkeyHex[] {
    // ADR-0156：首份名冊發佈前排隊的入職請求（權杖已驗）自動併入，並補上聯絡人互通。
    const merged = [...members];
    if (this.pendingJoins.size > 0) {
      const queued = [...this.pendingJoins];
      this.pendingJoins.clear();
      for (const [pk, name] of queued) {
        // 審查修正：首發前才被封鎖者不得進簽章名冊/allowlist（與 handleOrgJoin 到達時的
        // isBlocked 檢查一致）——否則管理者以為封鎖了，對方仍取得公司站寫入權與全員可見。
        if (this.isBlocked(pk)) continue;
        if (!merged.some((m) => m.pubkey === pk)) merged.push({ pubkey: pk, name });
        this.ensureJoinContact(pk, name);
      }
    }
    const doc: OrgRosterDoc = {
      org,
      members: merged,
      ...(policy ? { policy } : {}),
      ...(groups && groups.length > 0 ? { groups } : {}),
      // 公司設定（ADR-0157）：歡迎詞/班表隨名冊簽章分發。
      ...(profile?.welcome ? { welcome: profile.welcome } : {}),
      ...(profile?.workHours ? { workHours: profile.workHours } : {}),
      // ADR-0156：嚴格遞增——同一秒內連續核准（多名員工同時貼碼入職）時，`updatedAt` 相同
      // 會讓 NIP-01 取代語意 tie-break 不收斂（中繼可能拒收較新份、成員端 shouldAdopt 也不採用）。
      updatedAt: Math.max(nowSec(), (this.lastRoster?.updatedAt ?? 0) + 1),
    };
    const evt = signOrgRoster(doc, this.sk);
    this.client.publish(evt);
    this.lastRoster = doc; // 自身也記錄，避免採用自己較舊的
    // 管理者本機立即對帳，否則因 lastRoster 已設而不會再採用自己的名冊、看不到剛發布的群。
    if (this.applyRotations(doc)) {
      // ADR-0052：管理者自身若也認得被輪替的舊 npub，一併接續。
      this.contacts = this.storage.loadContacts();
      this.emitContacts();
    }
    this.reconcileOrgGroups(doc);
    return rosterAllowlist(doc);
  }

  /**
   * 入職請求送出（ADR-0156 成員側）：名冊尚未包含自己 → 把 `{name, token}` 加密送給
   * 管理者。每次開機呼叫一次；lastRoster 只在記憶體，故已在冊者開機仍可能重送——
   * 冪等（管理者對已在冊者忽略），把「管理者離線／先建成員後發名冊」等時序全化為自癒。
   */
  private maybeSendOrgJoin(): void {
    const admin = this.orgAdminPubkey;
    if (!admin || !this.orgJoinToken) return;
    if (this.lastRoster?.members.some((m) => m.pubkey === this.self.pubkey)) return; // 已在冊
    // ADR-0163：公司帳號附上 nsec 託管（整包 E2E 給管理者）；一般工作身分不帶。
    const escrow = this.orgEscrowSelf && this.selfNsec ? { nsec: this.selfNsec } : {};
    this.publishReliable(
      wrapOrgJoin(
        { name: this.self.name, token: this.orgJoinToken, ...escrow },
        this.sk,
        admin,
        this.homeUrl ? { relayHint: this.homeUrl } : {},
      ),
    );
  }

  /**
   * 入職請求處理（ADR-0156 管理者側）：只有企業主身分、權杖相符才理會——權杖是
   * capability，撿到管理者 npub 的人不能憑空入冊。名冊已到位 → 立即核准；
   * 首份名冊尚未發佈 → 排隊（發佈時自動併入）。
   */
  private handleOrgJoin(sender: PubkeyHex, join: { name: string; token: string; nsec?: string }): void {
    if (!this.orgOwnerFlag || !this.orgInviteToken || join.token !== this.orgInviteToken) return;
    if (sender === this.self.pubkey || this.isBlocked(sender)) return;
    // ADR-0163：金鑰託管——nsec 必須對回寄件人 pubkey（防塞入他人金鑰）；相符才交 App 持久化。
    if (join.nsec) {
      try {
        if (getPublicKey(nsecDecode(join.nsec)) === sender) {
          this.handlers?.onOrgEscrow?.({ pubkey: sender, name: join.name, nsec: join.nsec, relayUrl: this.homeUrl ?? "" });
        }
      } catch {
        /* 壞 nsec：忽略託管，入職照常 */
      }
    }
    if (this.lastRoster) this.approveJoin(sender, join.name);
    else this.pendingJoins.set(sender, join.name);
  }

  /** 核准入職（ADR-0156）：併入名冊重新簽發（已在冊者跳過），並確保成為聯絡人（互送個人檔）。 */
  private approveJoin(pubkey: PubkeyHex, name: string): void {
    const r = this.lastRoster;
    if (!r) return;
    if (this.isBlocked(pubkey)) return; // 審查修正：封鎖者不核准入冊（與 handleOrgJoin 一致）
    if (!r.members.some((m) => m.pubkey === pubkey)) {
      // 公司設定（ADR-0157）一併帶上——自動核准重發不得洗掉歡迎詞/班表。
      this.publishRoster(r.org, [...r.members, { pubkey, name }], r.policy, r.groups, {
        ...(r.welcome ? { welcome: r.welcome } : {}),
        ...(r.workHours ? { workHours: r.workHours } : {}),
      });
    }
    this.ensureJoinContact(pubkey, name);
  }

  /** 現行名冊（ADR-0157，企業主）：名冊管理視窗預填用；未發佈/找回前為 null。 */
  currentRoster(): OrgRosterDoc | null {
    return this.lastRoster;
  }

  /**
   * 組織保留政策的外層過期（ADR-0160）：名冊政策有 `messageTtlDays` 才蓋
   * （成員＝採用的名冊；企業主＝自己發佈的名冊）；未設回空物件（沿用預設 7 天）。
   */
  private orgExpiration(now: number): { expiration: number } | Record<string, never> {
    const ttl = policyTtlSeconds(this.lastRoster?.policy);
    return ttl !== undefined ? { expiration: now + ttl } : {};
  }

  /** 新成員直接成為管理者的聯絡人（帶名冊名，非 shortNpub），並清掉可能先到的訊息請求。 */
  private ensureJoinContact(pubkey: PubkeyHex, name: string): void {
    if (this.isBlocked(pubkey) || this.contacts.some((c) => c.pubkey === pubkey)) return;
    this.storage.addContact({ pubkey, name });
    this.storage.removeRequest(pubkey);
    this.contacts = this.storage.loadContacts();
    this.requests = this.storage.loadRequests();
    this.resubscribe();
    this.emitContacts();
    this.emitRequests();
    this.sendProfileTo(pubkey); // 名字/頭像（ADR-0061/0154）立即互通
  }

  createGroup(name: string, memberPubkeys: PubkeyHex[]): void {
    const members = [this.self.pubkey, ...memberPubkeys.filter((p) => p !== this.self.pubkey)];
    const group: Group = { id: newGroupId(), name: name.trim() || "群組", admin: this.self.pubkey, members };
    this.storage.saveGroup(group);
    this.groups = this.storage.loadGroups();
    for (const m of members) if (m !== this.self.pubkey) this.ensureContact(m);
    const control: GroupControl = {
      type: "group-create",
      id: group.id,
      name: group.name,
      admin: group.admin,
      members,
    };
    this.publishControl(control, members.filter((m) => m !== this.self.pubkey));
    this.emitGroups();
  }

  sendGroupMessage(groupId: string, text: string, mentions?: PubkeyHex[], replyTo?: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return;
    if (!canPostToGroup(group, this.self.pubkey)) return; // 公告群僅管理者可發（ADR-0049）
    // 只保留確實在群內的提及對象（避免對非成員扇出 p-tag）。
    const validMentions = mentions?.filter((pk) => group.members.includes(pk)) ?? [];
    // id＝內層 rumor id：**跨成員一致**（外層 wrap id 每人不同），送達/已讀回條才對得回來（ADR-0095）。
    const now = nowSec(); // 同一個送出時間寫進 rumor 也當本機 `at`（ADR-0108）
    const wrapped = wrapGroupMessage(text, this.sk, this.self.pubkey, group, {
      now,
      ...this.orgExpiration(now), // ADR-0160：組織保留政策
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
      ...(validMentions.length > 0 ? { mentions: validMentions } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    this.seenMsg.add(wrapped.id);
    const id = wrapped.id;
    const extra = { sender: this.self.pubkey, ...(replyTo ? { replyTo } : {}) };
    const status = "sending" as const;
    const message = { id, contact: groupId, outgoing: true, text, at: now * 1000, status, ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(groupId, { id, outgoing: true, text, at: message.at, status, ...extra });
    // 扇出腿計狀態（ADR-0095）；另含一份自封副本讓自己的其他裝置也看得到（ADR-0107）。
    this.publishWrapped(groupId, id, wrapped);
  }

  /**
   * 群控扇出（ADR-0107）：收件人一律**外加自己**。
   *
   * 沒有這一步，自己的其他裝置**不知道群組存在**——`receiveGroup` 會以「未知群組」丟棄
   * 群訊的自封副本，讓群訊自封形同無效（群控只發給成員，從不含自己）。
   *
   * 另一台裝置由 `applyControl` 以 `from = 自己` 處理，語意自然正確：建群時 admin 就是自己；
   * 離群 → 那台也離群；增/刪成員 → 那台同步收斂。皆為冪等。
   */
  private publishControl(control: GroupControl, recipients: PubkeyHex[]): void {
    const hint = this.homeUrl ? { relayHint: this.homeUrl } : {};
    for (const evt of wrapGroupControl(control, this.sk, [...recipients, this.self.pubkey], hint)) {
      this.publishReliable(evt);
    }
  }

  /**
   * 送出一則訊息的全部 Gift Wrap（ADR-0107）。
   *
   * 送出狀態**只追蹤定址給對方的 wrap**（`events`）：`sent` 的語意是「已進中繼、在往對方的路上」。
   * 若把自封副本也算進去，會出現「只有自封副本成功、給對方的那份失敗」卻標成 `sent` 的謊報。
   * 自封副本因此是 best-effort——它的 event id 不在 `fanout` 裡，放棄時 `markFailed` 找不到、
   * 自然不影響狀態。
   */
  private publishWrapped(convo: string, messageId: string, wrapped: WrappedMessage): void {
    this.trackFanout(convo, messageId, wrapped.events);
    for (const evt of wrapped.events) this.publishReliable(evt);
    this.publishReliable(wrapped.selfCopy);
  }

  /**
   * 追蹤扇出的送出狀態（ADR-0095）：把每個 wrap 的 event id 對回同一則訊息。
   * 任一 OK → `sent`（樂觀：至少進了中繼）；全部放棄 → `failed`。
   * 1:1 亦走此路（events 長度為 1），與群訊語意相同。
   */
  private trackFanout(convo: string, messageId: string, events: NostrEvent[]): void {
    if (events.length === 0) {
      this.setMsgStatus(convo, messageId, "failed"); // 無其他成員可送＝送不出去
      return;
    }
    const state = { convo, messageId, pending: events.length, ok: false };
    for (const evt of events) this.fanout.set(evt.id, state);
  }

  leaveGroup(groupId: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return;
    // 含自己（ADR-0107）：在一台裝置離群 → 自己的其他裝置也離群。
    this.publishControl({ type: "group-leave", id: groupId }, group.members.filter((m) => m !== this.self.pubkey));
    this.storage.removeGroup(groupId);
    this.groups = this.storage.loadGroups();
    this.emitGroups();
  }

  /** 管理者新增群組成員（M9 成員管理）：既有成員收 group-add、新成員收 group-create 以實例化群。 */
  addGroupMember(groupId: string, pubkey: PubkeyHex): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group || group.admin !== this.self.pubkey) return; // 僅管理者可管理成員
    if (group.org) return; // 組織群由名冊權威管理（ADR-0049），不手動增/移
    if (group.members.includes(pubkey)) return;
    const members = [...group.members, pubkey];
    this.storage.saveGroup({ ...group, members });
    this.groups = this.storage.loadGroups();
    this.ensureContact(pubkey);
    const hint = this.homeUrl ? { relayHint: this.homeUrl } : {};
    // 既有成員 ＋ 自己的其他裝置（ADR-0107）收 group-add。
    this.publishControl(
      { type: "group-add", id: groupId, member: pubkey },
      group.members.filter((m) => m !== this.self.pubkey),
    );
    // 新成員尚無此群，送 group-create 讓其實例化（帶完整成員清單）。不含自己：我已有此群。
    const create: GroupControl = { type: "group-create", id: groupId, name: group.name, admin: this.self.pubkey, members };
    for (const evt of wrapGroupControl(create, this.sk, [pubkey], hint)) this.publishReliable(evt);
    this.emitGroups();
  }

  /** 管理者移除群組成員（M9）：所有原成員（含被移除者）收 group-remove。 */
  removeGroupMember(groupId: string, pubkey: PubkeyHex): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group || group.admin !== this.self.pubkey) return; // 僅管理者
    if (group.org) return; // 組織群由名冊權威管理（ADR-0049），不手動增/移
    if (pubkey === this.self.pubkey) return; // 管理者自身請用離開/解散
    if (!group.members.includes(pubkey)) return;
    const members = group.members.filter((m) => m !== pubkey);
    this.storage.saveGroup({ ...group, members });
    this.groups = this.storage.loadGroups();
    // 收件人含被移除者（令其客戶端退群）與自己的其他裝置（ADR-0107）。
    this.publishControl(
      { type: "group-remove", id: groupId, member: pubkey },
      group.members.filter((m) => m !== this.self.pubkey),
    );
    this.emitGroups();
  }

  startCall(to: PubkeyHex, media: CallMedia): void {
    this.call.startCall(to, media);
  }
  acceptCall(): void {
    this.call.accept();
  }
  rejectCall(): void {
    this.call.reject();
  }
  hangupCall(): void {
    this.call.hangup();
  }

  sendTyping(to: PubkeyHex): void {
    // F5 卸載：P2P 通道已開時走 Data Channel，否則退回中繼。
    if (this.transfer.sendTyping(to)) return;
    this.publishAddressed(createTyping(this.sk, to));
  }

  /** 開啟對話時主動建立 P2P 通道（讓後續輸入中等狀態可卸載中繼）。 */
  connectPeer(to: PubkeyHex): void {
    if (this.isBlocked(to)) return;
    this.transfer.connect(to);
  }

  sendNudge(to: PubkeyHex): void {
    this.publishAddressed(createNudge(this.sk, to)); // ADR-0120：封裝，不再用真名廣播指名事件
  }

  stop(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    if (this.snapTimer) clearInterval(this.snapTimer);
    if (this.retireTimer !== undefined) clearTimeout(this.retireTimer);
    this.outbox.clear();
    this.transfer.close();
    this.call.close();
    // **關閉所有中繼連線**（ADR-0119）。舊版只清計時器、不關 socket——而 `close()` 是**唯一**
    // 會設 `stopped = true` 的地方，於是登出/切換身分後那些 WebSocket 會**永遠自動重連**。
    // 行動端每次登入都先 `stop()` 再建新後端 → 孤兒 socket 隨身分切換累積。
    this.client.close?.();
    for (const client of this.relayPool.values()) client.close?.();
    this.relayPool.clear();
    this.handlers = null;
  }
}
