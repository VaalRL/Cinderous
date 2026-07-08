import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap, type Rumor } from "./nip59.js";
import { receiptOf, wrapReceipt } from "./receipt.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

const rumor = (kind: number, tags: string[][]): Rumor => ({ kind, tags, content: "", created_at: 0, id: "x", pubkey: "p" });

describe("送達/已讀回條（ADR-0058，Gift Wrap 包封）", () => {
  it("收件人可還原送達回條：kind RECEIPT、type=delivered、指向訊息、寄件人", () => {
    const wrap = wrapReceipt("delivered", aliceSk, bobPk, "msg-1");
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    const opened = openWrap(wrap, bobSk);
    expect(opened.sender).toBe(alicePk);
    expect(opened.rumor.kind).toBe(KIND.RECEIPT);
    expect(receiptOf(opened.rumor)).toEqual({ type: "delivered", messageId: "msg-1" });
  });

  it("已讀回條 type=read（水位指向最新已讀訊息）", () => {
    const opened = openWrap(wrapReceipt("read", aliceSk, bobPk, "msg-9"), bobSk);
    expect(receiptOf(opened.rumor)).toEqual({ type: "read", messageId: "msg-9" });
  });

  it("外層作者非寄件人（隱藏誰回誰）、第三者無法解", () => {
    const wrap = wrapReceipt("read", aliceSk, bobPk, "m");
    expect(wrap.pubkey).not.toBe(alicePk);
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("receiptOf：非回條 kind 或缺 e/receipt tag → undefined", () => {
    expect(receiptOf(rumor(KIND.REACTION, [["e", "x"], ["receipt", "read"]]))).toBeUndefined();
    expect(receiptOf(rumor(KIND.RECEIPT, [["e", "x"]]))).toBeUndefined();
    expect(receiptOf(rumor(KIND.RECEIPT, [["receipt", "read"]]))).toBeUndefined();
    expect(receiptOf(rumor(KIND.RECEIPT, [["e", "x"], ["receipt", "bogus"]]))).toBeUndefined();
  });
});
