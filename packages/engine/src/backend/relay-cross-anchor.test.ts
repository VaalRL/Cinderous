// 跨錨點路由（ADR-0383）：登入時會自動挑錨點，所以兩個 Cinderous 使用者可能落在不同座。
//
// 修正前：分片模式一律用**自己的**分片基底加上對方的分片路徑，不看對方在哪座錨點——
// 落在錨點 1 的 Alice 寄給錨點 2 的 Bob，信落在錨點 1 上「Bob 的分片」，Bob 永遠不會去讀。
import {
  generateSecretKey,
  getPublicKey,
  nsecEncode,
  shardPath,
  shardPrefix,
  type NostrEvent,
  type RelayClient,
  type RelayClientHandlers,
} from "@cinderous/core";
import { createInMemoryRelayNetwork, type RelayCoreOptions } from "@cinderous/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import { RelayChatBackend, type RelayConnector } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const ONE = "wss://anchor-one";
const TWO = "wss://anchor-two";
const GIFT_WRAP = 1059;

/** 每個網址一顆獨立的 RelayCore（＝一顆 DO）；記下每顆禮物包寄到了哪些網址、寄給誰 */
function farm(optsFor: (url: string) => RelayCoreOptions | undefined = () => undefined) {
  const nets = new Map<string, ReturnType<typeof createInMemoryRelayNetwork>>();
  const wraps: { url: string; to: string | undefined }[] = [];
  const netFor = (url: string) => {
    let n = nets.get(url);
    if (!n) {
      n = createInMemoryRelayNetwork(optsFor(url));
      nets.set(url, n);
    }
    return n;
  };
  let seq = 0;
  const connectorFor =
    (who: string) =>
    (url: string): RelayConnector =>
    (h: RelayClientHandlers, onStatus) => {
      const client: RelayClient = netFor(url).connect(`${who}-${seq++}`, h);
      const publish = client.publish.bind(client);
      client.publish = (e: NostrEvent) => {
        if (e.kind === GIFT_WRAP) wraps.push({ url, to: e.tags.find((t) => t[0] === "p")?.[1] });
        publish(e);
      };
      onStatus?.("online");
      return client;
    };
  /** 寄給 `to` 的禮物包落在哪些網址（自己留底給其他裝置的那份不算） */
  const wrapsTo = (to: string) => new Set(wraps.filter((w) => w.to === to).map((w) => w.url));
  return { connectorFor, wraps, wrapsTo };
}

function crossShardKeys(): { skA: Uint8Array; skB: Uint8Array } {
  const skA = generateSecretKey();
  let skB = generateSecretKey();
  while (shardPrefix(getPublicKey(skA)) === shardPrefix(getPublicKey(skB))) skB = generateSecretKey();
  return { skA, skB };
}

const noConnector = (() => {
  throw new Error("分片模式不應使用注入的 connector");
}) as unknown as RelayConnector;

/** 落在 `base` 那座錨點的使用者；錨點清單照實際 App：兩座都列 */
function user(sk: Uint8Array, name: string, base: string, connectorFor: (url: string) => RelayConnector) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name });
  const b = new RelayChatBackend(store, noConnector, name, { shardingBase: base, connectorFor, anchors: [ONE, TWO] });
  return { b, store };
}

