// 公開聯絡方式的查詢端（ADR-0382 §6）：只拿到裸 npub 時，去對方的分片與索引中繼查 kind 0／10050；
// 第三方的收件中繼在錨點池外時，私訊優先寄到那裡（分片推算只適用於錨點上的 Cinderous 使用者）。
import {
  buildInboxRelayList,
  buildPublicName,
  generateSecretKey,
  getPublicKey,
  KIND,
  npubEncode,
  nsecEncode,
  shardPath,
  wrapMessage,
  type NostrEvent,
  type RelayClient,
  type RelayClientHandlers,
} from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents } from "./types.js";
import { RelayChatBackend } from "./relay-backend.js";

const BASE = "wss://relay";
const INDEX = "wss://index.example";
const THEIRS = "wss://their-relay.example";
const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const noConnector = (() => {
  throw new Error("分片模式不應使用注入的 connector");
}) as unknown as (h: RelayClientHandlers) => RelayClient;
const flush = () => new Promise((r) => setTimeout(r, 0));

let running: RelayChatBackend[] = [];
afterEach(() => {
  for (const b of running) b.stop();
  running = [];
});

/** 每座中繼（每個 URL）各自一顆有儲存的 RelayCore */
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

function cinderous(net: Net, id: string, sk = generateSecretKey(), seen?: { url: string; h: RelayClientHandlers }[]) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: id });
  const b = new RelayChatBackend(store, noConnector, id, {
    shardingBase: BASE,
    connectorFor: (url) => (h) => {
      seen?.push({ url, h });
      // 每條連線各自一個 id：記憶體中繼以連線 id 分派，共用 id 會把同一座上的前一條連線頂掉
      return net.connect(url, `${id}-${seen?.length ?? Math.random()}-${Math.random()}`, h);
    },
    publicIndexRelays: [INDEX],
  });
  running.push(b);
  return { b, store };
}

/** 第三方客戶端的使用者：在索引中繼發布名稱與收件中繼 */
function thirdParty(net: Net, name = "Tess", inbox: string[] | null = [THEIRS]) {
  const sk = generateSecretKey();
  const seed = net.connect(INDEX, `seed-${name}-${Math.random()}`);
  seed.publish(buildPublicName(sk, name));
  if (inbox) seed.publish(buildInboxRelayList(sk, inbox));
  return { sk, pk: getPublicKey(sk), publishInbox: (urls: string[]) => seed.publish(buildInboxRelayList(sk, urls)) };
}

/** 到某座中繼查寄給某人的 1059（測試用中繼不認證、不檢查範圍） */
function inboxAt(net: Net, url: string, to: string): NostrEvent[] {
  const got: NostrEvent[] = [];
  net.connect(url, `probe-${Math.random()}`, { onEvent: (_s, e) => got.push(e) }).subscribe("q", [
    { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [to] },
  ]);
  return got;
}

