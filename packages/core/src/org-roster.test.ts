import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "./keys.js";
import {
  diffRoster,
  type OrgRosterDoc,
  rosterAllowlist,
  shouldAdoptRoster,
  signOrgRoster,
  verifyOrgRoster,
} from "./org-roster.js";

const adminSk = generateSecretKey();
const admin = getPublicKey(adminSk);
const a = getPublicKey(generateSecretKey());
const b = getPublicKey(generateSecretKey());

const doc = (members: OrgRosterDoc["members"], updatedAt = 1000): OrgRosterDoc => ({ org: "Acme", members, updatedAt });

describe("org-roster 簽章名冊（ADR-0047）", () => {
  it("sign/verify round-trip", () => {
    const ev = signOrgRoster(doc([{ pubkey: a, name: "Alice" }, { pubkey: b, name: "Bob", relayUrl: "wss://r" }]), adminSk);
    const out = verifyOrgRoster(ev, admin);
    expect(out?.org).toBe("Acme");
    expect(out?.members.map((m) => m.pubkey)).toEqual([a, b]);
    expect(out?.members[1]?.relayUrl).toBe("wss://r");
  });

  it("以 pubkey 去重", () => {
    const ev = signOrgRoster(doc([{ pubkey: a, name: "A1" }, { pubkey: a, name: "A2" }]), adminSk);
    expect(verifyOrgRoster(ev, admin)?.members.length).toBe(1);
  });

  it("作者非指定管理者 → null", () => {
    const ev = signOrgRoster(doc([{ pubkey: a, name: "Alice" }]), adminSk);
    expect(verifyOrgRoster(ev, a)).toBeNull();
  });

  it("內容被竄改（簽章失效）→ null", () => {
    const ev = signOrgRoster(doc([{ pubkey: a, name: "Alice" }]), adminSk);
    const tampered = { ...ev, content: ev.content.replace("Alice", "Eve") };
    expect(verifyOrgRoster(tampered, admin)).toBeNull();
  });

  it("空成員（防清空）→ null", () => {
    const ev = signOrgRoster(doc([]), adminSk);
    expect(verifyOrgRoster(ev, admin)).toBeNull();
  });

  it("shouldAdopt：較新才取代、無現值即採用、較舊/相等不取代", () => {
    const cur = doc([{ pubkey: a, name: "A" }], 1000);
    expect(shouldAdoptRoster(null, cur)).toBe(true);
    expect(shouldAdoptRoster(cur, doc([{ pubkey: a, name: "A" }], 1001))).toBe(true);
    expect(shouldAdoptRoster(cur, doc([{ pubkey: a, name: "A" }], 1000))).toBe(false);
    expect(shouldAdoptRoster(cur, doc([{ pubkey: a, name: "A" }], 999))).toBe(false);
  });

  it("rosterAllowlist 取出 pubkey 供 relay 佈建", () => {
    expect(rosterAllowlist(doc([{ pubkey: a, name: "A" }, { pubkey: b, name: "B" }]))).toEqual([a, b]);
  });

  it("diffRoster：算出新增/移除、排除自己", () => {
    const prev = doc([{ pubkey: admin, name: "Me" }, { pubkey: a, name: "Alice" }]);
    const next = doc([{ pubkey: admin, name: "Me" }, { pubkey: b, name: "Bob" }]); // a 離職、b 新增
    const { toAdd, toRemove } = diffRoster(prev, next, admin);
    expect(toAdd.map((m) => m.pubkey)).toEqual([b]);
    expect(toRemove).toEqual([a]);
  });

  it("diffRoster：無前值時全部為新增（除自己）", () => {
    const { toAdd, toRemove } = diffRoster(null, doc([{ pubkey: admin, name: "Me" }, { pubkey: a, name: "Alice" }]), admin);
    expect(toAdd.map((m) => m.pubkey)).toEqual([a]);
    expect(toRemove).toEqual([]);
  });
});
