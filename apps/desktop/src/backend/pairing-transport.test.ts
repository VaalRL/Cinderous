import { createPairing, type NostrEvent, type RelayClientHandlers } from "@cinder/core";
import { createInMemoryRelayNetwork } from "@cinder/relay";
import { describe, expect, it } from "vitest";
import { createPairingSignal } from "./pairing-transport.js";
import type { RelayConnector } from "./relay-backend.js";

function connectorOf(net: ReturnType<typeof createInMemoryRelayNetwork>, prefix: string): RelayConnector {
  let n = 0;
  return (h: RelayClientHandlers) => net.connect(`${prefix}-${n++}`, h);
}

describe("配對信令會合（ADR-0072 D4a-3）", () => {
  it("同鑰兩端經 relay 互通；自己的回音忽略；竊聽者只見密文", () => {
    const net = createInMemoryRelayNetwork();
    const { key } = createPairing("", "room");
    const spied: NostrEvent[] = [];
    const spy = net.connect("spy", { onEvent: (_s, e) => spied.push(e) });
    spy.subscribe("s", [{ kinds: [21003] } as never]);

    const gotA: Record<string, unknown>[] = [];
    const gotB: Record<string, unknown>[] = [];
    const a = createPairingSignal({ key, relayUrl: "", connector: connectorOf(net, "a"), onMessage: (m) => gotA.push(m) });
    const b = createPairingSignal({ key, relayUrl: "", connector: connectorOf(net, "b"), onMessage: (m) => gotB.push(m) });

    a.send({ t: "offer", sdp: "祕密SDP-A" });
    b.send({ t: "answer", sdp: "祕密SDP-B" });

    expect(gotB.map((m) => m.t)).toEqual(["offer"]); // b 收到 a 的、沒收到自己的
    expect(gotA.map((m) => m.t)).toEqual(["answer"]);
    expect(gotB[0]?.sdp).toBe("祕密SDP-A");
    // 竊聽者：看得到事件（拋棄 pubkey 自我收發），內容全密文
    expect(spied.length).toBe(2);
    expect(JSON.stringify(spied)).not.toContain("祕密SDP");
    a.close();
    b.close();
  });

  it("異鑰（不同配對場次）互不干擾：解不開即忽略", () => {
    const net = createInMemoryRelayNetwork();
    const { key: k1 } = createPairing("", "r1");
    const { key: k2 } = createPairing("", "r2");
    const got1: unknown[] = [];
    const s1 = createPairingSignal({ key: k1, relayUrl: "", connector: connectorOf(net, "s1"), onMessage: (m) => got1.push(m) });
    const s2 = createPairingSignal({ key: k2, relayUrl: "", connector: connectorOf(net, "s2"), onMessage: () => {} });
    s2.send({ t: "offer", sdp: "x" }); // 不同房間（不同 roomPk）＋不同金鑰
    expect(got1).toHaveLength(0);
    s1.close();
    s2.close();
  });

  it("requireAuth relay：房間金鑰可通過 NIP-42（鑰匙持有即身分），互通不受影響", () => {
    const net = createInMemoryRelayNetwork({ requireAuth: true });
    const { key } = createPairing("", "room");
    const gotB: Record<string, unknown>[] = [];
    const a = createPairingSignal({ key, relayUrl: "wss://r", connector: connectorOf(net, "a"), onMessage: () => {} });
    const b = createPairingSignal({ key, relayUrl: "wss://r", connector: connectorOf(net, "b"), onMessage: (m) => gotB.push(m) });
    a.send({ t: "offer", sdp: "authed" });
    expect(gotB.map((m) => m.t)).toEqual(["offer"]);
    a.close();
    b.close();
  });
});
