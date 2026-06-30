import { describe, expect, it } from "vitest";
import { getEventHash } from "./event.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

describe("事件簽章與驗章（secp256k1 Schnorr / BIP-340）", () => {
  const sk = generateSecretKey();
  const evt = finalizeEvent(
    { kind: 20000, created_at: 1700000000, tags: [], content: "" },
    sk,
  );

  it("finalizeEvent 補上 pubkey、id 與 64-byte sig", () => {
    expect(evt.pubkey).toBe(getPublicKey(sk));
    expect(evt.id).toBe(getEventHash(evt));
    expect(evt.id).toMatch(/^[0-9a-f]{64}$/);
    expect(evt.sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it("合法事件驗章通過", () => {
    expect(verifyEvent(evt)).toBe(true);
  });

  it("竄改 content（id 不再相符）驗章失敗", () => {
    expect(verifyEvent({ ...evt, content: "tampered" })).toBe(false);
  });

  it("竄改 sig 驗章失敗", () => {
    const badSig = (evt.sig[0] === "0" ? "1" : "0") + evt.sig.slice(1);
    expect(verifyEvent({ ...evt, sig: badSig })).toBe(false);
  });

  it("他人公鑰無法冒充（pubkey 不符簽章）", () => {
    const otherPk = getPublicKey(generateSecretKey());
    const forged = { ...evt, pubkey: otherPk };
    expect(verifyEvent(forged)).toBe(false);
  });
});
