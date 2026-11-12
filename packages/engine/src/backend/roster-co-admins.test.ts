// 組織名冊的共同管理者（ADR-0418；SDK ADR 0135）：任一位管理者可簽名冊，只有擁有者能改管理者名單。
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, OrgInfo } from "./types.js";
import { RelayChatBackend } from "./relay-backend.js";

/** secp256k1 生成點 G 的 x 座標：測試用的合法第三人 pubkey。 */
const G = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/** 擁有者＋兩位成員（甲、乙）；回傳時擁有者已發首份名冊，甲是共同管理者。 */
function setup() {
  const net = createInMemoryRelayNetwork({ store: new MessageStore() });
  const owner = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("o", h), "老闆", { orgOwner: true });
  owner.start(noop);
  const infoA: OrgInfo[] = [];
  const storeA = new MemoryStorage();
  const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "甲", { orgAdminPubkey: owner.self.pubkey });
  a.start({ ...noop, onOrgInfo: (i) => infoA.push(i) });
  const storeB = new MemoryStorage();
  const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "乙", { orgAdminPubkey: owner.self.pubkey });
  b.start(noop);
  const members = [
    { pubkey: owner.self.pubkey, name: "老闆" },
    { pubkey: a.self.pubkey, name: "甲" },
    { pubkey: b.self.pubkey, name: "乙" },
  ];
  owner.publishRoster("小公司", members, undefined, undefined, { admins: [a.self.pubkey] });
  return { net, owner, a, b, storeA, storeB, members, infoA };
}

describe("共同管理者（ADR-0418）", () => {
  it("擁有者列了共同管理者 → 成員端知道誰是共同管理者；共同管理者自己 isOrgCoAdmin()", () => {
    const { owner, a, b, infoA } = setup();
    expect(a.isOrgCoAdmin()).toBe(true);
    expect(b.isOrgCoAdmin()).toBe(false);
    expect(owner.isOrgCoAdmin()).toBe(false);
    expect(infoA.at(-1)?.coAdmin).toBe(true);
    expect(owner.currentRoster()?.admins).toEqual([a.self.pubkey]);
    owner.stop();
    a.stop();
    b.stop();
  });

  it("共同管理者發布的名冊：其他成員與擁有者都採用（加人、改政策）", () => {
    const { owner, a, b, storeB, members } = setup();
    const c = G; // 合法的曲線點（重啟後會對新聯絡人發個人檔，假 pubkey 會失敗）
    a.publishRoster("小公司", [...members, { pubkey: c, name: "丙" }], { disableStickers: true });
    expect(storeB.loadContacts().map((x) => x.pubkey)).toContain(c);
    expect(b.currentRoster()?.policy?.disableStickers).toBe(true);
    // 擁有者也記下最新的（下次發布才不會蓋掉共同管理者的修改）
    expect(owner.currentRoster()?.members.map((m) => m.pubkey)).toContain(c);
    // 共同管理者簽的名冊不帶 admins，但大家記得的管理者名單不變
    expect(b.currentRoster()?.admins).toEqual([a.self.pubkey]);
    owner.stop();
    a.stop();
    b.stop();
  });

  it("🔴 共同管理者不能改管理者名單：它發布的名冊沒有 admins 欄位，名單照擁有者的", () => {
    const { owner, a, b, members } = setup();
    a.publishRoster("小公司", members, undefined, undefined, { admins: [a.self.pubkey, b.self.pubkey] });
    expect(b.isOrgCoAdmin()).toBe(false);
    expect(owner.currentRoster()?.admins).toEqual([a.self.pubkey]);
    owner.stop();
    a.stop();
    b.stop();
  });

  it("🔴 共同管理者不能把管理者移出成員：publishRoster 直接拒絕（不發出會被大家丟掉的名冊）", () => {
    const { owner, a, b, members } = setup();
    expect(() => a.publishRoster("小公司", members.filter((m) => m.pubkey !== a.self.pubkey))).toThrow("roster-drops-admin");
    owner.stop();
    a.stop();
    b.stop();
  });

  it("擁有者把共同管理者移出名單 → 它失去權限；之後它簽的名冊沒人採用", () => {
    const { owner, a, b, storeB, members } = setup();
    owner.publishRoster("小公司", members, undefined, undefined, { admins: [] });
    expect(a.isOrgCoAdmin()).toBe(false);
    expect(owner.currentRoster()?.admins).toBeUndefined();
    // 甲（已不是共同管理者）硬發一份：乙不採用
    const c = G; // 合法的曲線點（重啟後會對新聯絡人發個人檔，假 pubkey 會失敗）
    a.publishRoster("小公司", [...members, { pubkey: c, name: "丙" }]);
    expect(storeB.loadContacts().map((x) => x.pubkey)).not.toContain(c);
    owner.stop();
    a.stop();
    b.stop();
  });

  it("擁有者其他發布路徑（沒給 admins）保留現有的共同管理者名單", () => {
    const { owner, a, b, members } = setup();
    owner.publishRoster("小公司", members, { disableCalls: true });
    expect(owner.currentRoster()?.admins).toEqual([a.self.pubkey]);
    expect(a.isOrgCoAdmin()).toBe(true);
    owner.stop();
    a.stop();
    b.stop();
  });

  it("重啟後的成員：先收到共同管理者的名冊、再收到擁有者的也能接上（重新訂閱補回）", () => {
    const { net, owner, a, b, members } = setup();
    const c = G; // 合法的曲線點（重啟後會對新聯絡人發個人檔，假 pubkey 會失敗）
    a.publishRoster("小公司", [...members, { pubkey: c, name: "丙" }]);
    b.stop();
    const storeB2 = new MemoryStorage();
    const b2 = new RelayChatBackend(storeB2, (h) => net.connect("b2", h), "乙", { orgAdminPubkey: owner.self.pubkey });
    b2.start(noop);
    expect(storeB2.loadContacts().map((x) => x.pubkey)).toContain(c);
    owner.stop();
    a.stop();
    b2.stop();
  });
});
