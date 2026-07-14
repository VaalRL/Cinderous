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
    const wrap = wrapDeletion(aliceSk, bobPk, "target-event-id").events[0]!;
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    const { sender, rumor } = openWrap(wrap, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.kind).toBe(KIND.DELETE);
    expect(deletionTarget(rumor)).toBe("target-event-id");
  });

  it("外層作者非寄件人（隱藏誰收回）、第三者無法解", () => {
    const wrap = wrapDeletion(aliceSk, bobPk, "t1").events[0]!;
    expect(wrap.pubkey).not.toBe(alicePk);
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("自封副本（ADR-0107）：收回也送自己一份——否則在手機收回的訊息會留在自己的電腦上", () => {
    const w = wrapDeletion(aliceSk, bobPk, "msg-1");
    // 這**不是**便利功能，是隱私不變式：使用者按了收回，就不該在自己任何一台裝置上留存。
    expect(w.selfCopy.tags).toContainEqual(["p", alicePk]); // 落進 Alice 自己的收件箱
    const { sender, rumor } = openWrap(w.selfCopy, aliceSk); // Alice 的另一台裝置
    expect(sender).toBe(alicePk);
    expect(rumor.kind).toBe(KIND.DELETE);
    expect(deletionTarget(rumor)).toBe("msg-1"); // 指向同一則 → 那台也會 markDeleted
  });
});
