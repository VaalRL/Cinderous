import {
  createHeartbeat,
  createNudge,
  createTyping,
  decodePresence,
  encodePresence,
  generateSecretKey,
  getPublicKey,
  KIND,
  messageExpiry,
  PresenceTracker,
  unwrapMessage,
  wrapMessage,
  type NostrEvent,
  type PresencePayload,
  type PresenceState,
  type PubkeyHex,
  readNudge,
  readTyping,
  type RelayClient,
  type SecretKey,
} from "@cinder/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinder/relay";
import type { ChatBackend, ChatBackendEvents, ChatMessage, Contact, Self, Status } from "./types.js";

const HEARTBEAT_MS = 2_000;
const PRESENCE_TIMEOUT_MS = 6_000;
const nowSec = () => Math.floor(Date.now() / 1000);

interface BotDef {
  name: string;
  statusMessage: string;
  status: Status;
  nowPlaying: string;
  reply: (text: string) => string;
}

/** 機器人的彙整心跳負載（狀態＋音樂）。 */
function botPresence(def: BotDef): string {
  return encodePresence({ s: def.status as PresenceState, m: def.statusMessage, np: def.nowPlaying });
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
  private readonly statuses = new Map<PubkeyHex, PresencePayload>();
  private nowPlaying = "";
  private lastContactsSig = "";
  private readonly roster: Peer[] = [];
  private readonly blocked: { pubkey: PubkeyHex; name: string }[] = [];
  private readonly hidden = new Set<PubkeyHex>();
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

    // F5：presence 心跳已彙整音樂（np），不再單獨訂閱/發送 MUSIC。
    this.client.subscribe("presence", [{ kinds: [KIND.HEARTBEAT], authors: botPks }]);
    this.client.subscribe("typing", [{ kinds: [KIND.TYPING], "#p": [this.self.pubkey] }]);
    this.client.subscribe("nudge", [{ kinds: [KIND.NUDGE], "#p": [this.self.pubkey] }]);
    this.client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [this.self.pubkey] }]);

    // 各 bot 上線、訂閱自己的 DM
    for (const { peer, def, client } of this.bots) {
      client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [peer.pk] }]);
      client.subscribe("nudge", [{ kinds: [KIND.NUDGE], "#p": [peer.pk] }]);
      client.publish(createHeartbeat(peer.sk, { status: botPresence(def) }));
    }

    this.beat();
    this.heartbeatTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.renderTimer = setInterval(() => this.emitContacts(), 500);
    this.emitContacts();
  }

  private beat(): void {
    if (this.self.status === "offline") return; // 顯示為離線：停止心跳
    this.client.publish(
      createHeartbeat(this.selfSk, {
        status: encodePresence({
          s: this.self.status as PresenceState,
          m: this.self.statusMessage,
          np: this.nowPlaying,
        }),
      }),
    );
    for (const { peer, def, client } of this.bots) {
      client.publish(createHeartbeat(peer.sk, { status: botPresence(def) }));
    }
  }

  private onSelfEvent(event: NostrEvent): void {
    switch (event.kind) {
      case KIND.HEARTBEAT:
        this.presence.observe(event.pubkey, event.created_at);
        this.statuses.set(event.pubkey, decodePresence(event.content));
        return;
      // ADR-0120：typing/nudge 已封裝 → 外層作者是臨時金鑰，真實寄件人在 seal 裡。
      case KIND.TYPING:
        this.handlers?.onTyping(readTyping(event, this.selfSk));
        return;
      case KIND.NUDGE:
        this.handlers?.onNudge(readNudge(event, this.selfSk));
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
      if (this.blocked.some((b) => b.pubkey === sender)) return;
      const expirySec = messageExpiry(rumor);
      const msg: ChatMessage = {
        id: event.id,
        outgoing: false,
        text: rumor.content,
        at: Date.now(),
        ...(expirySec !== undefined ? { expiresAt: expirySec * 1000 } : {}),
      };
      this.handlers?.onMessage(sender, msg);
    } catch {
      /* 無法解開則忽略 */
    }
  }

  private onBotEvent(peer: Peer, def: BotDef, event: NostrEvent): void {
    const botClient = this.bots.find((b) => b.peer.pk === peer.pk)!.client;

    // 被戳就回戳，讓使用者也能看到震動效果
    if (event.kind === KIND.NUDGE) {
      setTimeout(() => botClient.publish(createNudge(peer.sk, this.self.pubkey)), 700);
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
      for (const evt of wrapMessage(def.reply(text), peer.sk, this.self.pubkey).events) botClient.publish(evt);
    }, 900);
  }

  private emitContacts(): void {
    if (!this.handlers) return;
    const now = Date.now();
    const contacts: Contact[] = this.roster
      .filter((peer) => !this.hidden.has(peer.pk))
      .map((peer) => {
      const seen = this.presence.lastSeenAt(peer.pk);
      const online = seen !== undefined && now - seen <= PRESENCE_TIMEOUT_MS;
      const payload = this.statuses.get(peer.pk);
      const fallback = this.defaults.get(peer.pk);
      return {
        pubkey: peer.pk,
        name: peer.name,
        status: online ? payload?.s ?? "online" : "offline",
        statusMessage: (online ? payload?.m : undefined) ?? fallback?.message ?? "",
        nowPlaying: (online ? payload?.np : undefined) ?? "",
      };
    });
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
    this.nowPlaying = text;
    this.beat();
  }

  /** 更改顯示名稱（ADR-0144）：示範後端無聯絡人可廣播，僅更新本機顯示。 */
  setSelfName(name: string): void {
    const trimmed = name.trim();
    if (trimmed) this.self.name = trimmed;
  }

  sendMessage(to: PubkeyHex, text: string, ttlSeconds?: number): void {
    const disappearAt = ttlSeconds ? nowSec() + ttlSeconds : undefined;
    const wrapped = wrapMessage(text, this.selfSk, to, disappearAt !== undefined ? { disappearAt } : {});
    // 示範後端為單機（echo bot、無回條、無多裝置）→ 不送自封副本（ADR-0107），只送給對方那份。
    for (const evt of wrapped.events) this.client.publish(evt);
    const extra = disappearAt !== undefined ? { expiresAt: disappearAt * 1000 } : {};
    this.handlers?.onMessage(to, { id: wrapped.id, outgoing: true, text, at: Date.now(), ...extra });
  }

  sendReaction(_to: PubkeyHex, messageId: string, emoji: string): void {
    // 示範模式：本機回顯自己的回應
    this.handlers?.onReaction?.(messageId, emoji, true);
  }

  unsendMessage(_to: PubkeyHex, messageId: string): void {
    // 示範模式：本機回顯收回
    this.handlers?.onUnsend?.(messageId);
  }

  removeContact(pubkey: PubkeyHex): void {
    this.hidden.add(pubkey);
    this.emitContacts();
  }

  blockContact(pubkey: PubkeyHex): void {
    const peer = this.roster.find((p) => p.pk === pubkey);
    if (peer && !this.blocked.some((b) => b.pubkey === pubkey)) {
      this.blocked.push({ pubkey, name: peer.name });
    }
    this.hidden.add(pubkey);
    this.emitContacts();
    this.emitBlocked();
  }

  unblockContact(pubkey: PubkeyHex): void {
    const i = this.blocked.findIndex((b) => b.pubkey === pubkey);
    if (i >= 0) this.blocked.splice(i, 1);
    this.hidden.delete(pubkey);
    this.emitContacts();
    this.emitBlocked();
  }

  private emitBlocked(): void {
    this.handlers?.onBlocked?.(this.blocked.map((b) => ({ pubkey: b.pubkey, name: b.name })));
  }

  sendTyping(to: PubkeyHex): void {
    this.client.publish(createTyping(this.selfSk, to));
  }

  sendNudge(to: PubkeyHex): void {
    this.client.publish(createNudge(this.selfSk, to));
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    this.handlers = null;
  }
}
