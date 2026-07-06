import {
  applyGroupControl,
  BoundedSet,
  canPostToGroup,
  CALL_SIGNAL_KIND,
  createHeartbeat,
  createTyping,
  decodePresence,
  deletionTarget,
  encodePresence,
  finalizeEvent,
  groupTarget,
  generateSecretKey,
  getPublicKey,
  isMentioned,
  jitter,
  KIND,
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
  rosterAllowlist,
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
  wrapReaction,
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
  type PresenceState,
  type PubkeyHex,
  type RelayClientHandlers,
  type RelayListDoc,
  type Rumor,
  type SecretKey,
} from "@nostr-buddy/core";
import { WebRtcCall } from "./webrtc-call.js";
import { WebRtcTransfer } from "./webrtc.js";
import type { AppStorage } from "../storage/types.js";
import type {
  ChatBackend,
  ChatBackendEvents,
  ConnectionState,
  Contact,
  Self,
  Status,
} from "./types.js";

const NUDGE_KIND = 20100;
const HEARTBEAT_MS = 15_000;
/** pool relay 連續離線超過此時間即標記 hint 可能陳舊（ADR-0036）。 */
export const RELAY_STALE_MS = 5 * 60_000;
/** 主路由離線時的冗餘廣播座數上限（ADR-0039）。 */
export const REDUNDANT_K = 2;
const PRESENCE_TIMEOUT_MS = 45_000;
const nowSec = () => Math.floor(Date.now() / 1000);

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…`;

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
  return u && /^wss?:\/\//i.test(u) ? u : undefined;
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
  /** 引導座（錨點 ∪ 已採用清單，ADR-0039）：恆連保底、冗餘廣播與 home 遞補來源。 */
  private readonly bootstrapSeats = new Set<string>();
  private readonly maintainerPubkey: string | undefined;
  /** 企業名冊管理者公鑰與最近採用的名冊（ADR-0047）。 */
  private readonly orgAdminPubkey: string | undefined;
  private lastRoster: OrgRosterDoc | null = null;
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
  // 訊息去重（審查 P1-4）：有界，逐出最舊；儲存層與 UI 層另有去重兜底。
  private readonly seenMsg = new BoundedSet<string>(8192, 4096);
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
    this.connectorFor = pool?.connectorFor;
    this.maintainerPubkey = pool?.maintainerPubkey;
    this.orgAdminPubkey = pool?.orgAdminPubkey;
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
    if (!identity) {
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
        // 明確拒收或重試耗盡：目前記錄告警（未來可接 UI「未送達」提示）。
        console.warn(`[outbox] 事件 ${evt.id.slice(0, 8)}… 未送達：${reason}`);
      },
    });
    this.client = connector(
      {
        onEvent: (_sub, event) => this.onEvent(event),
        onOk: (id, accepted, message) => this.outbox.onOk(id, accepted, message),
      },
      (state) => this.onConnection(state),
    );
    this.transfer = new WebRtcTransfer(this.sk, {
      publishSignal: (evt) => this.publishAddressed(evt),
      onOutgoingProgress: (peer, id, sent, total) => this.handlers?.onFileProgress?.(peer, id, sent, total),
      onIncoming: (peer, file) => {
        if (this.isBlocked(peer)) return;
        this.ensureContact(peer);
        this.handlers?.onFileReceived?.(peer, file);
      },
      onTyping: (peer) => {
        if (!this.isBlocked(peer)) this.handlers?.onTyping(peer);
      },
      onError: (peer, reason) => this.handlers?.onFileError?.(peer, reason),
    });
    this.call = new WebRtcCall(
      this.sk,
      {
        publishCallSignal: (evt) => this.publishAddressed(evt),
        onState: (peer, state, media) => this.handlers?.onCallState?.(peer, state, media),
        onLocalStream: (stream) => this.handlers?.onCallLocalStream?.(stream),
        onRemoteStream: (stream) => this.handlers?.onCallRemoteStream?.(stream),
        onError: (reason) => this.handlers?.onFileError?.(this.self.pubkey, reason),
      },
      undefined,
      (pubkey) => this.isBlocked(pubkey),
    );
  }

  start(handlers: ChatBackendEvents): void {
    this.handlers = handlers;
    this.resubscribe();
    this.beat();
    this.scheduleBeat();
    this.renderTimer = setInterval(() => {
      this.emitContacts();
      this.maybeSucceedHome(); // home 長期離線 → 自動遞補健康引導座（ADR-0039）
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
      handlers.onHistory?.(
        c.pubkey,
        msgs.map((m) => ({
          id: m.id,
          outgoing: m.outgoing,
          text: m.text,
          at: m.at,
          ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}),
          ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}),
        })),
      );
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
      handlers.onHistory?.(
        g.id,
        msgs.map((m) => ({
          id: m.id,
          outgoing: m.outgoing,
          text: m.text,
          at: m.at,
          ...(m.sender !== undefined ? { sender: m.sender } : {}),
          ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}),
          ...(m.mentionsMe ? { mentionsMe: true } : {}),
          ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}),
        })),
      );
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
        { onEvent: (_sub, event) => this.onEvent(event) },
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
  }

  /**
   * 採用帶內收到的管理者組織名冊（ADR-0047）：驗簽已在 onEvent 完成。
   * 工作身分聯絡人由名冊**權威管理**——移除名冊外者（撤銷/離職）、匯入名冊成員。
   */
  private adoptRoster(doc: OrgRosterDoc): void {
    if (!shouldAdoptRoster(this.lastRoster, doc)) return;
    this.lastRoster = doc;
    if (doc.policy) this.handlers?.onPolicy?.(doc.policy); // 企業政策（ADR-0048）
    const self = this.self.pubkey;
    const desired = doc.members.filter((m) => m.pubkey !== self);
    const desiredKeys = new Set(desired.map((m) => m.pubkey));
    let changed = false;
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
    if (this.self.status === "offline") return;
    const payload: PresencePayload = {
      s: this.self.status as PresenceState,
      m: this.self.statusMessage,
      np: this.nowPlaying,
    };
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

    const groupId = groupTarget(rumor);
    if (groupId) {
      this.receiveGroup(event.id, sender, rumor, groupId);
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
  }

  /** 處理帶 `g` tag 的群組訊息/控制。 */
  private receiveGroup(eventId: string, sender: PubkeyHex, rumor: Rumor, groupId: string): void {
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
    const message = { id: eventId, contact: groupId, outgoing: false, text: rumor.content, at: Date.now(), ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(groupId, { id: eventId, outgoing: false, text: rumor.content, at: message.at, ...extra });
  }

  private applyControl(from: PubkeyHex, control: GroupControl): void {
    if (control.type === "group-create") {
      // 授權/同意檢查：封鎖者不得拉你入群；你不在名單就不加入；不重複建立。
      if (this.isBlocked(from)) return;
      if (!control.members.includes(this.self.pubkey)) return;
      if (this.groups.some((g) => g.id === control.id)) return;
      // 管理者強制為驗證後的寄件人（不信任 payload 的 admin 欄位）；
      // 不自動把其他成員塞進個人聯絡人（避免被強行灌入聯絡人清單）。
      this.storage.saveGroup({ id: control.id, name: control.name, admin: from, members: control.members });
      this.groups = this.storage.loadGroups();
      this.emitGroups();
      return;
    }
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
    if (this.isBlocked(pubkey) || this.contacts.some((c) => c.pubkey === pubkey)) return;
    const hint = normalizeRelayUrl(relayUrl ?? inlineHint);
    this.storage.addContact({
      pubkey,
      name: shortNpub((rawNpub ?? "").trim()),
      ...(hint && hint !== this.homeUrl ? { relayUrl: hint } : {}),
    });
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
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
    this.publishReliable(evt);
    const extra = {
      ...(disappearAt !== undefined ? { expiresAt: disappearAt * 1000 } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    const message = { id: evt.id, contact: to, outgoing: true, text, at: Date.now(), ...extra };
    this.seenMsg.add(evt.id);
    this.storage.appendMessage(message);
    this.handlers?.onMessage(to, { id: evt.id, outgoing: true, text, at: message.at, ...extra });
  }

  sendReaction(to: PubkeyHex, messageId: string, emoji: string): void {
    const evt = wrapReaction(emoji, this.sk, to, messageId);
    this.publishReliable(evt);
    this.seenMsg.add(evt.id);
    this.storage.addReaction({ id: evt.id, messageId, emoji, mine: true });
    this.handlers?.onReaction?.(messageId, emoji, true);
  }

  unsendMessage(to: PubkeyHex, messageId: string): void {
    const evt = wrapDeletion(this.sk, to, messageId);
    this.publishReliable(evt);
    this.seenMsg.add(evt.id);
    this.storage.markDeleted(messageId);
    this.handlers?.onUnsend?.(messageId);
  }

  sendFile(to: PubkeyHex, file: OutgoingFile): string {
    return this.transfer.sendFile(to, file);
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
    const evts = wrapGroupMessage(text, this.sk, this.self.pubkey, group, {
      ...(this.homeUrl ? { relayHint: this.homeUrl } : {}),
      ...(validMentions.length > 0 ? { mentions: validMentions } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    for (const evt of evts) this.publishReliable(evt);
    const id = evts[0]?.id ?? `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.seenMsg.add(id);
    const extra = { sender: this.self.pubkey, ...(replyTo ? { replyTo } : {}) };
    const message = { id, contact: groupId, outgoing: true, text, at: Date.now(), ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(groupId, { id, outgoing: true, text, at: message.at, ...extra });
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
    this.outbox.clear();
    this.transfer.close();
    this.call.close();
    this.handlers = null;
  }
}
