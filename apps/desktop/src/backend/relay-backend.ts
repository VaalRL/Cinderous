import {
  createHeartbeat,
  createMusicStatus,
  createTyping,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  KIND,
  npubDecode,
  npubEncode,
  nsecDecode,
  nsecEncode,
  NowPlayingStore,
  PresenceTracker,
  RelayClient,
  unwrapMessage,
  wrapMessage,
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
        handlers.onMessage(c.pubkey, { id: m.id, outgoing: m.outgoing, text: m.text, at: m.at });
      }
    }
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
    let sender: PubkeyHex;
    let text: string;
    try {
      const opened = unwrapMessage(event, this.sk);
      sender = opened.sender;
      text = opened.rumor.content;
    } catch {
      return;
    }
    this.ensureContact(sender);
    const message = { id: event.id, contact: sender, outgoing: false, text, at: Date.now() };
    this.storage.appendMessage(message);
    this.handlers?.onMessage(sender, { id: message.id, outgoing: false, text, at: message.at });
  }

  private ensureContact(pubkey: PubkeyHex): void {
    if (this.contacts.some((c) => c.pubkey === pubkey)) return;
    const contact = { pubkey, name: shortNpub(npubEncode(pubkey)) };
    this.storage.addContact(contact);
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
  }

  addContact(npub: string): void {
    const pubkey = npubDecode(npub.trim());
    if (this.contacts.some((c) => c.pubkey === pubkey)) return;
    this.storage.addContact({ pubkey, name: shortNpub(npub.trim()) });
    this.contacts = this.storage.loadContacts();
    this.resubscribe();
    this.emitContacts();
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

  sendMessage(to: PubkeyHex, text: string): void {
    const evt = wrapMessage(text, this.sk, to);
    this.client.publish(evt);
    const message = { id: evt.id, contact: to, outgoing: true, text, at: Date.now() };
    this.seenMsg.add(evt.id);
    this.storage.appendMessage(message);
    this.handlers?.onMessage(to, { id: evt.id, outgoing: true, text, at: message.at });
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
