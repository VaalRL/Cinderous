// 可選的公開聯絡方式（ADR-0382）：兩個開關、預設關；狀態以 home 上自己發布的事件為準（多裝置一致）。
import {
  buildInboxRelayList,
  generateSecretKey,
  getPublicKey,
  nsecEncode,
  readInboxRelayList,
  readPublicName,
  shardPath,
  wrapMessage,
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
  /** 每座中繼上目前有效的訂閱（連線 → filters）與連線時給的 handlers */
  const subs = new Map<string, Map<object, unknown[]>>();
  const handlers: { url: string; h: RelayClientHandlers }[] = [];
  const connFor = (id: string) => (url: string) => (h: RelayClientHandlers) => {
    // 每條連線各自一個 id：記憶體中繼以連線 id 分派，共用 id 會把同一座上的前一條連線頂掉
    const client = net.connect(url, `${id}-${Math.random()}`, h);
    handlers.push({ url, h });
    const key = {};
    const subscribe = client.subscribe.bind(client);
    client.subscribe = (subId, filters) => {
      if (filters.length > 0) subscribed.add(url);
      const at = subs.get(url) ?? new Map<object, unknown[]>();
      subs.set(url, at);
      if (filters.length > 0) at.set(key, filters);
      else at.delete(key);
      subscribe(subId, filters);
    };
    const close = client.close?.bind(client);
    client.close = () => {
      subs.get(url)?.delete(key);
      close?.();
    };
    return client;
  };
  /** 某座中繼上目前有效的訂閱 filters（所有連線攤平） */
  const filtersAt = (url: string) => [...(subs.get(url)?.values() ?? [])].flat();
  return { net, subscribed, connFor, filtersAt, handlers };
}

function device(
  w: ReturnType<typeof world>,
  sk: Uint8Array,
  id: string,
  opts: { org?: boolean; index?: string[]; inbox?: string[] } = {},
) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "Joe" });
  const states: PublicReachState[] = [];
  const b = new RelayChatBackend(store, noConnector, "Joe", {
    shardingBase: BASE,
    connectorFor: w.connFor(id),
    ...(opts.org ? { orgAdminPubkey: getPublicKey(generateSecretKey()) } : {}),
    ...(opts.index ? { publicIndexRelays: opts.index } : {}),
    ...(opts.inbox ? { publicInboxRelays: opts.inbox } : {}),
  });
  running.push(b);
  b.start({ ...noop, onPublicReach: (s) => states.push(s) });
  return { b, states, store };
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