describe("跨錨點路由（ADR-0383）", () => {
  it("分享字串的提示在另一座錨點 → 寄到那座的分片；對方回信也寄得回來", () => {
    const { skA, skB } = crossShardKeys();
    const net = farm();
    const { b: alice } = user(skA, "Alice", ONE, net.connectorFor("a"));
    const { b: bob } = user(skB, "Bob", TWO, net.connectorFor("b"));
    const bobGot: ChatMessage[] = [];
    const aliceGot: ChatMessage[] = [];
    alice.start({ ...noop, onMessage: (_pk, m) => aliceGot.push(m) });
    bob.start({ ...noop, onMessage: (_pk, m) => bobGot.push(m) });

    expect(bob.selfShareUri).toBe(`${bob.selfNpub}@${TWO}${shardPath(bob.self.pubkey)}`);
    alice.addContact(bob.selfShareUri);
    alice.sendMessage(bob.self.pubkey, "跨錨點嗨");
    expect(bobGot.map((m) => m.text)).toContain("跨錨點嗨");

    bob.acceptRequest(alice.self.pubkey); // 帶內提示（ADR-0035）告訴 Bob：Alice 在錨點 1
    bob.sendMessage(alice.self.pubkey, "收到");
    expect(aliceGot.map((m) => m.text)).toContain("收到");
    alice.stop();
    bob.stop();
  });

  it("只有裸 npub（不知道對方在哪座）→ 每座錨點上對方的分片各寄一份，對方收得到", () => {
    const { skA, skB } = crossShardKeys();
    const net = farm();
    const { b: alice } = user(skA, "Alice", ONE, net.connectorFor("a"));
    const { b: bob } = user(skB, "Bob", TWO, net.connectorFor("b"));
    const bobGot: ChatMessage[] = [];
    alice.start(noop);
    bob.start({ ...noop, onMessage: (_pk, m) => bobGot.push(m) });

    alice.addContact(bob.selfNpub);
    net.wraps.length = 0;
    alice.sendMessage(bob.self.pubkey, "不知道你在哪");
    expect(bobGot.map((m) => m.text)).toContain("不知道你在哪");
    const bobShard = shardPath(bob.self.pubkey);
    expect(net.wrapsTo(bob.self.pubkey)).toEqual(new Set([`${ONE}${bobShard}`, `${TWO}${bobShard}`]));
    alice.stop();
    bob.stop();
  });

  it("提示在同一座錨點 → 只寄那座，不多寄到別座（不白白多佔一份額度）", () => {
    const { skA, skB } = crossShardKeys();
    const net = farm();
    const { b: alice } = user(skA, "Alice", ONE, net.connectorFor("a"));
    const { b: bob } = user(skB, "Bob", ONE, net.connectorFor("b"));
    alice.start(noop);
    bob.start(noop);

    alice.addContact(bob.selfShareUri);
    net.wraps.length = 0;
    alice.sendMessage(bob.self.pubkey, "同一座");
    expect(net.wrapsTo(bob.self.pubkey)).toEqual(new Set([`${ONE}${shardPath(bob.self.pubkey)}`]));
    alice.stop();
    bob.stop();
  });

  it("裸 npub 多寄時：自己這座拒收、另一座收下 → 算成功，不標失敗（任一座收下就算）", () => {
    const { skA, skB } = crossShardKeys();
    const bobPk = getPublicKey(skB);
    const refusing = `${ONE}${shardPath(bobPk)}`;
    // 禮物包的外層作者是一次性金鑰，白名單站一律拒收
    const net = farm((url) => (url === refusing ? { allowedAuthors: [bobPk] } : undefined));
    const { b: alice, store: storeA } = user(skA, "Alice", ONE, net.connectorFor("a"));
    const { b: bob } = user(skB, "Bob", TWO, net.connectorFor("b"));
    alice.start(noop);
    bob.start(noop);

    alice.addContact(bob.selfNpub);
    alice.sendMessage(bobPk, "嗨");
    // Bob 從錨點 2 收到後回送達回條，所以停在「已送達」；重點是沒有被自己這座的拒收判成失敗
    expect(storeA.loadMessages(bobPk)[0]?.status).toBe("delivered");
    alice.stop();
    bob.stop();
  });

  it("在線狀態：聯絡人在另一座錨點 → 也去那座的 presence 層看他的心跳", () => {
    const { skA, skB } = crossShardKeys();
    const net = farm();
    const { b: alice } = user(skA, "Alice", ONE, net.connectorFor("a"));
    const { b: bob } = user(skB, "Bob", TWO, net.connectorFor("b"));
    const aliceSees: { pubkey: string; status: string }[][] = [];
    alice.start({ ...noop, onContacts: (cs) => aliceSees.push(cs.map((c) => ({ pubkey: c.pubkey, status: c.status }))) });
    bob.start(noop);

    alice.addContact(bob.selfShareUri);
    bob.acceptRequest(alice.self.pubkey);
    bob.setStatus("online");
    expect(aliceSees.at(-1)?.find((c) => c.pubkey === bob.self.pubkey)?.status).toBe("online");
    alice.stop();
    bob.stop();
  });
});
