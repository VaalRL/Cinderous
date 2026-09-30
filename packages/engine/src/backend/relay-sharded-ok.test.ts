// 分片模式下寄給別人的訊息走「對方訊息片」的連線——那條連線也要處理 OK（ADR-0377）。
//
// 修正前：外部連線（`poolClient`）只接了 onEvent／AUTH，沒有 onOk。寄給別片的訊息，中繼的 OK（收下或拒收）
// 全部被丟掉，外送匣等 30 秒後把它當成「已送達」靜默移除——拒收的訊息不會變紅，收下的也不會標成「已送中繼」。
import {
  generateSecretKey,
  getPublicKey,
  nsecEncode,
  shardPath,
  shardPrefix,
  type RelayClient,
  type RelayClientHandlers,
} from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore, type RelayCoreOptions } from "@cinderous/relay";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage, MessageStatus } from "./types.js";
import { RelayChatBackend, type RelayConnector } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const BASE = "wss://relay";
const ANCHOR = "wss://anchor";

/** 每個 host 一顆獨立的 RelayCore（＝一顆 DO）；可以替個別 host 指定選項（例如天花板滿了、白名單） */
function farm(optsFor: (host: string) => RelayCoreOptions | undefined = () => undefined) {
  const nets = new Map<string, ReturnType<typeof createInMemoryRelayNetwork>>();
  const netFor = (host: string) => {
    let n = nets.get(host);
    if (!n) {
      n = createInMemoryRelayNetwork(optsFor(host));
      nets.set(host, n);
    }
    return n;
  };
  let seq = 0;
  const connectorFor =
    (who: string) =>
    (url: string): RelayConnector =>
    (h: RelayClientHandlers, onStatus) => {
      const client: RelayClient = netFor(url).connect(`${who}-${seq++}`, h);
      onStatus?.("online");
      return client;
    };
  return { connectorFor, coreFor: (host: string) => netFor(host).core };
}

/** 兩把不同分片前綴的金鑰（保證跨片） */
function crossShardKeys(): { skA: Uint8Array; skB: Uint8Array } {
  const skA = generateSecretKey();
  let skB = generateSecretKey();
  while (shardPrefix(getPublicKey(skA)) === shardPrefix(getPublicKey(skB))) skB = generateSecretKey();
  return { skA, skB };
}

const noConnector = (() => {
  throw new Error("分片模式不應使用注入的 connector");
}) as unknown as RelayConnector;

function backend(sk: Uint8Array, name: string, connectorFor: (url: string) => RelayConnector, extra: { anchors?: string[] } = {}) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name });
  const b = new RelayChatBackend(store, noConnector, name, { shardingBase: BASE, connectorFor, ...extra });
  return { b, store };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("分片連線也處理 OK（ADR-0377）", () => {
  it("對方分片收下 → 訊息標成「已送中繼」（修正前停在「傳送中」）", () => {
    const { skA, skB } = crossShardKeys();
    const net = farm();
    const { b: a, store: storeA } = backend(skA, "Alice", net.connectorFor("a"));
    const bobPk = getPublicKey(skB);
    const statuses: MessageStatus[] = [];
    a.start({ ...noop, onMessageStatus: (_c, _id, s) => statuses.push(s) });
    a.addContact(backend(skB, "Bob", net.connectorFor("b")).b.selfNpub); // Bob 不上線：沒有送達回條干擾
    a.sendMessage(bobPk, "嗨");
    expect(statuses).toContain("sent");
    expect(storeA.loadMessages(bobPk)[0]?.status).toBe("sent");
    a.stop();
  });

  it("對方分片永久拒收（白名單外）→ 立刻標成失敗，不再等 30 秒後當成已送達", () => {
    const { skA, skB } = crossShardKeys();
    const bobPk = getPublicKey(skB);
    const bobShard = `${BASE}${shardPath(bobPk)}`;
    // 只有 Bob 的分片是白名單站：禮物包的外層作者是一次性金鑰，一律被拒
    const net = farm((host) => (host === bobShard ? { allowedAuthors: [bobPk] } : undefined));
    const { b: a, store: storeA } = backend(skA, "Alice", net.connectorFor("a"));
    a.start(noop);
    a.addContact(backend(skB, "Bob", net.connectorFor("b")).b.selfNpub);
    a.sendMessage(bobPk, "嗨");
    expect(storeA.loadMessages(bobPk)[0]?.status).toBe("failed");
    a.stop();
  });

  it("對方分片滿了（blocked: ceiling:）→ 不判失敗；退避後改送健康的引導座，對方從那裡收到、標成已送中繼", () => {
    vi.useFakeTimers();
    const { skA, skB } = crossShardKeys();
    const bobPk = getPublicKey(skB);
    const bobShard = `${BASE}${shardPath(bobPk)}`;
    const full = new MessageStore({ offlineMaxTotalBytes: 1 }); // 嚴格平面：天花板滿了只拒收
    const net = farm((host) => (host === bobShard ? { store: full } : undefined));
    const { b: a, store: storeA } = backend(skA, "Alice", net.connectorFor("a"), { anchors: [ANCHOR] });
    const { b: bob } = backend(skB, "Bob", net.connectorFor("b"), { anchors: [ANCHOR] });
    const bobGot: ChatMessage[] = [];
    a.start(noop);
    bob.start({ ...noop, onMessage: (_pk, m) => bobGot.push(m) });
    a.addContact(bob.selfNpub);
    bob.addContact(a.selfNpub);

    a.sendMessage(bobPk, "滿了也要到");
    // 第一次：Bob 的分片回 `blocked: ceiling:` → 外送匣排重試，不是失敗
    expect(storeA.loadMessages(bobPk)[0]?.status).toBe("sending");
    expect(bobGot.map((m) => m.text)).not.toContain("滿了也要到");

    vi.advanceTimersByTime(1_000); // 退避 800ms → 泵重送，帶 elsewhere → 同時送到錨點
    expect(bobGot.map((m) => m.text)).toContain("滿了也要到");
    expect(["sent", "delivered"]).toContain(storeA.loadMessages(bobPk)[0]?.status);
    a.stop();
    bob.stop();
  });

  it("冗餘座的拒收不判失敗：只有主路由（對方訊息片）的回覆算數；主路由一直滿，重試耗盡才標失敗", () => {
    vi.useFakeTimers();
    const { skA, skB } = crossShardKeys();
    const bobPk = getPublicKey(skB);
    const bobShard = `${BASE}${shardPath(bobPk)}`;
    const full = new MessageStore({ offlineMaxTotalBytes: 1 });
    // 錨點是白名單站：禮物包一律 `blocked:`（永久）。它只是冗餘座，不能因此把訊息判成失敗。
    const net = farm((host) => (host === bobShard ? { store: full } : host === ANCHOR ? { allowedAuthors: [bobPk] } : undefined));
    const { b: a, store: storeA } = backend(skA, "Alice", net.connectorFor("a"), { anchors: [ANCHOR] });
    a.start(noop);
    a.addContact(backend(skB, "Bob", net.connectorFor("b")).b.selfNpub);
    a.sendMessage(bobPk, "嗨");
    vi.advanceTimersByTime(1_000); // 第一次重送：主路由仍滿、錨點永久拒收
    expect(storeA.loadMessages(bobPk)[0]?.status).toBe("sending");
    vi.advanceTimersByTime(60_000); // 主路由一直滿 → 重試耗盡
    expect(storeA.loadMessages(bobPk)[0]?.status).toBe("failed");
    a.stop();
  });
});
