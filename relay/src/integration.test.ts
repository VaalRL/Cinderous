import { describe, expect, it } from "vitest";
import {
  createHeartbeat,
  createSignal,
  generateSecretKey,
  getPublicKey,
  PresenceTracker,
  readSignal,
  RelayClient,
  SDP_SIGNAL_KIND,
  type NostrEvent,
  type RelayClientHandlers,
  unwrapMessage,
  wrapMessage,
} from "@nostr-buddy/core";
import { MessageStore } from "./message-store.js";
import { RelayCore } from "./relay-core.js";

/** 以 RelayCore 為中心，在記憶體中串接多個 RelayClient（無真實網路）。 */
function makeNetwork(nowSec: number) {
  const core = new RelayCore({ store: new MessageStore(), now: () => nowSec });
  const clients = new Map<string, RelayClient>();
  return {
    connect(connId: string, handlers: RelayClientHandlers = {}): RelayClient {
      core.connect(connId);
      const client = new RelayClient(
        {
          send: (data) => {
            for (const out of core.handle(connId, data)) {
              clients.get(out.to)?.receive(JSON.stringify(out.message));
            }
          },
        },
        handlers,
      );
      clients.set(connId, client);
      return client;
    },
  };
}

describe("端到端：上線心跳", () => {
  it("Bob 訂閱後收到 Alice 的心跳並判定為上線", () => {
    const now = 1_700_000_000;
    const net = makeNetwork(now);
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);

    const received: NostrEvent[] = [];
    const bob = net.connect("bob", { onEvent: (_sub, e) => received.push(e) });
    bob.subscribe("presence", [{ kinds: [20000], authors: [alicePk] }]);

    const alice = net.connect("alice");
    alice.publish(createHeartbeat(aliceSk, { created_at: now }));

    expect(received).toHaveLength(1);

    const tracker = new PresenceTracker();
    const hb = received[0]!;
    tracker.observe(hb.pubkey, hb.created_at);
    expect(tracker.statusOf(alicePk, now * 1000)).toBe("online");
  });
});

describe("端到端：離線 Gift Wrap 留言", () => {
  it("Alice 離線留言、Bob 稍後上線訂閱並解出內容與寄件人", () => {
    const now = 1_700_000_000;
    const net = makeNetwork(now);
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);

    // Bob 不在線；Alice 送出 Gift Wrap → 由 relay 持久化
    const alice = net.connect("alice");
    alice.publish(wrapMessage("離線留言測試 🕊️", aliceSk, bobPk, { now }));

    // Bob 稍後上線，訂閱自己的 Gift Wrap
    const got: NostrEvent[] = [];
    const bob = net.connect("bob", { onEvent: (_sub, e) => got.push(e) });
    bob.subscribe("dm", [{ kinds: [1059], "#p": [bobPk] }]);

    expect(got).toHaveLength(1);
    const { sender, rumor } = unwrapMessage(got[0]!, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.content).toBe("離線留言測試 🕊️");
  });
});

describe("端到端：WebRTC SDP 信令經中繼交換", () => {
  it("雙方上線時，Alice 的 offer 經 ephemeral 扇出抵達 Bob 並解出", () => {
    const now = 1_700_000_000;
    const net = makeNetwork(now);
    const aliceSk = generateSecretKey();
    const alicePk = getPublicKey(aliceSk);
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);

    // Bob 先訂閱自己的信令（ephemeral 不儲存，須先在線）
    const got: NostrEvent[] = [];
    const bob = net.connect("bob", { onEvent: (_sub, e) => got.push(e) });
    bob.subscribe("signal", [{ kinds: [SDP_SIGNAL_KIND], "#p": [bobPk] }]);

    // Alice 送出 offer 信令
    const alice = net.connect("alice");
    alice.publish(createSignal({ type: "offer", sdp: "v=0...offer" }, aliceSk, bobPk, { now }));

    expect(got).toHaveLength(1);
    const { sender, signal } = readSignal(got[0]!, bobSk);
    expect(sender).toBe(alicePk);
    expect(signal).toEqual({ type: "offer", sdp: "v=0...offer" });
  });
});
