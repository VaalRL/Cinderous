import { KIND, wrapMessage, type NostrEvent, type RelayClientHandlers } from "@nostr-buddy/core";
import { createInMemoryRelayNetwork } from "@nostr-buddy/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import { normalizeRelayUrl, RelayChatBackend } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/** 兩座互不相識的 relay（模擬兩個自架 worker），與依 URL 取用的連線工廠。 */
function twoRelays() {
  const netX = createInMemoryRelayNetwork();
  const netY = createInMemoryRelayNetwork();
  const nets: Record<string, ReturnType<typeof createInMemoryRelayNetwork>> = {
    "wss://x": netX,
    "wss://y": netY,
  };
  let n = 0;
  const connectorFor = (url: string) => (h: RelayClientHandlers) =>
    nets[url]!.connect(`pool-${n++}`, h);
  /** 對某座 relay 掛側錄訂閱，回傳收到的事件陣列。 */
  const spy = (net: ReturnType<typeof createInMemoryRelayNetwork>, filter: object): NostrEvent[] => {
    const got: NostrEvent[] = [];
    const c = net.connect(`spy-${n++}`, { onEvent: (_s, e) => got.push(e) });
    c.subscribe("spy", [filter as never]);
    return got;
  };
  return { netX, netY, connectorFor, spy };
}

describe("normalizeRelayUrl（ADR-0034）", () => {
  it("trim、去尾斜線；非 ws(s) 或空值回傳 undefined", () => {
    expect(normalizeRelayUrl(" wss://x/ ")).toBe("wss://x");
    expect(normalizeRelayUrl("ws://localhost:8787")).toBe("ws://localhost:8787");
    expect(normalizeRelayUrl("https://x")).toBeUndefined();
    expect(normalizeRelayUrl("")).toBeUndefined();
    expect(normalizeRelayUrl(undefined)).toBeUndefined();
  });
});

describe("跨中繼通訊：Relay Pool 與收件人路由（ADR-0034）", () => {
  it("私訊路由到收件人的 relay：Alice(home X) → Bob(home Y) 送達，且不經 X", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    const dmOnX = spy(netX, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });
    const dmOnY = spy(netY, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });

    a.addContact(`${b.selfNpub}@wss://y`);
    a.sendMessage(b.self.pubkey, "跨 relay 哈囉");

    expect(bIncoming.map((m) => m.text)).toContain("跨 relay 哈囉");
    expect(dmOnY).toHaveLength(1);
    expect(dmOnX).toHaveLength(0); // 不浪費也不外洩到自己的 home
    a.stop();
    b.stop();
  });

  it("不對稱認知：Bob 無 hint 回覆走他的 home Y，Alice 靠 pool 收件箱收到", () => {
    const { netX, netY, connectorFor } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const aIncoming: ChatMessage[] = [];
    const bIncoming: ChatMessage[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m) });
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(`${b.selfNpub}@wss://y`);
    a.sendMessage(b.self.pubkey, "去程");
    expect(bIncoming.map((m) => m.text)).toContain("去程");

    // Bob 被自動加入 Alice（無 relay hint）→ 回覆退回自己的 home Y
    b.sendMessage(a.self.pubkey, "回程");
    expect(aIncoming.map((m) => m.text)).toContain("回程");
    a.stop();
    b.stop();
  });

  it("心跳發到 pool 中所有 relay：對方未記錄我的 relay 也看得到我在線", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    a.start(noop);
    b.start(noop);
    a.addContact(`${b.selfNpub}@wss://y`); // 建立 pool 連線 Y

    const hbOnX = spy(netX, { kinds: [KIND.HEARTBEAT], authors: [a.self.pubkey] });
    const hbOnY = spy(netY, { kinds: [KIND.HEARTBEAT], authors: [a.self.pubkey] });
    a.setStatus("online"); // 觸發即時心跳

    expect(hbOnX).toHaveLength(1);
    expect(hbOnY).toHaveLength(1);
    expect(hbOnX[0]!.id).toBe(hbOnY[0]!.id); // 同一顆心跳扇出
    a.stop();
    b.stop();
  });

  it("同一事件經多個 relay 抵達只處理一次（去重）", () => {
    const { netX, netY, connectorFor } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const aIncoming: ChatMessage[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m) });
    b.start(noop);
    a.addContact(`${b.selfNpub}@wss://y`); // Alice 的收件箱同時掛在 X 與 Y

    // 第三方把「同一個」給 Alice 的 wrap 各發一次到 X 與 Y
    const senderSk = (b as unknown as { sk: Uint8Array }).sk;
    const wrap = wrapMessage("雙路送達", senderSk, a.self.pubkey);
    const pubX = netX.connect("dup-x", {});
    const pubY = netY.connect("dup-y", {});
    pubX.publish(wrap);
    pubY.publish(wrap);

    expect(aIncoming.filter((m) => m.text === "雙路送達")).toHaveLength(1);
    a.stop();
    b.stop();
  });

  it("addContact 解析 hint：尾斜線正規化、與 home 相同時不儲存、純 npub 不受影響", () => {
    const { netX, connectorFor } = twoRelays();
    const store = new MemoryStorage();
    const a = new RelayChatBackend(store, (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("c", h), "Carol");
    const d = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("d", h), "Dan");
    a.start(noop);

    a.addContact(`${b.selfNpub}@wss://y/`);
    a.addContact(`${c.selfNpub}@wss://x`); // 同 home → 不存 hint
    a.addContact(d.selfNpub);

    const by = (pk: string) => store.loadContacts().find((x) => x.pubkey === pk)!;
    expect(by(b.self.pubkey).relayUrl).toBe("wss://y");
    expect(by(c.self.pubkey).relayUrl).toBeUndefined();
    expect(by(d.self.pubkey).relayUrl).toBeUndefined();
    a.stop();
  });

  it("selfShareUri：帶 home relay 時為 npub@url，未設定時同 npub", () => {
    const { netX, connectorFor } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x/",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
    expect(a.selfShareUri).toBe(`${a.selfNpub}@wss://x`);
    expect(b.selfShareUri).toBe(b.selfNpub);
  });

  it("單 relay 模式（未提供 connectorFor）：hint 被忽略、行為與既有相同", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(`${b.selfNpub}@wss://elsewhere`); // hint 存了也只會退回唯一連線
    a.sendMessage(b.self.pubkey, "單機模式");
    expect(bIncoming.map((m) => m.text)).toContain("單機模式");
    a.stop();
    b.stop();
  });
});
