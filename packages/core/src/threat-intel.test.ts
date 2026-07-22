import { describe, expect, it } from "vitest";
import { matchThreat, urlHost, type ThreatDb } from "./threat-intel.js";

const db: ThreatDb = {
  sources: [
    { id: "urlhaus", name: "URLhaus" },
    { id: "custom", name: "我的封鎖清單" },
  ],
  domains: new Map([
    ["urlhaus", new Set(["evil.com", "malware.example"])],
    ["custom", new Set(["blocked.test"])],
  ]),
};

describe("urlHost（ADR-0231）", () => {
  it("取 host、去 www、小寫；非 http(s)／壞 URL 回 null", () => {
    expect(urlHost("https://WWW.Evil.com/path?x=1")).toBe("evil.com");
    expect(urlHost("http://sub.evil.com")).toBe("sub.evil.com");
    expect(urlHost("ftp://x.com")).toBeNull();
    expect(urlHost("not a url")).toBeNull();
  });
});

describe("matchThreat（ADR-0231）", () => {
  it("命中回來源；子網域命中母網域", () => {
    expect(matchThreat(db, "evil.com").map((s) => s.id)).toEqual(["urlhaus"]);
    expect(matchThreat(db, "a.b.evil.com").map((s) => s.id)).toEqual(["urlhaus"]);
    expect(matchThreat(db, "blocked.test").map((s) => s.id)).toEqual(["custom"]);
  });
  it("未命中回空；防子網域偽裝（evil.com.attacker.net 不算 evil.com）", () => {
    expect(matchThreat(db, "safe.com")).toEqual([]);
    expect(matchThreat(db, "evil.com.attacker.net")).toEqual([]);
  });
  it("多來源同時命中回多來源", () => {
    const db2: ThreatDb = {
      sources: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      domains: new Map([
        ["a", new Set(["x.com"])],
        ["b", new Set(["x.com"])],
      ]),
    };
    expect(matchThreat(db2, "x.com").map((s) => s.id)).toEqual(["a", "b"]);
  });
});