describe("公開聯絡方式的查詢端（ADR-0382 §6）", () => {
  it("lookupPublic：從索引中繼查到第三方的名稱與收件中繼", async () => {
    const net = storedNet();
    const { b } = cinderous(net, "me");
    b.start(noop);
    const t = thirdParty(net);
    expect(await b.lookupPublic(t.pk)).toEqual({ name: "Tess", inboxRelays: [THEIRS] });
  });

  it("lookupPublic：簽章不對或作者不是對方的事件不採用", async () => {
    const net = storedNet();
    const { b } = cinderous(net, "me");
    b.start(noop);
    const victim = getPublicKey(generateSecretKey());
    const forged = { ...buildPublicName(generateSecretKey(), "Mallory"), pubkey: victim };
    net.connect(INDEX, "evil").publish(forged);
    expect(await b.lookupPublic(victim)).toEqual({ name: null, inboxRelays: [] });
  });

  it("lookupPublic：開了公開聯絡方式的 Cinderous 使用者，在他自己的分片查得到", async () => {
    const net = storedNet();
    const other = cinderous(net, "other");
    other.b.start(noop);
    other.b.setPublicReach({ contactable: true, publicName: true });
    const { b } = cinderous(net, "me");
    b.start(noop);
    expect(await b.lookupPublic(other.b.self.pubkey)).toEqual({
      name: "other",
      inboxRelays: [`${BASE}${shardPath(other.b.self.pubkey)}`],
    });
  });

  it("只輸入裸 npub 加第三方：名稱換成對方公開的、收件中繼存為路由；私訊寄到他的中繼", async () => {
    const net = storedNet();
    const { b, store } = cinderous(net, "me");
    b.start(noop);
    const t = thirdParty(net);
    b.addContact(npubEncode(t.pk));
    await flush();
    const c = store.loadContacts().find((x) => x.pubkey === t.pk)!;
    expect(c.name).toBe("Tess");
    expect(c.relayUrl).toBe(THEIRS);
    // 比送信前後的差：加好友時自動送的個人檔也是一顆 1059
    const shard = `${BASE}${shardPath(t.pk)}`;
    const [theirs0, shard0] = [inboxAt(net, THEIRS, t.pk).length, inboxAt(net, shard, t.pk).length];
    b.sendMessage(t.pk, "hi Tess");
    expect(inboxAt(net, THEIRS, t.pk).length - theirs0).toBe(1);
    expect(inboxAt(net, shard, t.pk).length - shard0).toBe(0);
  });

  it("加好友時已給了中繼（`npub@relay`）：查到的不覆蓋使用者給的", async () => {
    const net = storedNet();
    const { b, store } = cinderous(net, "me");
    b.start(noop);
    const t = thirdParty(net);
    b.addContact(`${npubEncode(t.pk)}@wss://given.example`);
    await flush();
    expect(store.loadContacts().find((x) => x.pubkey === t.pk)?.relayUrl).toBe("wss://given.example");
  });

  it("第三方陌生人來信：請求區顯示他公開的名稱；接受後回信寄到他的中繼", async () => {
    const net = storedNet();
    const { b, store } = cinderous(net, "me");
    b.start(noop);
    const t = thirdParty(net);
    // 第三方客戶端寄到我的分片（它從我的 10050 查到的）
    net.connect(`${BASE}${shardPath(b.self.pubkey)}`, "tp").publish(wrapMessage("hello", t.sk, b.self.pubkey).events[0]!);
    await flush();
    const req = store.loadRequests().find((r) => r.pubkey === t.pk)!;
    expect(req.name).toBe("Tess");
    expect(req.relayUrl).toBe(THEIRS);
    b.acceptRequest(t.pk);
    const before = inboxAt(net, THEIRS, t.pk).length;
    b.sendMessage(t.pk, "hi back");
    expect(inboxAt(net, THEIRS, t.pk).length - before).toBe(1);
  });

  it("🔴 查詢時的認證用一次性金鑰——不讓索引中繼知道是誰在查誰", async () => {
    const net = storedNet();
    const seen: { url: string; h: RelayClientHandlers }[] = [];
    const { b } = cinderous(net, "me", generateSecretKey(), seen);
    b.start(noop);
    const t = thirdParty(net);
    seen.length = 0;
    await b.lookupPublic(t.pk);
    const lookups = seen.filter((c) => c.url === INDEX);
    expect(lookups).toHaveLength(1);
    const auth = lookups[0]!.h.authSigner!("challenge");
    expect(auth.pubkey).not.toBe(b.self.pubkey);
  });

  it("陌生人大量來信：背景查詢每分鐘最多 10 次（不讓灌請求變成灌連線）", async () => {
    const net = storedNet();
    const seen: { url: string; h: RelayClientHandlers }[] = [];
    const { b, store } = cinderous(net, "me", generateSecretKey(), seen);
    b.start(noop);
    seen.length = 0;
    const shard = net.connect(`${BASE}${shardPath(b.self.pubkey)}`, "spam");
    for (let i = 0; i < 15; i++) shard.publish(wrapMessage(`spam ${i}`, generateSecretKey(), b.self.pubkey).events[0]!);
    await flush();
    expect(store.loadRequests()).toHaveLength(15);
    expect(seen.filter((c) => c.url === INDEX)).toHaveLength(10);
  });

  it("對方 10050 列了多座：每一座都寄一份——第一座停了也收得到（NIP-17；0xchat 預設的 relay.0xchat.com 已停）", async () => {
    const net = storedNet();
    const { b } = cinderous(net, "me");
    b.start(noop);
    const DEAD = "wss://dead.example";
    const t = thirdParty(net, "Tess", [DEAD, THEIRS]);
    b.addContact(npubEncode(t.pk));
    await flush();
    const before = inboxAt(net, THEIRS, t.pk).length;
    b.sendMessage(t.pk, "hi");
    expect(inboxAt(net, THEIRS, t.pk).length - before).toBe(1);
  });

  it("請求建立時對方還沒發 10050；接受時再查一次，回信寄得到", async () => {
    const net = storedNet();
    const { b, store } = cinderous(net, "me");
    b.start(noop);
    const t = thirdParty(net, "Tess", null);
    net.connect(`${BASE}${shardPath(b.self.pubkey)}`, "tp").publish(wrapMessage("hello", t.sk, b.self.pubkey).events[0]!);
    await flush();
    expect(store.loadRequests().find((r) => r.pubkey === t.pk)?.relayUrl).toBeUndefined();
    t.publishInbox([THEIRS]); // 對方之後才設好收件中繼
    b.acceptRequest(t.pk);
    await flush();
    const before = inboxAt(net, THEIRS, t.pk).length;
    b.sendMessage(t.pk, "hi back");
    expect(inboxAt(net, THEIRS, t.pk).length - before).toBe(1);
  });

  it("沒有提示的聯絡人（例如重開 App 後）：這次第一封私訊觸發重查，查到就把同一顆補寄過去", async () => {
    const net = storedNet();
    const t = thirdParty(net, "Tess", null);
    const first = cinderous(net, "me");
    first.b.start(noop);
    first.b.addContact(npubEncode(t.pk)); // 當時查不到 10050
    await flush();
    first.b.stop();
    t.publishInbox([THEIRS]);
    const again = new RelayChatBackend(first.store, noConnector, "me", {
      shardingBase: BASE,
      connectorFor: (url) => (h) => net.connect(url, `again-${Math.random()}`, h),
      publicIndexRelays: [INDEX],
    });
    running.push(again);
    again.start(noop);
    const before = inboxAt(net, THEIRS, t.pk).length;
    again.sendMessage(t.pk, "after restart");
    await flush();
    const got = inboxAt(net, THEIRS, t.pk);
    expect(got.length - before).toBe(1);
  });

  it("提示在錨點上的聯絡人（Cinderous 使用者）：寄信不觸發查詢", async () => {
    const net = storedNet();
    const seen: { url: string; h: RelayClientHandlers }[] = [];
    const { b } = cinderous(net, "me", generateSecretKey(), seen);
    b.start(noop);
    const friend = getPublicKey(generateSecretKey());
    b.addContact(`${npubEncode(friend)}@${BASE}${shardPath(friend)}`);
    seen.length = 0;
    b.sendMessage(friend, "hi");
    await flush();
    expect(seen.filter((c) => c.url === INDEX)).toHaveLength(0);
  });

  it("聯絡人的路由提示若是錨點上的網址（Cinderous 使用者），照舊由公鑰推算分片", () => {
    const net = storedNet();
    const { b } = cinderous(net, "me");
    b.start(noop);
    const friend = getPublicKey(generateSecretKey());
    b.addContact(`${npubEncode(friend)}@${BASE}/s/z-wrong`);
    const shard = `${BASE}${shardPath(friend)}`;
    const before = inboxAt(net, shard, friend).length;
    b.sendMessage(friend, "hi");
    expect(inboxAt(net, shard, friend).length - before).toBe(1);
    expect(inboxAt(net, `${BASE}/s/z-wrong`, friend)).toHaveLength(0);
  });
});
