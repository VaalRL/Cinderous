import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { getEventHash } from "./event.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { encryptDM } from "./nip44.js";
import { finalizeEvent } from "./sign.js";
import { messageExpiry, unwrapMessage, wrapMessage } from "./giftwrap.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

describe("NIP-17/59 Gift Wrap 離線私訊", () => {
  it("收件人可還原內容與寄件人身分", () => {
    const wrap = wrapMessage("晚點打給你 🤙", aliceSk, bobPk, { now: 1_700_000_000 });
    const { sender, rumor } = unwrapMessage(wrap, bobSk);
    expect(sender).toBe(alicePk);
    expect(rumor.content).toBe("晚點打給你 🤙");
    expect(rumor.kind).toBe(14);
    expect(rumor.created_at).toBe(1_700_000_000);
  });

  it("外層為 kind 1059、帶 #p 收件人與 NIP-40 過期，且作者非寄件人（隱藏社交圖譜）", () => {
    const now = 1_700_000_000;
    const wrap = wrapMessage("hi", aliceSk, bobPk, { now });
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    expect(wrap.tags).toContainEqual(["p", bobPk]);
    const exp = wrap.tags.find((t) => t[0] === "expiration");
    expect(exp).toBeDefined();
    expect(Number(exp?.[1])).toBe(now + 7 * 86400);
    // 外層作者為一次性金鑰，不可洩漏寄件人 Alice
    expect(wrap.pubkey).not.toBe(alicePk);
  });

  it("可自訂過期時間", () => {
    const wrap = wrapMessage("hi", aliceSk, bobPk, { now: 1000, expiration: 1234 });
    expect(wrap.tags.find((t) => t[0] === "expiration")?.[1]).toBe("1234");
  });

  it("限時訊息：rumor 內帶到期 tag，外層 wrap 過期同時縮短", () => {
    const now = 1_700_000_000;
    const disappearAt = now + 60;
    const wrap = wrapMessage("閱後即焚", aliceSk, bobPk, { now, disappearAt });
    // 外層 wrap 過期縮短為到期時間（利於中繼清除）
    expect(Number(wrap.tags.find((t) => t[0] === "expiration")?.[1])).toBe(disappearAt);
    // 收件端解密後可從 rumor 讀出到期時間
    const { rumor } = unwrapMessage(wrap, bobSk);
    expect(messageExpiry(rumor)).toBe(disappearAt);
  });

  it("一般訊息 rumor 不帶到期 tag（messageExpiry 為 undefined）", () => {
    const { rumor } = unwrapMessage(wrapMessage("hi", aliceSk, bobPk), bobSk);
    expect(messageExpiry(rumor)).toBeUndefined();
  });

  it("第三者無法解開", () => {
    const wrap = wrapMessage("for bob", aliceSk, bobPk);
    const eveSk = generateSecretKey();
    expect(() => unwrapMessage(wrap, eveSk)).toThrow();
  });

  it("偽造寄件人（rumor 作者 ≠ seal 簽章者）會被拒", () => {
    const mallorySk = generateSecretKey();
    // Mallory 製作一個假冒 Alice 的 rumor，但只能用自己的金鑰簽 seal
    const rumor = {
      pubkey: alicePk,
      created_at: 1000,
      kind: 14,
      tags: [] as string[][],
      content: "我是 Alice（假的）",
    };
    const forgedRumor = { id: getEventHash(rumor), ...rumor };
    const seal = finalizeEvent(
      {
        kind: 13,
        created_at: 1000,
        tags: [],
        content: encryptDM(JSON.stringify(forgedRumor), mallorySk, bobPk),
      },
      mallorySk,
    );
    const wrapSk = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: KIND.OFFLINE_DM_GIFT_WRAP,
        created_at: 1000,
        tags: [["p", bobPk]],
        content: encryptDM(JSON.stringify(seal), wrapSk, bobPk),
      },
      wrapSk,
    );
    expect(() => unwrapMessage(wrap, bobSk)).toThrow();
  });
});
