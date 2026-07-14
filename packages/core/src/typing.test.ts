import { describe, expect, it } from "vitest";
import { KIND, TYPING_TIMEOUT_MS } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { createNudge, readNudge } from "./nudge.js";
import { verifyEvent } from "./sign.js";
import { createTyping, readTyping, TypingTracker } from "./typing.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

describe("正在輸入中／敲一下（Ephemeral，NIP-59 封裝——ADR-0120）", () => {
  it("🔴 **外層看不到寄件人**——中繼拿不到「Alice → Bob」這條已簽章的邊", () => {
    const e = createTyping(aliceSk, bobPk, { created_at: 1 });

    expect(e.kind).toBe(KIND.TYPING); // 仍是 ephemeral kind → 中繼不落盤
    expect(e.pubkey).not.toBe(alicePk); // ← 這一行就是整個 ADR-0120
    expect(verifyEvent(e)).toBe(true); // 外層由一次性臨時金鑰簽名，仍是合法事件

    // 明文 tag 只剩收件人——與 kind 1059 完全一致。中繼必須知道要轉發給誰。
    expect(e.tags).toContainEqual(["p", bobPk]);
    expect(JSON.stringify(e.tags)).not.toContain(alicePk);
    expect(e.content).not.toContain(alicePk); // 寄件人在 seal 裡，且已加密
  });

  it("收件人解得開，且拿得到**經驗證的**寄件人", () => {
    expect(readTyping(createTyping(aliceSk, bobPk), bobSk)).toBe(alicePk);
    expect(readNudge(createNudge(aliceSk, bobPk), bobSk)).toBe(alicePk);
  });

  it("**別人解不開**（連中繼也不行——它只有公開資料）", () => {
    const e = createTyping(aliceSk, bobPk);
    expect(() => readTyping(e, generateSecretKey())).toThrow();
  });

  it("nudge 同樣封裝（原本是 `finalizeEvent` 真名直發）", () => {
    const e = createNudge(aliceSk, bobPk);
    expect(e.kind).toBe(KIND.NUDGE);
    expect(e.pubkey).not.toBe(alicePk);
    expect(e.tags).toContainEqual(["p", bobPk]);
  });

  it("每次封裝的外層作者都不同——中繼無法靠外層 pubkey 把多則 typing 串成同一個人", () => {
    const a = createTyping(aliceSk, bobPk);
    const b = createTyping(aliceSk, bobPk);
    expect(a.pubkey).not.toBe(b.pubkey);
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
