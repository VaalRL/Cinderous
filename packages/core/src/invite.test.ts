import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap, type Rumor } from "./nip59.js";
import { makeOrgInvite, newInviteToken, parseOrgInvite, parseOrgJoin, wrapOrgJoin } from "./invite.js";

const adminSk = generateSecretKey();
const adminPk = getPublicKey(adminSk);
const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);

const rumor = (kind: number, content: string): Rumor => ({ kind, tags: [], content, created_at: 0, id: "x", pubkey: "p" });

describe("入職邀請碼（ADR-0156）", () => {
  const invite = { relayUrl: "wss://corp.example", adminPubkey: adminPk, token: "aabbccdd00112233" };

  it("make/parse round-trip：欄位原樣還原、前綴可辨識", () => {
    const code = makeOrgInvite(invite);
    expect(code.startsWith("cinderinvite1")).toBe(true);
    expect(code).not.toContain(" "); // 單一 token，複製不易斷
    expect(parseOrgInvite(code)).toEqual({ v: 1, ...invite });
  });

  it("嵌在整段邀請信文字中也抽得出來（員工貼整封信）", () => {
    const code = makeOrgInvite(invite);
    const mail = `哈囉，歡迎加入！\n請開 Cinderous 並在登入畫面貼上：\n${code}\n有問題找我。`;
    expect(parseOrgInvite(mail)?.adminPubkey).toBe(adminPk);
    expect(parseOrgInvite(mail)?.relayUrl).toBe("wss://corp.example");
  });

  it("壞輸入回 null：一般名字、壞 base64、壞欄位（非 wss、非 64hex、空權杖）", () => {
    expect(parseOrgInvite("小明")).toBeNull();
    expect(parseOrgInvite("cinderinvite1%%%%")).toBeNull();
    expect(parseOrgInvite(makeOrgInvite({ ...invite, relayUrl: "http://x" }))).toBeNull();
    expect(parseOrgInvite(makeOrgInvite({ ...invite, adminPubkey: "not-hex" }))).toBeNull();
    expect(parseOrgInvite(makeOrgInvite({ ...invite, token: "" }))).toBeNull();
  });

  it("escrow 旗標（ADR-0163）：round-trip；未帶＝undefined", () => {
    expect(parseOrgInvite(makeOrgInvite({ ...invite, escrow: true }))?.escrow).toBe(true);
    expect(parseOrgInvite(makeOrgInvite(invite))?.escrow).toBeUndefined();
  });

  it("newInviteToken：夠長、每次不同", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("入職請求（ADR-0156，加密 rumor）", () => {
  it("wrap/parse round-trip：管理者可解、寄件人正確、第三者不可解", () => {
    const wrap = wrapOrgJoin({ name: "小美", token: "tok123" }, memberSk, adminPk);
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    const opened = openWrap(wrap, adminSk);
    expect(opened.sender).toBe(memberPk);
    expect(opened.rumor.kind).toBe(KIND.ORG_JOIN);
    expect(parseOrgJoin(opened.rumor)).toEqual({ name: "小美", token: "tok123" });
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("金鑰託管（ADR-0163）：wrapOrgJoin 帶 nsec → 管理者解出；未帶＝undefined；壞 nsec 丟棄", () => {
    const nsec = "nsec1" + "q".repeat(58);
    const opened = openWrap(wrapOrgJoin({ name: "小美", token: "t", nsec }, memberSk, adminPk), adminSk);
    expect(parseOrgJoin(opened.rumor)?.nsec).toBe(nsec);
    const none = openWrap(wrapOrgJoin({ name: "小美", token: "t" }, memberSk, adminPk), adminSk);
    expect(parseOrgJoin(none.rumor)?.nsec).toBeUndefined();
    expect(parseOrgJoin(rumor(KIND.ORG_JOIN, JSON.stringify({ name: "x", token: "t", nsec: "notansec" })))?.nsec).toBeUndefined();
  });

  it("parseOrgJoin：非入職 kind、壞 JSON、空名/空權杖 → null；名稱去空白", () => {
    expect(parseOrgJoin(rumor(KIND.CHAT, JSON.stringify({ name: "x", token: "t" })))).toBeNull();
    expect(parseOrgJoin(rumor(KIND.ORG_JOIN, "not json"))).toBeNull();
    expect(parseOrgJoin(rumor(KIND.ORG_JOIN, JSON.stringify({ name: " ", token: "t" })))).toBeNull();
    expect(parseOrgJoin(rumor(KIND.ORG_JOIN, JSON.stringify({ name: "x", token: "" })))).toBeNull();
    expect(parseOrgJoin(rumor(KIND.ORG_JOIN, JSON.stringify({ name: " 小美 ", token: "t" })))?.name).toBe("小美");
  });
});
