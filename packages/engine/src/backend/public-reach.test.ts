// 可選的公開聯絡方式（ADR-0382）：兩個開關、預設關；狀態以 home 上自己發布的事件為準（多裝置一致）。
import {
  buildInboxRelayList,
  generateSecretKey,
  getPublicKey,
  nsecEncode,
  readInboxRelayList,
  readPublicName,
  shardPath,
  type NostrEvent,
  type RelayClient,
  type RelayClientHandlers,
} from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, PublicReachState } from "./types.js";
import { RelayChatBackend } from "./relay-backend.js";

const BASE = "wss://relay";
const INDEX = "wss://index.example";
const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const noConnector = (() => {
  throw new Error("分片模式不應使用注入的 connector");
}) as unknown as (h: RelayClientHandlers) => RelayClient;

/** 每座中繼（每個 URL）各自一顆有儲存的 RelayCore——查得到「之前發布的」，也分得出發到哪一座 */
function storedNet() {
  const nets = new Map<string, ReturnType<typeof createInMemoryRelayNetwork>>();
  const netFor = (url: string) => {
    let n = nets.get(url);
    if (!n) {
      n = createInMemoryRelayNetwork({ store: new MessageStore() });
      nets.set(url, n);
    }
    return n;
  };
  return { connect: (url: string, id: string, h: RelayClientHandlers = {}) => netFor(url).connect(id, h) };
}
type Net = ReturnType<typeof storedNet>;
let running: RelayChatBackend[] = [];
afterEach(() => {
  for (const b of running) b.stop();
  running = [];
});

/** 記下每座中繼收到的訂閱，用來確認索引中繼只被發布、不被訂閱 */
function world() {
  const net = storedNet();
  const subscribed = new Set<string>();
  const connFor = (id: string) => (url: string) => (h: RelayClientHandlers) => {
    const client = net.connect(url, id, h);
    const subscribe = client.subscribe.bind(client);
    client.subscribe = (subId, filters) => {
      if (filters.length > 0) subscribed.add(url);
      subscribe(subId, filters);
    };
    return client;
  };
  return { net, subscribed, connFor };
}

function device(w: ReturnType<typeof world>, sk: Uint8Array, id: string, opts: { org?: boolean; index?: string[] } = {}) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "Joe" });
  const states: PublicReachState[] = [];
  const b = new RelayChatBackend(store, noConnector, "Joe", {
    shardingBase: BASE,
    connectorFor: w.connFor(id),
    ...(opts.org ? { orgAdminPubkey: getPublicKey(generateSecretKey()) } : {}),
    ...(opts.index ? { publicIndexRelays: opts.index } : {}),
  });
  running.push(b);
  b.start({ ...noop, onPublicReach: (s) => states.push(s) });
  return { b, states };
}

/** 以另一把金鑰到某座中繼查某作者的 kind 0／10002／10050（第三方客戶端的查法） */
function lookup(net: Net, url: string, author: string): NostrEvent[] {
  const got: NostrEvent[] = [];
  const c = net.connect(url, `probe-${Math.random()}`, { onEvent: (_s, e) => got.push(e) });
  c.subscribe("q", [{ kinds: [0, 10002, 10050], authors: [author] }]);
  return got;
}
const latest = (events: NostrEvent[], kind: number) =>
  events.filter((e) => e.kind === kind).sort((a, b) => b.created_at - a.created_at)[0];

