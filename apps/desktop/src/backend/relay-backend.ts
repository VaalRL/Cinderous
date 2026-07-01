import {
  createHeartbeat,
  createMusicStatus,
  createTyping,
  deletionTarget,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  KIND,
  messageExpiry,
  npubDecode,
  npubEncode,
  nsecDecode,
  nsecEncode,
  NowPlayingStore,
  PresenceTracker,
  reactionTarget,
  RelayClient,
  unwrapMessage,
  wrapDeletion,
  wrapMessage,
  wrapReaction,
  type NostrEvent,
  type PubkeyHex,
  type RelayClientHandlers,
  type SecretKey,
} from "@nostr-buddy/core";
import type { AppStorage } from "../storage/types.js";
import type { ChatBackend, ChatBackendEvents, Contact, Self, Status } from "./types.js";

const NUDGE_KIND = 20100;
const HEARTBEAT_MS = 15_000;
const PRESENCE_TIMEOUT_MS = 45_000;
const nowSec = () => Math.floor(Date.now() / 1000);

interface StatusPayload {
  s: Status;
  m: string;
}
function encodeStatus(status: Status, message: string): string {
  return JSON.stringify({ s: status, m: message } satisfies StatusPayload);
}
function decodeStatus(content: string): StatusPayload {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "s" in parsed) {
      const p = parsed as Record<string, unknown>;
      if (p.s === "online" || p.s === "away" || p.s === "busy") {
        return { s: p.s, m: typeof p.m === "string" ? p.m : "" };
      }
    }
  } catch {
    /* 視為純文字 */
  }
  return { s: "online", m: content };
}

const shortNpub = (npub: string) => `${npub.slice(0, 12)}…`;

/** 建立一個已接好收發的 RelayClient（真實 WebSocket 或測試替身）。 */
export type RelayConnector = (handlers: RelayClientHandlers) => RelayClient;

/** 以真實 WebSocket 連上 relay 的連接器。 */
export function webSocketConnector(url: string): RelayConnector {
  return (handlers) => {
    const ws = new WebSocket(url);
    const pending: string[] = [];
    let open = false;
    ws.addEventListener("open", () => {
      open = true;
      for (const m of pending) ws.send(m);
      pending.length = 0;
    });
    const client = new RelayClient(
      { send: (data) => (open ? ws.send(data) : pending.push(data)) },
      handlers,
    );
    ws.addEventListener("message", (e: MessageEvent) => {
      client.receive(typeof e.data === "string" ? e.data : "");
    });
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
  private readonly sk: SecretKey;
  private readonly client: RelayClient;
  private readonly presence = new PresenceTracker();
  private readonly music = new NowPlayingStore();
  private readonly statuses = new Map<PubkeyHex, StatusPayload>();
  private readonly seenMsg = new Set<string>();
  private contacts: { pubkey: PubkeyHex; name: string }[];
  private blocked: { pubkey: PubkeyHex; name: string }[];
  private handlers: ChatBackendEvents | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
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
    this.contacts = storage.loadContacts();
    this.blocked = storage.loadBlocked();
    this.client = connector({ onEvent: (_sub, event) => this.onEvent(event) });
  }

  start(handlers: ChatBackendEvents): void {
    this.handlers = handlers;
    this.resubscribe();
    this.beat();
    this.heartbeatTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
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
    this.emitBlocked();
  }

  private resubscribe(): void {
    const authors = this.contacts.map((c) => c.pubkey);
    this.client.subscribe("presence", [{ kinds: [KIND.HEARTBEAT], authors }]);
    this.client.subscribe("music", [{ kinds: [KIND.MUSIC], authors }]);
    this.client.subscribe("typing", [{ kinds: [KIND.TYPING], authors, "#p": [this.self.pubkey] }]);
    this.client.subscribe("nudge", [{ kinds: [NUDGE_KIND], authors, "#p": [this.self.pubkey] }]);
    this.client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [this.self.pubkey] }]);
  }

  private beat(): void {
    if (this.self.status === "offline") return;
    this.client.publish(
      createHeartbeat(this.sk, { status: encodeStatus(this.self.status, this.self.statusMessage) }),
    );
  }

  private onEvent(event: NostrEvent): void {
    switch (event.kind) {
      case KIND.HEARTBEAT:
        this.presence.observe(event.pubkey, event.created_at);
        this.statuses.set(event.pubkey, decodeStatus(event.content));
        return;
      case KIND.MUSIC:
        this.music.observe(event.pubkey, event.content, event.created_at);
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
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
  }

  blockContact(pubkey: PubkeyHex): void {
    const existing = this.contacts.find((c) => c.pubkey === pubkey);
    const name = existing?.name ?? shortNpub(npubEncode(pubkey));
    this.storage.blockContact({ pubkey, name });
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
        nowPlaying: online ? this.music.statusOf(c.pubkey) ?? "" : "",
      };
    });
    this.handlers.onContacts(contacts);
  }

  setStatus(status: Status, message?: string): void {
    this.self.status = status;
    if (message !== undefined) this.self.statusMessage = message;
    if (status !== "offline") this.beat();
  }

  setNowPlaying(text: string): void {
    this.client.publish(createMusicStatus(this.sk, text));
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

  sendTyping(to: PubkeyHex): void {
    this.client.publish(createTyping(this.sk, to));
  }

  sendNudge(to: PubkeyHex): void {
    this.client.publish(
      finalizeEvent({ kind: NUDGE_KIND, created_at: nowSec(), tags: [["p", to]], content: "nudge" }, this.sk),
    );
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    this.handlers = null;
  }
}
