import { describe, expect, it } from "vitest";
import { generateEncryptionKey, openWrapWithEks } from "./subkey.js";
import { KIND } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap } from "./nip59.js";
import { reactionTarget, wrapReaction } from "./reaction.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

describe("訊息回應（NIP-25，Gift Wrap 包封）", () => {
  it("收件人可還原回應：kind 7、指向目標、emoji 與寄件人", () => {
    const wrap = wrapReaction("👍", aliceSk, bobPk, "target-event-id").events[0]!;
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    const { sender, rumor } = openWrap(wrap, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.kind).toBe(KIND.REACTION);
    expect(rumor.content).toBe("👍");
    expect(reactionTarget(rumor)).toBe("target-event-id");
  });

  it("外層作者非寄件人（隱藏誰回應誰）、第三者無法解", () => {
    const wrap = wrapReaction("❤️", aliceSk, bobPk, "t1").events[0]!;
    expect(wrap.pubkey).not.toBe(alicePk);
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("自封副本（ADR-0107）：自己在另一台裝置也看得到自己按的回應", () => {
    const w = wrapReaction("🎉", aliceSk, bobPk, "msg-1");
    expect(w.selfCopy.tags).toContainEqual(["p", alicePk]);
    const { sender, rumor } = openWrap(w.selfCopy, aliceSk);
    expect(sender).toBe(alicePk); // 收端據此把 mine 標為 true
    expect(reactionTarget(rumor)).toBe("msg-1");
    expect(rumor.content).toBe("🎉");
  });
});

describe("回應的 FS retarget（ADR-0315 第 3 步）", () => {
  const alice = generateSecretKey();
  const bobIk = generateSecretKey();
  const bobPk = getPublicKey(bobIk);
  const carolIk = generateSecretKey();
  const carolPk = getPublicKey(carolIk);
  const bobEk = generateEncryptionKey();

  it("🔴 **id 不變**——群組扇出時跨成員一致，不得隨金鑰輪替改變", () => {
    const plain = wrapReaction("👍", alice, [bobPk], "m1", { now: 1 });
    const fs = wrapReaction("👍", alice, [bobPk], "m1", { now: 1, encryptToFor: () => bobEk.pk });
    expect(fs.id).toBe(plain.id);
  });

  it("加密到 EK：EK 解得開、身分解不開（＝真的 retarget）", () => {
    const w = wrapReaction("❤️", alice, [bobPk], "m1", { now: 1, encryptToFor: () => bobEk.pk });
    const ev = w.events[0]!;
    expect(openWrapWithEks(ev, [bobEk.sk]).rumor.content).toBe("❤️");
    expect(() => openWrapWithEks(ev, [bobIk])).toThrow();
    expect(ev.tags).toContainEqual(["p", bobPk]); // 外層 #p 仍為身分（路由）
  });

  it("群組扇出逐位決定：Bob 有 EK、Carol 沒有 → 同一則回應混合", () => {
    const w = wrapReaction("🎉", alice, [bobPk, carolPk], "m1", {
      now: 1,
      encryptToFor: (pk) => (pk === bobPk ? bobEk.pk : pk),
    });
    const forBob = w.events.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === bobPk))!;
    const forCarol = w.events.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === carolPk))!;
    expect(openWrapWithEks(forBob, [bobEk.sk]).rumor.content).toBe("🎉");
    expect(() => openWrapWithEks(forBob, [bobIk])).toThrow();
    expect(openWrapWithEks(forCarol, [carolIk]).rumor.content).toBe("🎉"); // 退回身分，照樣收得到
  });
});
