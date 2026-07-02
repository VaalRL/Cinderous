import {
  applyGroupControl,
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
  jitter,
  KIND,
  messageExpiry,
  npubDecode,
  npubEncode,
  nsecDecode,
  newGroupId,
  nsecEncode,
  parseGroupControl,
  PresenceTracker,
  reactionTarget,
  RelayClient,
  SDP_SIGNAL_KIND,
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
  type OutgoingFile,
  type PresencePayload,
  type PresenceState,
  type PubkeyHex,
  type RelayClientHandlers,
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

const RECONNECT_MAX_MS = 15_000;

/** 以真實 WebSocket 連上 relay 的連接器，含指數退避自動重連與狀態回報。 */
export function webSocketConnector(url: string): RelayConnector {
  return (handlers, onStatus) => {
    let ws: WebSocket;
    let open = false;
    let attempt = 0;
    let pending: string[] = [];

    const client = new RelayClient(
      { send: (data) => (open ? ws.send(data) : pending.push(data)) },
      handlers,
    );

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
export class RelayChatBackend implements ChatBackend {
  readonly self: Self;
  readonly selfNpub: string;
  readonly selfNsec: string;
  private readonly sk: SecretKey;
  private readonly client: RelayClient;
  private readonly presence = new PresenceTracker();
  private readonly statuses = new Map<PubkeyHex, PresencePayload>();
  private nowPlaying = "";
  private lastContactsSig = "";
  private readonly seenMsg = new Set<string>();
  private contacts: { pubkey: PubkeyHex; name: string }[];
  private blocked: { pubkey: PubkeyHex; name: string }[];
  private groups: Group[];
  private readonly transfer: WebRtcTransfer;
  private readonly call: WebRtcCall;
  private handlers: ChatBackendEvents | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private renderTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly storage: AppStorage,
    connector: RelayConnector,
    name?: string,
  ) {
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
    this.client = connector(
      { onEvent: (_sub, event) => this.onEvent(event) },
      (state) => this.onConnection(state),
    );
    this.transfer = new WebRtcTransfer(this.sk, {
      publishSignal: (evt) => this.client.publish(evt),
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
        publishCallSignal: (evt) => this.client.publish(evt),
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
    this.renderTimer = setInterval(() => this.emitContacts(), 1000);
    this.emitContacts();
    // 回放本機持久化的歷史訊息
    for (const c of this.contacts) {
      for (const m of this.storage.loadMessages(c.pubkey)) {
        this.seenMsg.add(m.id);
        handlers.onMessage(c.pubkey, {
          id: m.id,
          outgoing: m.outgoing,
          text: m.text,
          at: m.at,
          ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}),
        });
      }
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
    // 回放群組與其歷史訊息
    this.emitGroups();
    for (const g of this.groups) {
      for (const m of this.storage.loadMessages(g.id)) {
        this.seenMsg.add(m.id);
        handlers.onMessage(g.id, {
          id: m.id,
          outgoing: m.outgoing,
          text: m.text,
          at: m.at,
          ...(m.sender !== undefined ? { sender: m.sender } : {}),
          ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}),
        });
      }
    }
    this.emitBlocked();
  }

  private resubscribe(): void {
    const authors = this.contacts.map((c) => c.pubkey);
    // F5：presence 心跳已彙整音樂狀態（np），不再單獨訂閱 MUSIC。
    this.client.subscribe("presence", [{ kinds: [KIND.HEARTBEAT], authors }]);
    this.client.subscribe("typing", [{ kinds: [KIND.TYPING], authors, "#p": [this.self.pubkey] }]);
    this.client.subscribe("nudge", [{ kinds: [NUDGE_KIND], authors, "#p": [this.self.pubkey] }]);
    this.client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [this.self.pubkey] }]);
    this.client.subscribe("sig", [{ kinds: [SDP_SIGNAL_KIND], "#p": [this.self.pubkey] }]);
    this.client.subscribe("call", [{ kinds: [CALL_SIGNAL_KIND], "#p": [this.self.pubkey] }]);
  }

  private beat(): void {
    if (this.self.status === "offline") return;
    const payload: PresencePayload = {
      s: this.self.status as PresenceState,
      m: this.self.statusMessage,
      np: this.nowPlaying,
    };
    this.client.publish(createHeartbeat(this.sk, { status: encodePresence(payload) }));
  }

  /** 以抖動間隔自我重排下一次心跳（F5：分散中繼負載）。 */
  private scheduleBeat(): void {
    this.heartbeatTimer = setTimeout(() => {
      this.beat();
      this.scheduleBeat();
    }, jitter(HEARTBEAT_MS));
  }

  private onEvent(event: NostrEvent): void {
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
    const extra = expiresAt !== undefined ? { expiresAt } : {};
    const message = { id: event.id, contact: sender, outgoing: false, text: rumor.content, at: Date.now(), ...extra };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(sender, { id: message.id, outgoing: false, text: rumor.content, at: message.at, ...extra });
  }

  /** 處理帶 `g` tag 的群組訊息/控制。 */
  private receiveGroup(eventId: string, sender: PubkeyHex, rumor: Rumor, groupId: string): void {
    if (rumor.kind === KIND.GROUP_CONTROL) {
      const control = parseGroupControl(rumor);
      if (control) this.applyControl(sender, control);
      return;
    }
    if (rumor.kind !== KIND.CHAT) return;
    if (this.isBlocked(sender)) return;
    const g = this.groups.find((gr) => gr.id === groupId);
    if (!g) return; // 未知群組（尚未被加入）
    if (!g.members.includes(sender)) return; // 非成員（含已被移除者）不得發訊
    const expirySec = messageExpiry(rumor);
    const expiresAt = expirySec !== undefined ? expirySec * 1000 : undefined;
    const extra = { sender, ...(expiresAt !== undefined ? { expiresAt } : {}) };
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

  private ensureContact(pubkey: PubkeyHex): void {
    if (this.isBlocked(pubkey)) return;
    if (this.contacts.some((c) => c.pubkey === pubkey)) return;
    const contact = { pubkey, name: shortNpub(npubEncode(pubkey)) };
    this.storage.addContact(contact);
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
  }

  addContact(npub: string): void {
    const pubkey = npubDecode(npub.trim());
    if (this.isBlocked(pubkey) || this.contacts.some((c) => c.pubkey === pubkey)) return;
    this.storage.addContact({ pubkey, name: shortNpub(npub.trim()) });
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

  private emitBlocked(): void {
    this.handlers?.onBlocked?.(this.blocked.map((b) => ({ pubkey: b.pubkey, name: b.name })));
  }

  private onConnection(state: ConnectionState): void {
    this.handlers?.onConnection?.(state);
    // 重連成功後重新訂閱並發送心跳（RelayClient 不會自動重送訂閱）
    if (state === "online" && this.handlers) {
      this.resubscribe();
      this.beat();
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
    const sig = JSON.stringify(contacts);
    if (sig === this.lastContactsSig) return;
    this.lastContactsSig = sig;
    this.handlers.onContacts(contacts);
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

  sendMessage(to: PubkeyHex, text: string, ttlSeconds?: number): void {
    const disappearAt = ttlSeconds ? nowSec() + ttlSeconds : undefined;
    const evt = wrapMessage(text, this.sk, to, disappearAt !== undefined ? { disappearAt } : {});
    this.client.publish(evt);
    const extra = disappearAt !== undefined ? { expiresAt: disappearAt * 1000 } : {};
    const message = { id: evt.id, contact: to, outgoing: true, text, at: Date.now(), ...extra };
    this.seenMsg.add(evt.id);
    this.storage.appendMessage(message);
    this.handlers?.onMessage(to, { id: evt.id, outgoing: true, text, at: message.at, ...extra });
  }

  sendReaction(to: PubkeyHex, messageId: string, emoji: string): void {
    const evt = wrapReaction(emoji, this.sk, to, messageId);
    this.client.publish(evt);
    this.seenMsg.add(evt.id);
    this.storage.addReaction({ id: evt.id, messageId, emoji, mine: true });
    this.handlers?.onReaction?.(messageId, emoji, true);
  }

  unsendMessage(to: PubkeyHex, messageId: string): void {
    const evt = wrapDeletion(this.sk, to, messageId);
    this.client.publish(evt);
    this.seenMsg.add(evt.id);
    this.storage.markDeleted(messageId);
    this.handlers?.onUnsend?.(messageId);
  }

  sendFile(to: PubkeyHex, file: OutgoingFile): string {
    return this.transfer.sendFile(to, file);
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
    for (const evt of wrapGroupControl(control, this.sk, recipients)) this.client.publish(evt);
    this.emitGroups();
  }

  sendGroupMessage(groupId: string, text: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return;
    const evts = wrapGroupMessage(text, this.sk, this.self.pubkey, group);
    for (const evt of evts) this.client.publish(evt);
    const id = evts[0]?.id ?? `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.seenMsg.add(id);
    const message = { id, contact: groupId, outgoing: true, text, at: Date.now(), sender: this.self.pubkey };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(groupId, { id, outgoing: true, text, at: message.at, sender: this.self.pubkey });
  }

  leaveGroup(groupId: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return;
    const recipients = group.members.filter((m) => m !== this.self.pubkey);
    for (const evt of wrapGroupControl({ type: "group-leave", id: groupId }, this.sk, recipients)) {
      this.client.publish(evt);
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
    this.client.publish(createTyping(this.sk, to));
  }

  /** 開啟對話時主動建立 P2P 通道（讓後續輸入中等狀態可卸載中繼）。 */
  connectPeer(to: PubkeyHex): void {
    if (this.isBlocked(to)) return;
    this.transfer.connect(to);
  }

  sendNudge(to: PubkeyHex): void {
    this.client.publish(
      finalizeEvent({ kind: NUDGE_KIND, created_at: nowSec(), tags: [["p", to]], content: "nudge" }, this.sk),
    );
  }

  stop(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    this.transfer.close();
    this.call.close();
    this.handlers = null;
  }
}
