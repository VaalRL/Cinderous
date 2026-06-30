import { describe, expect, it } from "vitest";
import {
  generateSecretKey,
  getPublicKey,
  npubDecode,
  npubEncode,
  nsecDecode,
  nsecEncode,
} from "./keys.js";

describe("金鑰生成（secp256k1 / Nostr NIP-01）", () => {
  it("產生 32 bytes 私鑰，且每次不同", () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("由私鑰導出 32 bytes x-only 公鑰（hex），且為確定性", () => {
    const sk = generateSecretKey();
    const pk1 = getPublicKey(sk);
    const pk2 = getPublicKey(sk);
    expect(pk1).toMatch(/^[0-9a-f]{64}$/);
    expect(pk1).toBe(pk2);
  });
});

describe("NIP-19 bech32 編碼", () => {
  it("npub 以 npub1 起頭並可往返解碼回同一公鑰", () => {
    const pk = getPublicKey(generateSecretKey());
    const npub = npubEncode(pk);
    expect(npub.startsWith("npub1")).toBe(true);
    expect(npubDecode(npub)).toBe(pk);
  });

  it("nsec 以 nsec1 起頭並可往返解碼回同一私鑰", () => {
    const sk = generateSecretKey();
    const nsec = nsecEncode(sk);
    expect(nsec.startsWith("nsec1")).toBe(true);
    expect(Buffer.from(nsecDecode(nsec)).equals(Buffer.from(sk))).toBe(true);
  });

  it("以錯誤的前綴解碼時應拋錯（npub 不可當 nsec 解）", () => {
    const npub = npubEncode(getPublicKey(generateSecretKey()));
    expect(() => nsecDecode(npub)).toThrow();
  });
});
