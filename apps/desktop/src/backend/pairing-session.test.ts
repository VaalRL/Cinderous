import type { PairTransport } from "@cinder/core";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import { createPairingOffer, PAIRING_TTL_MS, type PairTransportFactory, runPairSource, runPairTarget } from "./pairing-session.js";

/** 記憶體雙工對接：source/target 各取一端（模擬 WebRTC 資料通道）。 */
function memoryTransportFactory(): PairTransportFactory {
  const inbox: Record<string, Uint8Array[]> = { source: [], target: [] };
  const handlers: Record<string, ((d: Uint8Array) => void) | undefined> = {};
  const deliver = (to: string, d: Uint8Array) => {
    const h = handlers[to];
    if (h) h(d);
    else inbox[to]!.push(d);
  };
  return async (role, _key, _relayUrl) => {
    const peer = role === "source" ? "target" : "source";
    const transport: PairTransport = {
      send: (d) => deliver(peer, d),
      onMessage(h) {
        handlers[role] = h;
        for (const d of inbox[role]!.splice(0)) h(d);
      },
      close() {},
    };
    return transport;
  };
}

function sourceStorage(): MemoryStorage {
  const s = new MemoryStorage();
  s.saveIdentity({ nsec: "nsec1old", name: "我" });
  s.addContact({ pubkey: "bob", name: "Bob" });
  s.appendMessage({ id: "m1", contact: "bob", outgoing: true, text: "完整歷史", at: 1 });
  return s;
}

describe("配對會期編排（ADR-0072 D4a）", () => {
  it("端到端：SAS 兩端一致、確認後新機取得可套用的全量捆包", async () => {
    const { offer, key } = createPairingOffer("wss://home", 1000);
    expect(offer.expiresAt).toBe(1000 + PAIRING_TTL_MS);
    const transport = memoryTransportFactory();
    let sourceSas = "";
    let targetSas = "";

    const [sent, bundle] = await Promise.all([
      runPairSource({
        key,
        storage: sourceStorage(),
        profile: { relayUrl: "wss://home", cloudSync: "basic" },
        transport,
        confirmSas: async (s) => {
          sourceSas = s;
          return true;
        },
      }),
      runPairTarget({ code: offer.code, transport, onSas: (s) => (targetSas = s) }),
    ]);

    expect(sent).toBe(true);
    expect(sourceSas).toBe(targetSas);
    expect(bundle.relayUrl).toBe("wss://home");
    expect(bundle.cloudSync).toBe("basic");
    expect(bundle.snapshot.identity?.nsec).toBe("nsec1old");
    expect(bundle.snapshot.messages.bob?.[0]?.text).toBe("完整歷史");
  });

  it("舊機拒絕 SAS：不送包、新機收到拒絕錯誤", async () => {
    const { offer, key } = createPairingOffer("wss://home");
    const transport = memoryTransportFactory();
    const [sent, err] = await Promise.all([
      runPairSource({
        key,
        storage: sourceStorage(),
        profile: { relayUrl: "wss://home" },
        transport,
        confirmSas: async () => false,
      }),
      runPairTarget({ code: offer.code, transport }).then(
        () => "no-error",
        (e: Error) => e.message,
      ),
    ]);
    expect(sent).toBe(false);
    expect(err).toContain("拒絕");
  });

  it("載荷帶會合 relay：新機（尚無設定）據此連到同一座中繼站", async () => {
    const { offer } = createPairingOffer("wss://meet.example");
    const seen: string[] = [];
    const factory: PairTransportFactory = async (_role, _key, relayUrl) => {
      seen.push(relayUrl);
      throw new Error("stop-after-relay-resolved"); // 只驗 relay 解析，不跑協定
    };
    await expect(runPairTarget({ code: offer.code, transport: factory })).rejects.toThrow("stop-after-relay-resolved");
    expect(seen).toEqual(["wss://meet.example"]);
  });

  it("非法載荷立即拋錯（不建立傳輸）", async () => {
    await expect(runPairTarget({ code: "not a payload", transport: memoryTransportFactory() })).rejects.toThrow();
  });
});