describe("公開聯絡方式（ADR-0382）", () => {
  it("預設兩個都關、可以用；什麼都不發布", () => {
    const w = world();
    const sk = generateSecretKey();
    const { b } = device(w, sk, "a");
    expect(b.publicReach()).toEqual({ available: true, contactable: false, publicName: false });
    expect(lookup(w.net, `${BASE}${shardPath(b.self.pubkey)}`, b.self.pubkey)).toEqual([]);
  });

  it("打開「能聯絡我」：home 上查得到 10050（只列 home 分片）與 10002（write＝home）；不發 kind 0", () => {
    const w = world();
    const { b, states } = device(w, generateSecretKey(), "a");
    const home = `${BASE}${shardPath(b.self.pubkey)}`;
    b.setPublicReach({ contactable: true });
    const got = lookup(w.net, home, b.self.pubkey);
    expect(readInboxRelayList(latest(got, 10050)!)).toEqual([home]);
    expect(latest(got, 10002)?.tags).toEqual([["r", home, "write"]]);
    expect(latest(got, 0)).toBeUndefined();
    expect(b.publicReach()).toEqual({ available: true, contactable: true, publicName: false });
    expect(states.at(-1)).toEqual({ available: true, contactable: true, publicName: false });
  });

  it("打開「公開我的名稱」：kind 0 只有 name；不發任何中繼清單", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a");
    b.setPublicReach({ publicName: true });
    const got = lookup(w.net, `${BASE}${shardPath(b.self.pubkey)}`, b.self.pubkey);
    expect(JSON.parse(latest(got, 0)!.content)).toEqual({ name: "Joe" });
    expect(latest(got, 10050)).toBeUndefined();
    expect(latest(got, 10002)).toBeUndefined();
  });

  it("關掉：發較新的空清單與 `{}` 取代", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a");
    b.setPublicReach({ contactable: true, publicName: true });
    b.setPublicReach({ contactable: false, publicName: false });
    const got = lookup(w.net, `${BASE}${shardPath(b.self.pubkey)}`, b.self.pubkey);
    expect(readInboxRelayList(latest(got, 10050)!)).toEqual([]);
    expect(latest(got, 10002)?.tags).toEqual([]);
    expect(readPublicName(latest(got, 0)!)).toBeNull();
    expect(b.publicReach()).toEqual({ available: true, contactable: false, publicName: false });
  });

  it("改名：公開名稱開著才重發 kind 0", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a");
    const home = `${BASE}${shardPath(b.self.pubkey)}`;
    b.setSelfName("Joe 2");
    expect(latest(lookup(w.net, home, b.self.pubkey), 0)).toBeUndefined();
    b.setPublicReach({ publicName: true });
    b.setSelfName("Joe 3");
    expect(readPublicName(latest(lookup(w.net, home, b.self.pubkey), 0)!)).toBe("Joe 3");
  });

  it("另一台裝置（同一把身分）從 home 讀到同一個狀態——開關不存本機", () => {
    const w = world();
    const sk = generateSecretKey();
    const a = device(w, sk, "a");
    a.b.setPublicReach({ contactable: true, publicName: true });
    const other = device(w, sk, "b");
    expect(other.b.publicReach()).toEqual({ available: true, contactable: true, publicName: true });
    expect(other.states.at(-1)).toEqual({ available: true, contactable: true, publicName: true });
  });

  it("開機讀到自己超過 7 天的 10050：重發一份新的；7 天內的不動", () => {
    const w = world();
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const home = `${BASE}${shardPath(pk)}`;
    const now = Math.floor(Date.now() / 1000);
    const seed = w.net.connect(home, "seed");
    const old = buildInboxRelayList(sk, [home], now - 8 * 86_400);
    seed.publish(old);
    device(w, sk, "a");
    const after = latest(lookup(w.net, home, pk), 10050)!;
    expect(after.id).not.toBe(old.id);
    expect(after.created_at).toBeGreaterThan(old.created_at);

    const w2 = world();
    const sk2 = generateSecretKey();
    const home2 = `${BASE}${shardPath(getPublicKey(sk2))}`;
    const fresh = buildInboxRelayList(sk2, [home2], now - 86_400);
    w2.net.connect(home2, "seed").publish(fresh);
    device(w2, sk2, "a");
    expect(latest(lookup(w2.net, home2, getPublicKey(sk2)), 10050)!.id).toBe(fresh.id);
  });

  it("企業身分不能用：available false、設定被忽略、什麼都不發", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a", { org: true });
    expect(b.publicReach()).toEqual({ available: false, contactable: false, publicName: false });
    b.setPublicReach({ contactable: true, publicName: true });
    expect(b.publicReach().contactable).toBe(false);
    expect(lookup(w.net, `${BASE}${shardPath(b.self.pubkey)}`, b.self.pubkey)).toEqual([]);
  });

  it("索引中繼：只發布、不訂閱（不把收件匣與聯絡人交給它）", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a", { index: [INDEX] });
    b.setPublicReach({ contactable: true, publicName: true });
    const got = lookup(w.net, INDEX, b.self.pubkey);
    expect(got.map((e) => e.kind).sort()).toEqual([0, 10002, 10050]);
    expect(w.subscribed.has(INDEX)).toBe(false);
  });
});
