import { describe, expect, it } from "vitest";
import { AUTH_KIND, authChallengeOf, buildAuthEvent } from "./nip42.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { verifyEvent } from "./sign.js";

describe("NIP-42 AUTH（ADR-0057）", () => {
  it("buildAuthEvent：kind 22242、帶 relay/challenge tag、簽章有效、作者為簽章者", () => {
    const sk = generateSecretKey();
    const ev = buildAuthEvent("chal-abc", "wss://relay.example", sk);
    expect(ev.kind).toBe(AUTH_KIND);
    expect(ev.pubkey).toBe(getPublicKey(sk));
    expect(verifyEvent(ev)).toBe(true);
    expect(ev.tags).toContainEqual(["relay", "wss://relay.example"]);
    expect(ev.tags).toContainEqual(["challenge", "chal-abc"]);
  });

  it("authChallengeOf：取回 challenge tag 值；無則 undefined", () => {
    const ev = buildAuthEvent("xyz-123", "wss://r", generateSecretKey());
    expect(authChallengeOf(ev)).toBe("xyz-123");
    expect(authChallengeOf({ ...ev, tags: [] })).toBeUndefined();
  });
});
