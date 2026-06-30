import { describe, expect, it } from "vitest";
import { KIND, TYPING_TIMEOUT_MS } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { verifyEvent } from "./sign.js";
import { createTyping, TypingTracker } from "./typing.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobPk = getPublicKey(generateSecretKey());

describe("正在輸入中（Kind 20001 / Ephemeral）", () => {
  it("產生 kind 20001、指向對話對象、驗章通過", () => {
    const e = createTyping(aliceSk, bobPk, { created_at: 1 });
    expect(e.kind).toBe(KIND.TYPING);
    expect(e.pubkey).toBe(alicePk);
    expect(e.tags).toContainEqual(["p", bobPk]);
    expect(verifyEvent(e)).toBe(true);
  });
});

describe("TypingTracker — 短暫顯示後清除", () => {
  it("收到後於逾時前顯示輸入中，逾時後清除", () => {
    const t = new TypingTracker();
    const tSec = 1_700_000_000;
    t.observe(alicePk, tSec);
    const now = tSec * 1000;
    expect(t.isTyping(alicePk, now)).toBe(true);
    expect(t.isTyping(alicePk, now + TYPING_TIMEOUT_MS)).toBe(true);
    expect(t.isTyping(alicePk, now + TYPING_TIMEOUT_MS + 1)).toBe(false);
  });

  it("未收到者不顯示輸入中", () => {
    expect(new TypingTracker().isTyping(alicePk, Date.now())).toBe(false);
  });
});
