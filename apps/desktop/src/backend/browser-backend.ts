import {
  createHeartbeat,
  createMusicStatus,
  createTyping,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  KIND,
  NowPlayingStore,
  PresenceTracker,
  unwrapMessage,
  wrapMessage,
  type NostrEvent,
  type PubkeyHex,
  type RelayClient,
  type SecretKey,
} from "@nostr-buddy/core";
import { createInMemoryRelayNetwork, MessageStore } from "@nostr-buddy/relay";
import type { ChatBackend, ChatBackendEvents, ChatMessage, Contact, Self, Status } from "./types.js";

const NUDGE_KIND = 20100;
const HEARTBEAT_MS = 2_000;
const PRESENCE_TIMEOUT_MS = 6_000;
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
      const s = p.s;
      if (s === "online" || s === "away" || s === "busy") {
        return { s, m: typeof p.m === "string" ? p.m : "" };
      }
    }
  } catch {
    /* 視為純文字狀態訊息 */
  }
  return { s: "online", m: content };
}

interface BotDef {
  name: string;
  statusMessage: string;
  status: Status;
  nowPlaying: string;
  reply: (text: string) => string;
}

const BOTS: BotDef[] = [
  {
    name: "小幫手",
    statusMessage: "有事按我 (=^･ω･^=)",
    status: "online",
    nowPlaying: "Daft Punk - Digital Love",
    reply: (text) => {
      const t = text.trim();
      if (t.includes("?") || t.includes("？")) return "嗯嗯，好問題～我想想 🤔";
      if (/嗨|你好|hi|hello/i.test(t)) return "嗨嗨！(´• ω •`)ﾉ 在的～";
      if (t.includes("音樂") || t.includes("歌")) return "我正在聽 Daft Punk 🎵 你呢？";
      return `收到啦：「${t}」😎`;
    },
  },
  {
    name: "阿明",
    statusMessage: "工作中，勿擾",
    status: "busy",
    nowPlaying: "",
    reply: (text) => `（阿明忙線中，稍後回你）你說：${text.trim()}`,
  },
];

interface Peer {
  sk: SecretKey;
  pk: PubkeyHex;
  name: string;
}

export class BrowserChatBackend implements ChatBackend {
  readonly self: Self;
  private readonly selfSk: SecretKey;
  private readonly net = createInMemoryRelayNetwork({ store: new MessageStore(), now: nowSec });
  private readonly client: RelayClient;
  private readonly presence = new PresenceTracker();
  private readonly music = new NowPlayingStore();
  private readonly statuses = new Map<PubkeyHex, StatusPayload>();
  private readonly roster: Peer[] = [];
  private readonly defaults = new Map<PubkeyHex, { status: Status; message: string }>();
  private readonly seenMsg = new Set<string>();
  private handlers: ChatBackendEvents | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private renderTimer: ReturnType<typeof setInterval> | undefined;
  private readonly bots: { peer: Peer; def: BotDef; client: RelayClient }[] = [];

  constructor(name: string) {
    this.selfSk = generateSecretKey();
    this.self = { pubkey: getPublicKey(this.selfSk), name, status: "online", statusMessage: "" };
    this.client = this.net.connect("self", { onEvent: (_sub, e) => this.onSelfEvent(e) });

    for (const def of BOTS) {
      const sk = generateSecretKey();
      const peer: Peer = { sk, pk: getPublicKey(sk), name: def.name };
      const client = this.net.connect(peer.pk, { onEvent: (_sub, e) => this.onBotEvent(peer, def, e) });
      this.bots.push({ peer, def, client });
      this.roster.push(peer);
      this.defaults.set(peer.pk, { status: def.status, message: def.statusMessage });
    }
    // 一位永遠離線的朋友，用來呈現「離線」分組
    const offlineSk = generateSecretKey();
    const offline: Peer = { sk: offlineSk, pk: getPublicKey(offlineSk), name: "夜貓子" };
    this.roster.push(offline);
    this.defaults.set(offline.pk, { status: "offline", message: "睡了 zzz" });
  }

