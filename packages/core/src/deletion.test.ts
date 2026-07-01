import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { deletionTarget, wrapDeletion } from "./deletion.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap } from "./nip59.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

describe("收回訊息（NIP-09，Gift Wrap 包封）", () => {
  it("收件人可還原收回：kind 5、指向目標與寄件人", () => {
    const wrap = wrapDeletion(aliceSk, bobPk, "target-event-id");
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    const { sender, rumor } = openWrap(wrap, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.kind).toBe(KIND.DELETE);
    expect(deletionTarget(rumor)).toBe("target-event-id");
  });

  it("外層作者非寄件人（隱藏誰收回）、第三者無法解", () => {
    const wrap = wrapDeletion(aliceSk, bobPk, "t1");
    expect(wrap.pubkey).not.toBe(alicePk);
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });
});