describe("🔴 公開清單不指向主平面：改列公共收件中繼（ADR-0402）", () => {
  const PUB1 = "wss://pub-one.example";
  const PUB2 = "wss://pub-two.example";
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** 第三方客戶端照我的 10050 寄一封信到某座 */
  const thirdPartyWrites = (w: ReturnType<typeof world>, url: string, to: string) => {
    const sk = generateSecretKey();
    w.net.connect(url, `tp-${Math.random()}`).publish(wrapMessage("hello", sk, to).events[0]!);
    return getPublicKey(sk);
  };

  it("打開「能聯絡我」：10050／10002 只列公共收件中繼、不列 home 分片；home、公共中繼、索引中繼都查得到", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a", { inbox: [PUB1, PUB2], index: [INDEX] });
    const home = `${BASE}${shardPath(b.self.pubkey)}`;
    b.setPublicReach({ contactable: true });
    for (const url of [home, PUB1, PUB2, INDEX]) {
      const got = lookup(w.net, url, b.self.pubkey);
      expect(readInboxRelayList(latest(got, 10050)!), url).toEqual([PUB1, PUB2]);
      expect(latest(got, 10002)?.tags, url).toEqual([
        ["r", PUB1, "write"],
        ["r", PUB2, "write"],
      ]);
      expect(JSON.stringify(got), url).not.toContain(home);
    }
    expect(b.publicReach().contactable).toBe(true);
  });

  it("公開名稱也發一份到公共收件中繼（outbox 型客戶端照 10002 去那裡找名稱）", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a", { inbox: [PUB1] });
    b.setPublicReach({ contactable: true, publicName: true });
    expect(readPublicName(latest(lookup(w.net, PUB1, b.self.pubkey), 0)!)).toBe("Joe");
  });

  it("開著時：在公共收件中繼只訂寄給自己的 1059、不認證；第三方寄到那裡的信進請求區", async () => {
    const w = world();
    const { b, store } = device(w, generateSecretKey(), "a", { inbox: [PUB1] });
    b.setPublicReach({ contactable: true });
    expect(w.filtersAt(PUB1)).toEqual([{ kinds: [1059], "#p": [b.self.pubkey] }]);
    // 收信的那條連線不認證（讀信用不到；認證＝把 IP 和身分綁在一起）。發布清單的單次連線另計：那些事件本來就是我簽的
    const receiving = w.handlers.filter((c) => c.url === PUB1 && c.h.onEvent !== undefined);
    expect(receiving).toHaveLength(1);
    expect(receiving[0]!.h.authSigner).toBeUndefined();
    const from = thirdPartyWrites(w, PUB1, b.self.pubkey);
    await flush();
    expect(store.loadRequests().map((r) => r.pubkey)).toContain(from);
  });

  it("關掉：公共收件中繼上也換成空清單；不再收那裡的信", async () => {
    const w = world();
    const { b, store } = device(w, generateSecretKey(), "a", { inbox: [PUB1] });
    b.setPublicReach({ contactable: true });
    b.setPublicReach({ contactable: false });
    expect(readInboxRelayList(latest(lookup(w.net, PUB1, b.self.pubkey), 10050)!)).toEqual([]);
    expect(w.filtersAt(PUB1)).toEqual([]);
    const from = thirdPartyWrites(w, PUB1, b.self.pubkey);
    await flush();
    expect(store.loadRequests().map((r) => r.pubkey)).not.toContain(from);
  });

  it("只開「公開我的名稱」：不去公共收件中繼收信", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a", { inbox: [PUB1] });
    b.setPublicReach({ publicName: true });
    expect(w.subscribed.has(PUB1)).toBe(false);
  });

  it("另一台裝置（同一把身分）讀到開著：也去公共收件中繼收信", () => {
    const w = world();
    const sk = generateSecretKey();
    device(w, sk, "a", { inbox: [PUB1] }).b.setPublicReach({ contactable: true });
    const before = w.filtersAt(PUB1).length;
    device(w, sk, "b", { inbox: [PUB1] });
    expect(w.filtersAt(PUB1).length).toBe(before + 1);
  });

  it("升版前開過的（清單還列著 home 分片）：開機就換成公共收件中繼", () => {
    const w = world();
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const home = `${BASE}${shardPath(pk)}`;
    const old = buildInboxRelayList(sk, [home], Math.floor(Date.now() / 1000) - 3600);
    w.net.connect(home, "seed").publish(old);
    device(w, sk, "a", { inbox: [PUB1, PUB2] });
    expect(readInboxRelayList(latest(lookup(w.net, home, pk), 10050)!)).toEqual([PUB1, PUB2]);
    expect(readInboxRelayList(latest(lookup(w.net, PUB1, pk), 10050)!)).toEqual([PUB1, PUB2]);
  });

  it("單座中繼模式（手機版）也一樣：列公共收件中繼，不列 home（錨點的根路徑同樣是主平面）", () => {
    const w = world();
    const SELF = "wss://anchor-root.example";
    const sk = generateSecretKey();
    const store = new MemoryStorage();
    store.saveIdentity({ nsec: nsecEncode(sk), name: "Joe" });
    const b = new RelayChatBackend(store, (h) => w.net.connect(SELF, `self-${Math.random()}`, h), "Joe", {
      relayUrl: SELF,
      connectorFor: w.connFor("self"),
      publicInboxRelays: [PUB1],
    });
    running.push(b);
    b.start(noop);
    b.setPublicReach({ contactable: true });
    expect(readInboxRelayList(latest(lookup(w.net, SELF, b.self.pubkey), 10050)!)).toEqual([PUB1]);
    expect(w.filtersAt(PUB1)).toEqual([{ kinds: [1059], "#p": [b.self.pubkey] }]);
  });

  it("沒設公共收件中繼（自架）：照舊只列 home、不連任何公共中繼", () => {
    const w = world();
    const { b } = device(w, generateSecretKey(), "a");
    b.setPublicReach({ contactable: true });
    const home = `${BASE}${shardPath(b.self.pubkey)}`;
    expect(readInboxRelayList(latest(lookup(w.net, home, b.self.pubkey), 10050)!)).toEqual([home]);
    expect([...w.subscribed].every((u) => u.startsWith(BASE))).toBe(true);
  });
});