  start(handlers: ChatBackendEvents): void {
    this.handlers = handlers;
    const botPks = this.bots.map((b) => b.peer.pk);

    this.client.subscribe("presence", [{ kinds: [KIND.HEARTBEAT], authors: botPks }]);
    this.client.subscribe("music", [{ kinds: [KIND.MUSIC], authors: botPks }]);
    this.client.subscribe("typing", [{ kinds: [KIND.TYPING], authors: botPks, "#p": [this.self.pubkey] }]);
    this.client.subscribe("nudge", [{ kinds: [NUDGE_KIND], authors: botPks, "#p": [this.self.pubkey] }]);
    this.client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [this.self.pubkey] }]);

    // 各 bot 上線、訂閱自己的 DM
    for (const { peer, def, client } of this.bots) {
      client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [peer.pk] }]);
      client.subscribe("nudge", [{ kinds: [NUDGE_KIND], authors: [this.self.pubkey], "#p": [peer.pk] }]);
      client.publish(createHeartbeat(peer.sk, { status: encodeStatus(def.status, def.statusMessage) }));
      if (def.nowPlaying) client.publish(createMusicStatus(peer.sk, def.nowPlaying));
    }

    this.beat();
    this.heartbeatTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.renderTimer = setInterval(() => this.emitContacts(), 500);
    this.emitContacts();
  }

  private beat(): void {
    if (this.self.status === "offline") return; // 顯示為離線：停止心跳
    this.client.publish(
      createHeartbeat(this.selfSk, { status: encodeStatus(this.self.status, this.self.statusMessage) }),
    );
    for (const { peer, def, client } of this.bots) {
      client.publish(createHeartbeat(peer.sk, { status: encodeStatus(def.status, def.statusMessage) }));
    }
  }

  private onSelfEvent(event: NostrEvent): void {
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
    try {
      const { sender, rumor } = unwrapMessage(event, this.selfSk);
      const msg: ChatMessage = { id: event.id, outgoing: false, text: rumor.content, at: Date.now() };
      this.handlers?.onMessage(sender, msg);
    } catch {
      /* 無法解開則忽略 */
    }
  }

  private onBotEvent(peer: Peer, def: BotDef, event: NostrEvent): void {
    const botClient = this.bots.find((b) => b.peer.pk === peer.pk)!.client;

    // 被戳就回戳，讓使用者也能看到震動效果
    if (event.kind === NUDGE_KIND) {
      setTimeout(() => {
        botClient.publish(
          finalizeEvent(
            { kind: NUDGE_KIND, created_at: nowSec(), tags: [["p", this.self.pubkey]], content: "nudge" },
            peer.sk,
          ),
        );
      }, 700);
      return;
    }

    if (event.kind !== KIND.OFFLINE_DM_GIFT_WRAP) return;
    let text: string;
    let from: PubkeyHex;
    try {
      const opened = unwrapMessage(event, peer.sk);
      text = opened.rumor.content;
      from = opened.sender;
    } catch {
      return;
    }
    if (from !== this.self.pubkey) return;
    // 先顯示「正在輸入中」，再回覆
    botClient.publish(createTyping(peer.sk, this.self.pubkey));
    setTimeout(() => {
      botClient.publish(wrapMessage(def.reply(text), peer.sk, this.self.pubkey));
    }, 900);
  }

  private emitContacts(): void {
    if (!this.handlers) return;
    const now = Date.now();
    const contacts: Contact[] = this.roster.map((peer) => {
      const seen = this.presence.lastSeenAt(peer.pk);
      const online = seen !== undefined && now - seen <= PRESENCE_TIMEOUT_MS;
      const payload = this.statuses.get(peer.pk);
      const fallback = this.defaults.get(peer.pk);
      return {
        pubkey: peer.pk,
        name: peer.name,
        status: online ? payload?.s ?? "online" : "offline",
        statusMessage: (online ? payload?.m : undefined) ?? fallback?.message ?? "",
        nowPlaying: online ? this.music.statusOf(peer.pk) ?? "" : "",
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
    this.client.publish(createMusicStatus(this.selfSk, text));
  }

  sendMessage(to: PubkeyHex, text: string): void {
    const evt = wrapMessage(text, this.selfSk, to);
    this.client.publish(evt);
    this.handlers?.onMessage(to, { id: evt.id, outgoing: true, text, at: Date.now() });
  }

  sendTyping(to: PubkeyHex): void {
    this.client.publish(createTyping(this.selfSk, to));
  }

  sendNudge(to: PubkeyHex): void {
    this.client.publish(
      finalizeEvent({ kind: NUDGE_KIND, created_at: nowSec(), tags: [["p", to]], content: "nudge" }, this.selfSk),
    );
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    this.handlers = null;
  }
}
