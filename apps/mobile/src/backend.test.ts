import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "@cinder/core";
import { describe, expect, it } from "vitest";
import type { MobileIdentity } from "./auth.js";
import { createBackend, DEFAULT_RELAY } from "./backend.js";

function identity(name = "我"): MobileIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { sk, pubkey, npub: npubEncode(pubkey), nsec: nsecEncode(sk), name };
}

describe("行動端後端選擇（ADR-0086）", () => {
  it("無 relayUrl → 示範後端（記憶體＋機器人），self 名沿用身分名", () => {
    const backend = createBackend(identity("阿夜"), null);
    expect(backend.self.name).toBe("阿夜");
    backend.stop();
  });

  it("有 relayUrl → 真實 relay 後端，身分由 nsec 導出（同帳號、不連線僅建構）", () => {
    const id = identity();
    const backend = createBackend(id, "wss://relay.example");
    expect(backend.self.pubkey).toBe(id.pubkey);
    expect(backend.selfNpub).toBe(id.npub);
    expect(backend.self.name).toBe("我");
    backend.stop();
  });

  it("DEFAULT_RELAY 為 wss:// 生產中繼站", () => {
    expect(DEFAULT_RELAY).toMatch(/^wss:\/\//);
  });
});
