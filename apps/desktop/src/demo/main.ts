import {
  createHeartbeat,
  createNudge,
  createTyping,
  decodePresence,
  encodePresence,
  generateSecretKey,
  getPublicKey,
  KIND,
  PresenceTracker,
  openWrap,
  readNudge,
  TypingTracker,
  unwrapMessage,
  wrapMessage,
  type NostrEvent,
  type PubkeyHex,
  type RelayClient,
  type SecretKey,
} from "@cinder/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinder/relay";

const DEMO_PRESENCE_TIMEOUT_MS = 5_000;
const HEARTBEAT_EVERY_MS = 2_000;
const nowSec = () => Math.floor(Date.now() / 1000);
const short = (pk: PubkeyHex) => pk.slice(0, 8);

// ── 記憶體中的 relay（真實 RelayCore + 離線留言儲存）──
const net = createInMemoryRelayNetwork({ store: new MessageStore(), now: nowSec });

interface PeerDom {
  panel: HTMLElement;
  dot: HTMLElement;
  status: HTMLElement;
  nowPlaying: HTMLElement;
  log: HTMLElement;
  typing: HTMLElement;
  toggle: HTMLButtonElement;
  input: HTMLInputElement;
}

class DemoPeer {
  readonly pk: PubkeyHex;
  private readonly client: RelayClient;
  private readonly presence = new PresenceTracker();
  private readonly typing = new TypingTracker();
  private nowPlaying = ""; // 自己正在聽（併入心跳）
  private remoteNp = ""; // 好友正在聽（由心跳解出）
  private readonly shownDm = new Set<string>();
  private online = false;
  private hbTimer: ReturnType<typeof setInterval> | undefined;
  private lastTypingSentMs = 0;
  friend!: DemoPeer;

  constructor(
    readonly name: string,
    private readonly connId: string,
    private readonly sk: SecretKey,
    private readonly dom: PeerDom,
  ) {
    this.pk = getPublicKey(sk);
    this.client = net.connect(connId, { onEvent: (_sub, event) => this.onEvent(event) });
    this.wireControls();
  }

  /** 在 friend 指派完成後啟動（上線、訂閱、開始心跳）。 */
  start(): void {
    this.setOnline(true);
  }

  private get friendPk(): PubkeyHex {
    return this.friend.pk;
  }

  private subscribeAll(): void {
    // F5：music 併入 presence 心跳，不再單獨訂閱。
    this.client.subscribe("presence", [{ kinds: [KIND.HEARTBEAT], authors: [this.friendPk] }]);
    // ADR-0120：typing/nudge 已 NIP-59 封裝 → 外層作者是臨時金鑰，`authors:` 永遠不會命中。
    this.client.subscribe("typing", [{ kinds: [KIND.TYPING], "#p": [this.pk] }]);
    this.client.subscribe("nudge", [{ kinds: [KIND.NUDGE], "#p": [this.pk] }]);
    this.client.subscribe("dm", [{ kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [this.pk] }]);
  }

  private setOnline(value: boolean): void {
    this.online = value;
    if (value) {
      this.subscribeAll();
      this.beat();
      this.hbTimer = setInterval(() => this.beat(), HEARTBEAT_EVERY_MS);
      this.sys(`${this.name} 上線`);
    } else {
      if (this.hbTimer) clearInterval(this.hbTimer);
      for (const sub of ["presence", "typing", "nudge", "dm"]) this.client.unsubscribe(sub);
      this.sys(`${this.name} 離線`);
    }
    this.dom.toggle.textContent = value ? "切換為離線" : "切換為上線";
    this.dom.toggle.classList.toggle("off", !value);
  }

  /** 發送彙整心跳（含 now-playing）。 */
  private beat(): void {
    this.client.publish(
      createHeartbeat(this.sk, { status: encodePresence({ s: "online", m: "", np: this.nowPlaying }) }),
    );
  }

  private onEvent(event: NostrEvent): void {
    switch (event.kind) {
      case KIND.HEARTBEAT:
        this.presence.observe(event.pubkey, event.created_at);
        this.remoteNp = decodePresence(event.content).np; // 好友的音樂併在心跳中
        return;
      // ADR-0120：真實寄件人在 seal 裡；**時間戳也要用 rumor 的**——外層的 `created_at` 被
      // `jitteredPast()` 隨機往前推了最多 2 天（隱私設計），拿它比逾時，指示燈永遠不會亮。
      case KIND.TYPING: {
        const { sender, rumor } = openWrap(event, this.sk);
        if (sender === this.friendPk) this.typing.observe(sender, rumor.created_at);
        return;
      }
      case KIND.NUDGE:
        if (readNudge(event, this.sk) === this.friendPk) this.shake();
        return;
      case KIND.OFFLINE_DM_GIFT_WRAP: {
        if (this.shownDm.has(event.id)) return;
        this.shownDm.add(event.id);
        try {
          const { sender, rumor } = unwrapMessage(event, this.sk);
          this.addMsg(`${short(sender)}：${rumor.content}`, "in");
        } catch {
          this.sys("收到無法解開的訊息");
        }
        return;
      }
    }
  }

