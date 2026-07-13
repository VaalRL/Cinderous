import {
  applyGroupControl,
  BoundedSet,
  buildAuthEvent,
  canPostToGroup,
  CALL_SIGNAL_KIND,
  createHeartbeat,
  createTyping,
  decodePresence,
  deletionTarget,
  encodePresence,
  finalizeEvent,
  groupTarget,
  groupReceiptMode,
  generateSecretKey,
  getPublicKey,
  isMentioned,
  jitter,
  KIND,
  listEntries,
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
  SDP_SIGNAL_KIND,
  threadRoot,
  unwrapMessage,
  wrapDeletion,
  wrapGroupControl,
  wrapGroupMessage,
  wrapMessage,
  wrapFileMessage,
  parseFileMeta,
  wrapReaction,
  wrapReceipt,
  receiptOf,
  wrapProfile,
  parseProfile,
  type CallMedia,
  type Group,
  type GroupControl,
  type NostrEvent,
  type OrgGroup,
  type OrgMember,
  type OrgPolicy,
  type OrgRosterDoc,
  type OutgoingFile,
  type PresencePayload,
  type ReceiptType,
  type PresenceState,
  type PubkeyHex,
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

const NUDGE_KIND = 20100;
// 心跳間隔（ADR-0059）：30 秒——降低中繼站請求數/CPU；離線判定門檻同步放寬保留 3× 容忍。
const HEARTBEAT_MS = 30_000;
/** pool relay 連續離線超過此時間即標記 hint 可能陳舊（ADR-0036）。 */
export const RELAY_STALE_MS = 5 * 60_000;
/** 主路由離線時的冗餘廣播座數上限（ADR-0039）。 */
export const REDUNDANT_K = 2;
const PRESENCE_TIMEOUT_MS = 90_000; // 3× 心跳（30s）：容忍偶發丟包/抖動，不因單次遲到就翻離線（ADR-0059）
const nowSec = () => Math.floor(Date.now() / 1000);

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…`;

/**
 * 持久化訊息 → UI 訊息映射（含檔案附件，ADR-0093）。檔案訊息不含位元組：
 * `sent`＝已送出（outgoing）或已存本機（有 savedPath）時為 size，否則 0（metadata-only，
 * 例：位元組落在另一台裝置）；`url` 於重載後永遠沒有（App 不保管位元組）。
 */
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
  /** 企業 TURN 伺服器（ADR-0048）：供強制 TURN 政策使用；relay-only 時的 ICE 中繼。 */
  turnServers?: RTCIceServer[];
  /**
   * 私鑰由外部（OS 金鑰庫）提供而非 localStorage（B5，ADR-0053）。設定後以此為身分
   * 私鑰、**不寫入** identity blob；未設則沿用既有行為（從 storage 讀/自動產生）。
   */
  nsecOverride?: string;
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
  private readonly client: RelayClient;
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
  /** 已送出、待 relay OK 的訊息 id → 收件人（供 OK 後標 sent）。 */
  private readonly awaitingSent = new Map<string, PubkeyHex>();
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
  private contacts: { pubkey: PubkeyHex; name: string; relayUrl?: string }[];
  private blocked: { pubkey: PubkeyHex; name: string }[];
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
      const sk = generateSecretKey();
      identity = { nsec: nsecEncode(sk), name: name?.trim() || "我" };
      storage.saveIdentity(identity);
    } else if (name && name.trim() && name.trim() !== identity.name) {
      identity = { ...identity, name: name.trim() };
      storage.saveIdentity(identity);
    }
    this.sk = nsecDecode(identity.nsec);
    const pubkey = getPublicKey(this.sk);
    this.self = { pubkey, name: identity.name, status: "online", statusMessage: "" };
    this.selfNpub = npubEncode(pubkey);
    this.selfNsec = identity.nsec;
    this.contacts = storage.loadContacts();
    this.blocked = storage.loadBlocked();
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
        onEvent: (_sub, event) => this.onEvent(event),
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
        this.ensureContact(peer);
        this.onFileBytes(peer, file);
      },
      onTyping: (peer) => {
        if (!this.isBlocked(peer)) this.handlers?.onTyping(peer);
      },
      onPresence: (peer, p) => {
        // ADR-0088 (e)：P2P 收到的在線狀態與 relay 心跳同源處理（同一 60s 判離線狀態機，避免雙來源閃爍）。
        if (this.isBlocked(peer)) return;
        this.presence.observe(peer, nowSec());
        this.statuses.set(peer, { s: p.s as PresenceState, m: p.m, np: p.np });
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
          onEvent: (_sub, event) => this.onEvent(event),
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
  private subscribeOn(client: RelayClient, url: string | undefined): void {
    const authors = this.contacts
      .filter((c) => (this.foreignUrlOf(c) ?? this.homeUrl) === url)
      .map((c) => c.pubkey);
    // F5：presence 心跳已彙整音樂狀態（np），不再單獨訂閱 MUSIC。
    client.subscribe("presence", [{ kinds: [KIND.HEARTBEAT], authors }]);
    const all = this.contacts.map((c) => c.pubkey);
    client.subscribe("typing", [{ kinds: [KIND.TYPING], authors: all, "#p": [this.self.pubkey] }]);
    client.subscribe("nudge", [{ kinds: [NUDGE_KIND], authors: all, "#p": [this.self.pubkey] }]);
    client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [this.self.pubkey] }]);
    // 自己的雲端快照（ADR-0071 J3）：接收合併恆開——換機還原不需任何前置設定。
    client.subscribe("snap", [{ kinds: [SNAPSHOT_KIND], authors: [this.self.pubkey] }]);
    client.subscribe("sig", [{ kinds: [SDP_SIGNAL_KIND], "#p": [this.self.pubkey] }]);
    client.subscribe("call", [{ kinds: [CALL_SIGNAL_KIND], "#p": [this.self.pubkey] }]);
    // 帶內引導清單（ADR-0039）：訂閱維護者簽章的 relay 清單事件。
    if (this.maintainerPubkey) {
      client.subscribe("relaylist", [{ kinds: [RELAY_LIST_KIND], authors: [this.maintainerPubkey] }]);
    }
    // 企業組織名冊（ADR-0047）：訂閱管理者簽章的名冊事件。
    if (this.orgAdminPubkey) {
      client.subscribe("orgroster", [{ kinds: [ORG_ROSTER_KIND], authors: [this.orgAdminPubkey] }]);
    }
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
    const payload: PresencePayload = {
      s: this.self.status as PresenceState,
      m: this.self.statusMessage,
      np: this.nowPlaying,
    };
    // (e) P2P 卸載：對已開資料通道的聯絡人，在線狀態直送資料通道、不經 relay（複用 F5 模式）。
    let allP2P = this.contacts.length > 0;
    for (const c of this.contacts) {
      if (!this.transfer.sendPresence(c.pubkey, { s: payload.s, m: payload.m, np: payload.np })) allP2P = false;
    }
    // 心跳抑制（ADR-0088 (e)）：僅當所有聯絡人都有活的 P2P 通道時，才不再經 relay 明簽廣播在線。
    if (allP2P) return;
    const evt = createHeartbeat(this.sk, { status: encodePresence(payload) });
    // 心跳發到 pool 中所有 relay：對方未記錄我的 relay 也看得到我在線（ADR-0034）。
    this.client.publish(evt);
    for (const client of this.relayPool.values()) client.publish(evt);
  }

  /** 以抖動間隔自我重排下一次心跳（F5：分散中繼負載）。 */
  private scheduleBeat(): void {
    this.heartbeatTimer = setTimeout(() => {
      this.beat();
      this.scheduleBeat();
    }, jitter(HEARTBEAT_MS));
  }

  /** 跨 relay 事件去重：已見過回傳 true；容量超限折半清理（保留較新）。 */
  private seenBefore(id: string): boolean {
    if (this.seenEvt.has(id)) return true;
    this.seenEvt.add(id); // BoundedSet 自行修剪
    return false;
  }

  private onEvent(event: NostrEvent): void {
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
    if (event.kind === ORG_ROSTER_KIND) {
      if (this.orgAdminPubkey) {
        const doc = verifyOrgRoster(event, this.orgAdminPubkey);
        if (doc) this.adoptRoster(doc);
      }
      return;
    }
    switch (event.kind) {
      case KIND.HEARTBEAT:
        this.presence.observe(event.pubkey, event.created_at);
        this.statuses.set(event.pubkey, decodePresence(event.content));
        return;
      case KIND.TYPING:
        this.handlers?.onTyping(event.pubkey);
        return;
      case NUDGE_KIND:
        this.handlers?.onNudge(event.pubkey);
        return;
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

  private receiveDm(event: NostrEvent): void {
    if (this.seenMsg.has(event.id)) return;
    this.seenMsg.add(event.id);
    let opened;
    try {
      opened = unwrapMessage(event, this.sk);
    } catch {
      return;
    }
    const { sender, rumor } = opened;
    if (this.isBlocked(sender)) return;

    // 群組路由僅限「群訊/群控」——群組**回條**也帶 `g` tag（ADR-0095），必須落到下方回條處理，
    // 不能被這裡吞掉（否則發訊者永遠收不到群組送達/已讀）。
    const groupId = groupTarget(rumor);
    if (groupId && (rumor.kind === KIND.CHAT || rumor.kind === KIND.GROUP_CONTROL)) {
      this.receiveGroup(sender, rumor, groupId);
      return;
    }

    this.ensureContact(sender);
    this.learnRelayHint(sender, rumor);

    if (rumor.kind === KIND.REACTION) {
      const target = reactionTarget(rumor);
      if (!target) return;
      this.storage.addReaction({ id: event.id, messageId: target, emoji: rumor.content, mine: false });
      this.handlers?.onReaction?.(target, rumor.content, false);
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

    const profileName = parseProfile(rumor);
    if (profileName) {
      // ADR-0061：以對方自選暱稱更新聯絡人顯示名稱（僅在變動時）。
      if (profileName !== this.contacts.find((c) => c.pubkey === sender)?.name) {
        this.storage.updateContactName(sender, profileName);
        this.contacts = this.storage.loadContacts();
        this.emitContacts();
      }
      // 尚未送過自己的個人檔給對方（例如對方單向加我）→ 回送一次，讓對方也學到我的暱稱。
      if (!this.profileSentTo.has(sender)) this.sendProfileTo(sender);
      return;
    }

    const fileMeta = parseFileMeta(rumor);
    if (fileMeta) {
      // 檔案 metadata（ADR-0093）：讓收件人**所有裝置**都知道有檔案；位元組另走 P2P。
      // 以 tid 去重（位元組可能已先到並建了訊息）；仍回送已送達回條讓 sender 有投遞可見度（G3）。
      if (!this.fileMsgByTid.has(fileMeta.tid)) {
        this.ensureFileMessage(sender, fileMeta, { msgId: event.id, outgoing: false, sent: 0 });
      }
      this.publishReliable(wrapReceipt("delivered", this.sk, sender, event.id));
      return;
    }

    const expirySec = messageExpiry(rumor);
    const expiresAt = expirySec !== undefined ? expirySec * 1000 : undefined;
    const replyTo = threadRoot(rumor); // 對話串回覆（ADR-0051）
    const extra = {
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    };
    const message = { id: event.id, contact: sender, outgoing: false, text: rumor.content, at: Date.now(), ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(sender, { id: message.id, outgoing: false, text: rumor.content, at: message.at, ...extra });
    this.publishReliable(wrapReceipt("delivered", this.sk, sender, event.id)); // ADR-0058 Tier 2：已送達回條
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
    if (!g) return; // 未知群組（尚未被加入）
    if (!canPostToGroup(g, sender)) return; // 非成員/公告群非管理者不得發訊（ADR-0049）
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
    const message = { id, contact: groupId, outgoing: false, text: rumor.content, at: Date.now(), ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(groupId, { id, outgoing: false, text: rumor.content, at: message.at, ...extra });
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
    const contact = this.contacts.find((c) => c.pubkey === sender);
    if (!contact || contact.relayUrl === next) return;
    this.storage.updateContactRelay(sender, next);
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
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

  blockContact(pubkey: PubkeyHex): void {
    const existing = this.contacts.find((c) => c.pubkey === pubkey);
    const name = existing?.name ?? shortNpub(npubEncode(pubkey));
    this.storage.blockContact({ pubkey, name });
    this.statuses.delete(pubkey);
    this.blocked = this.storage.loadBlocked();
    this.contacts = this.storage.loadContacts();
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
      const seen = this.presence.lastSeenAt(c.pubkey);
      const online = seen !== undefined && now - seen <= PRESENCE_TIMEOUT_MS;
      const payload = this.statuses.get(c.pubkey);
      return {
        pubkey: c.pubkey,
        name: c.name,
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
    if (status !== "offline") this.beat();
  }

  /** 隱身開關（ADR-0088 (d)）：開＝停止一切在線廣播（relay＋P2P），仍正常收發；關＝立即復出廣播。 */
  setInvisible(invisible: boolean): void {
    this.invisible = invisible;
    if (!invisible) this.beat();
  }

  setNowPlaying(text: string): void {
    // F5：音樂狀態彙整進心跳，不再單獨發事件；更新後立即發一次心跳。
    this.nowPlaying = text;
    this.beat();
  }

  sendMessage(to: PubkeyHex, text: string, ttlSeconds?: number, mentions?: PubkeyHex[], replyTo?: string): void {
    const disappearAt = ttlSeconds ? nowSec() + ttlSeconds : undefined;
    const evt = wrapMessage(text, this.sk, to, {
      ...(disappearAt !== undefined ? { disappearAt } : {}),
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    const extra = {
      ...(disappearAt !== undefined ? { expiresAt: disappearAt * 1000 } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const message = { id: evt.id, contact: to, outgoing: true, text, at: Date.now(), status: "sending" as const, ...extra };
    this.seenMsg.add(evt.id);
    this.storage.appendMessage(message);
    this.handlers?.onMessage(to, { id: evt.id, outgoing: true, text, at: message.at, status: "sending" as const, ...extra });
    // 先存後送：確保同步（測試網路）回來的 OK/回條找得到已存訊息才更新狀態（ADR-0058）。
    this.awaitingSent.set(evt.id, to);
    this.publishReliable(evt);
  }

  sendReaction(to: PubkeyHex, messageId: string, emoji: string): void {
    const evt = wrapReaction(emoji, this.sk, to, messageId);
    this.publishReliable(evt);
    this.seenMsg.add(evt.id);
    this.storage.addReaction({ id: evt.id, messageId, emoji, mine: true });
    this.handlers?.onReaction?.(messageId, emoji, true);
  }

  /** 本 session 已送過個人檔的對象（避免收到對方個人檔時來回反覆傳送）。 */
  private readonly profileSentTo = new Set<PubkeyHex>();

  /** ADR-0061：把自己的顯示名稱（加密個人檔）送給某聯絡人；帶 home hint（ADR-0066）。 */
  private sendProfileTo(pubkey: PubkeyHex): void {
    this.profileSentTo.add(pubkey);
    // hint 讓「每次開機廣播」同時成為全聯絡人的路由刷新——搬家後自動改道、陳舊自癒。
    this.publishReliable(wrapProfile(this.self.name, this.sk, pubkey, this.homeUrl ? { relayHint: this.homeUrl } : {}));
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
    }
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

  /** Tier 1（ADR-0058）：relay 接受某事件＝已送中繼。1:1 直接標；群訊走扇出（任一 OK 即 sent）。 */
  private markSent(eventId: string): void {
    const contact = this.awaitingSent.get(eventId);
    if (contact) {
      this.awaitingSent.delete(eventId);
      this.setMsgStatus(contact, eventId, "sent");
      return;
    }
    const fan = this.fanout.get(eventId);
    if (!fan) return;
    this.fanout.delete(eventId);
    fan.pending -= 1;
    if (fan.ok) return;
    fan.ok = true; // 任一 wrap 進了中繼即視為已送出
    this.setMsgStatus(fan.convo, fan.messageId, "sent");
  }

  /**
   * 送出失敗（ADR-0095）：外送匣重試耗盡或被明確拒收。1:1 直接標 failed；
   * 群訊需**所有** wrap 都放棄且無任一成功才算失敗（部分成員送達仍算送出）。
   */
  private markFailed(eventId: string): void {
    const contact = this.awaitingSent.get(eventId);
    if (contact) {
      this.awaitingSent.delete(eventId);
      this.setMsgStatus(contact, eventId, "failed");
      return;
    }
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
      const upto = msgs.find((m) => m.id === messageId)?.at ?? Infinity;
      for (const m of msgs) {
        if (!m.outgoing || m.at > upto || m.status === "read") continue;
        this.setMsgStatus(from, m.id, "read");
      }
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
    const upto = msgs.find((m) => m.id === messageId)?.at ?? Infinity;
    for (const m of msgs) {
      // 送達只標該則；已讀採水位（把不晚於目標的自己訊息一併標為此成員已讀）。
      if (!m.outgoing) continue;
      if (type === "delivered" ? m.id !== messageId : m.at > upto) continue;
      const receipts = this.storage.setMessageReceipt(groupId, m.id, from, type);
      if (receipts) this.handlers?.onMessageReceipts?.(groupId, m.id, receipts);
    }
  }

  /**
   * 開啟對話時呼叫（ADR-0058 Tier 3）：啟用已讀回條時送「已讀到最新」水位回條。
   * 群組（ADR-0095）：小群才送——且回條要**分別送給每位發訊者**（群訊來自多人），
   * 每人各一則指向「他最新那則」的水位回條；大群完全不送。
   */
  markRead(convo: PubkeyHex): void {
    if (!this.readReceipts) return;
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
    const evt = wrapDeletion(this.sk, to, messageId);
    this.publishReliable(evt);
    this.seenMsg.add(evt.id);
    this.storage.markDeleted(messageId);
    this.handlers?.onUnsend?.(messageId);
  }

  sendFile(to: PubkeyHex, file: OutgoingFile, opts: { thumb?: string; savedPath?: string } = {}): string {
    // 位元組走 P2P（不變）；另發一則加密 metadata 訊息讓對方所有裝置都知道有檔案（ADR-0093）。
    // `thumb` 只存在本機（ADR-0102）——**不進 metadata 訊息、不上中繼**；對方自己從位元組產生。
    const tid = this.transfer.sendFile(to, file);
    const meta = { tid, name: file.name, size: file.bytes.length, mime: file.mime };
    const evt = wrapFileMessage(this.sk, to, meta, this.homeUrl ? { relayHint: this.homeUrl } : {});
    this.seenMsg.add(evt.id);
    // 訊息 id＝metadata 事件 id（供送達/已讀回條對得上，G3）；file.id＝tid（供進度/位元組關聯）。
    this.ensureFileMessage(to, meta, { msgId: evt.id, outgoing: true, sent: 0, status: "sending" });
    if (opts.thumb) this.setFileThumb(to, evt.id, opts.thumb);
    // 送出端原檔路徑（ADR-0103）：原生選檔才有；讓自己送出的圖片重載後也讀得回原圖。
    if (opts.savedPath) this.storage.setFileSavedPath(to, evt.id, opts.savedPath);
    this.awaitingSent.set(evt.id, to);
    this.publishReliable(evt);
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
    opts: { msgId: string; outgoing: boolean; sent: number; status?: MessageStatus },
  ): string {
    const existing = this.fileMsgByTid.get(meta.tid);
    if (existing) return existing.msgId;
    const at = Date.now();
    const stored: StoredMessage = {
      id: opts.msgId,
      contact,
      outgoing: opts.outgoing,
      text: "",
      at,
      file: { tid: meta.tid, name: meta.name, size: meta.size, mime: meta.mime },
      ...(opts.status ? { status: opts.status } : {}),
    };
    this.storage.appendMessage(stored);
    this.fileMsgByTid.set(meta.tid, { contact, msgId: opts.msgId });
    this.handlers?.onMessage(contact, {
      id: opts.msgId,
      outgoing: opts.outgoing,
      text: "",
      at,
      file: { id: meta.tid, name: meta.name, mime: meta.mime, size: meta.size, sent: opts.sent, incoming: !opts.outgoing },
      ...(opts.status ? { status: opts.status } : {}),
    });
    return opts.msgId;
  }

  /** 收到 P2P 檔案位元組（ADR-0093）：關聯到檔案訊息（位元組可能早於 metadata），交 App 另存。 */
  private onFileBytes(peer: PubkeyHex, file: ReceivedFile): void {
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
    this.handlers?.onFileBytes?.(peer, msgId, file);
  }

  /** 回填某檔案訊息收檔後的本機儲存路徑（ADR-0093）：App 另存完成後呼叫，持久化路徑。 */
  setFileSavedPath(contact: PubkeyHex, messageId: string, savedPath: string): void {
    this.storage.setFileSavedPath(contact, messageId, savedPath);
  }

  /**
   * 管理者佈建（ADR-0047）：以自身金鑰簽章並發布組織名冊到中繼；
   * 回傳供 relay `allowedAuthors` 佈建的 pubkey 清單。只有把此身分 pubkey 設為
   * `adminPubkey` 的成員會採用此名冊。
   */
  publishRoster(org: string, members: OrgMember[], policy?: OrgPolicy, groups?: OrgGroup[]): PubkeyHex[] {
    const doc: OrgRosterDoc = {
      org,
      members,
      ...(policy ? { policy } : {}),
      ...(groups && groups.length > 0 ? { groups } : {}),
      updatedAt: nowSec(),
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
    const recipients = members.filter((m) => m !== this.self.pubkey);
    const hint = this.homeUrl ? { relayHint: this.homeUrl } : {};
    for (const evt of wrapGroupControl(control, this.sk, recipients, hint)) this.publishReliable(evt);
    this.emitGroups();
  }

  sendGroupMessage(groupId: string, text: string, mentions?: PubkeyHex[], replyTo?: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return;
    if (!canPostToGroup(group, this.self.pubkey)) return; // 公告群僅管理者可發（ADR-0049）
    // 只保留確實在群內的提及對象（避免對非成員扇出 p-tag）。
    const validMentions = mentions?.filter((pk) => group.members.includes(pk)) ?? [];
    // id＝內層 rumor id：**跨成員一致**（外層 wrap id 每人不同），送達/已讀回條才對得回來（ADR-0095）。
    const { id, events } = wrapGroupMessage(text, this.sk, this.self.pubkey, group, {
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
      ...(validMentions.length > 0 ? { mentions: validMentions } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    this.seenMsg.add(id);
    const extra = { sender: this.self.pubkey, ...(replyTo ? { replyTo } : {}) };
    const status = "sending" as const;
    const message = { id, contact: groupId, outgoing: true, text, at: Date.now(), status, ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(groupId, { id, outgoing: true, text, at: message.at, status, ...extra });
    // 扇出腿的送出狀態（ADR-0095）：任一 wrap 被中繼接受＝sent；全部放棄＝failed。
    this.trackFanout(groupId, id, events);
    for (const evt of events) this.publishReliable(evt);
  }

  /**
   * 追蹤群訊扇出的送出狀態（ADR-0095）：把每個 wrap 的 event id 對回同一則群訊。
   * 任一 OK → `sent`（樂觀：至少進了中繼）；全部放棄 → `failed`。
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
    const recipients = group.members.filter((m) => m !== this.self.pubkey);
    const leaveHint = this.homeUrl ? { relayHint: this.homeUrl } : {};
    for (const evt of wrapGroupControl({ type: "group-leave", id: groupId }, this.sk, recipients, leaveHint)) {
      this.publishReliable(evt);
    }
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
    const existing = group.members.filter((m) => m !== this.self.pubkey);
    for (const evt of wrapGroupControl({ type: "group-add", id: groupId, member: pubkey }, this.sk, existing, hint)) {
      this.publishReliable(evt);
    }
    // 新成員尚無此群，送 group-create 讓其實例化（帶完整成員清單）。
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
    const hint = this.homeUrl ? { relayHint: this.homeUrl } : {};
    const recipients = group.members.filter((m) => m !== this.self.pubkey); // 含被移除者，令其客戶端退群
    for (const evt of wrapGroupControl({ type: "group-remove", id: groupId, member: pubkey }, this.sk, recipients, hint)) {
      this.publishReliable(evt);
    }
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
    this.publishAddressed(
      finalizeEvent({ kind: NUDGE_KIND, created_at: nowSec(), tags: [["p", to]], content: "nudge" }, this.sk),
    );
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
    this.handlers = null;
  }
}