  private wireControls(): void {
    this.dom.toggle.addEventListener("click", () => this.setOnline(!this.online));
    this.dom.input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") this.sendDm();
    });
    this.dom.input.addEventListener("input", () => this.maybeSendTyping());
  }

  sendDm(): void {
    const text = this.dom.input.value.trim();
    if (!text) return;
    // 示範腳本為單機（無多裝置）→ 不送自封副本（ADR-0107），只送給對方那份。
    for (const evt of wrapMessage(text, this.sk, this.friendPk).events) this.client.publish(evt);
    this.addMsg(`你：${text}`, "out");
    this.dom.input.value = "";
  }

  private maybeSendTyping(): void {
    const t = Date.now();
    if (t - this.lastTypingSentMs < 1000) return;
    this.lastTypingSentMs = t;
    this.client.publish(createTyping(this.sk, this.friendPk));
  }

  setMusic(status: string): void {
    this.nowPlaying = status;
    if (this.online) this.beat(); // 立即以彙整心跳廣播
    this.sys(status ? `你正在聽：${status}` : "你停止播放");
  }

  nudge(): void {
    this.client.publish(createNudge(this.sk, this.friendPk));
    this.sys("你送出一個 Nudge");
  }

  private shake(): void {
    this.dom.panel.classList.remove("nudging");
    void this.dom.panel.offsetWidth;
    this.dom.panel.classList.add("nudging");
    this.sys("被戳了一下！");
  }

  private addMsg(text: string, kind: "in" | "out"): void {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.textContent = text;
    this.dom.log.append(el);
    this.dom.log.scrollTop = this.dom.log.scrollHeight;
  }

  private sys(text: string): void {
    const el = document.createElement("div");
    el.className = "msg sys";
    el.textContent = text;
    this.dom.log.append(el);
    this.dom.log.scrollTop = this.dom.log.scrollHeight;
  }

  render(nowMs: number): void {
    const seen = this.presence.lastSeenAt(this.friendPk);
    const friendOnline = seen !== undefined && nowMs - seen <= DEMO_PRESENCE_TIMEOUT_MS;
    this.dom.dot.classList.toggle("online", friendOnline);
    this.dom.status.textContent = friendOnline ? "上線" : "離線";
    const playing = friendOnline ? this.remoteNp : "";
    this.dom.nowPlaying.textContent = playing ? `♪ ${this.friend.name} 正在聽：${playing}` : "";
    this.dom.typing.textContent =
      friendOnline && this.typing.isTyping(this.friendPk, nowMs) ? `${this.friend.name} 正在輸入中…` : "";
  }
}

// ── 建立 UI ──
function buildPanel(name: string, pk: PubkeyHex): PeerDom {
  const panel = document.createElement("div");
  panel.className = "peer";
  panel.innerHTML = `
    <div class="peer__bar">${name}<small>${short(pk)}…</small></div>
    <div class="peer__friend"><span class="dot"></span><span class="fname"></span><span class="friend__status">離線</span></div>
    <div class="now-playing"></div>
    <div class="log"></div>
    <div class="typing"></div>
    <div class="controls">
      <button class="toggle">切換為離線</button>
      <button class="ghost music">🎵 音樂</button>
      <button class="ghost nudge">震動 Nudge</button>
    </div>
    <div class="controls">
      <input placeholder="輸入訊息，Enter 送出" />
      <button class="send">送出</button>
    </div>`;
  return {
    panel,
    dot: panel.querySelector(".dot")!,
    status: panel.querySelector(".friend__status")!,
    nowPlaying: panel.querySelector(".now-playing")!,
    log: panel.querySelector(".log")!,
    typing: panel.querySelector(".typing")!,
    toggle: panel.querySelector(".toggle")!,
    input: panel.querySelector("input")!,
  };
}

const stage = document.getElementById("stage")!;
const aliceSk = generateSecretKey();
const bobSk = generateSecretKey();
const aliceDom = buildPanel("Alice", getPublicKey(aliceSk));
const bobDom = buildPanel("Bob", getPublicKey(bobSk));
stage.append(aliceDom.panel, bobDom.panel);

const alice = new DemoPeer("Alice", "alice", aliceSk, aliceDom);
const bob = new DemoPeer("Bob", "bob", bobSk, bobDom);
alice.friend = bob;
bob.friend = alice;
aliceDom.panel.querySelector(".fname")!.textContent = bob.name;
bobDom.panel.querySelector(".fname")!.textContent = alice.name;
alice.start();
bob.start();

// 綁定每個面板的按鈕到對應 peer
for (const [peer, dom] of [
  [alice, aliceDom],
  [bob, bobDom],
] as const) {
  dom.panel.querySelector(".send")!.addEventListener("click", () => peer.sendDm());
  dom.panel.querySelector(".nudge")!.addEventListener("click", () => peer.nudge());
  dom.panel.querySelector(".music")!.addEventListener("click", () => {
    const song = window.prompt("正在聽什麼？（留空表示停止）", "Daft Punk - Get Lucky");
    if (song !== null) peer.setMusic(song);
  });
}

setInterval(() => {
  const t = Date.now();
  alice.render(t);
  bob.render(t);
}, 500);
