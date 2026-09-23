import { describe, expect, it } from "vitest";
import {
  discoverCandidates,
  isFreeClearnetRelay,
  normalizeRelayUrl,
  RELAY_DISCOVERY_KIND,
  type DiscoveryEvent,
} from "./discover.js";

const ev = (
  monitor: string,
  url: string,
  extra: string[][] = [["R", "!payment"]],
): DiscoveryEvent => ({
  kind: RELAY_DISCOVERY_KIND,
  pubkey: monitor,
  created_at: 1000,
  tags: [["d", url], ...extra],
});

describe("normalizeRelayUrl", () => {
  it("協定與主機小寫、去尾斜線、去預設埠", () => {
    expect(normalizeRelayUrl("WSS://Relay.Example.COM/")).toBe("wss://relay.example.com");
    expect(normalizeRelayUrl("wss://a.example:443")).toBe("wss://a.example");
    expect(normalizeRelayUrl("ws://a.example:80")).toBe("ws://a.example");
    expect(normalizeRelayUrl("wss://a.example:7777")).toBe("wss://a.example:7777");
  });

  it("🔴 保留路徑——分片路徑（ADR-0241）砍掉就指到別處了", () => {
    expect(normalizeRelayUrl("wss://a.example/s/3")).toBe("wss://a.example/s/3");
  });

  it("非 ws/wss 一律拒絕（30166 的 d 是監測者填的，不保證是 relay URL）", () => {
    for (const bad of ["https://a.example", "not a url", "", "ftp://a.example"]) {
      expect(normalizeRelayUrl(bad), bad).toBeUndefined();
    }
  });
});

describe("isFreeClearnetRelay", () => {
  it("🔴 必須**明說**不收費——「沒說要收費」不算", () => {
    expect(isFreeClearnetRelay(ev("m", "wss://a.example", []))).toBe(false);
    expect(isFreeClearnetRelay(ev("m", "wss://a.example", [["R", "!payment"]]))).toBe(true);
    expect(isFreeClearnetRelay(ev("m", "wss://a.example", [["R", "payment"]]))).toBe(false);
  });

  it("只收 clearnet；沒報網路的視為 clearnet", () => {
    expect(isFreeClearnetRelay(ev("m", "wss://a.example", [["R", "!payment"], ["n", "tor"]]))).toBe(false);
    expect(isFreeClearnetRelay(ev("m", "wss://a.example", [["R", "!payment"], ["n", "clearnet"]]))).toBe(true);
  });

  it("🔴 不因「要求認證」而扣分——我們自己的中繼就要求 NIP-42", () => {
    expect(
      isFreeClearnetRelay(ev("m", "wss://a.example", [["R", "!payment"], ["R", "auth"]])),
    ).toBe(true);
  });
});

describe("discoverCandidates", () => {
  it("需要多位監測者同意（NIP-66：SHOULD NOT trust a single source）", () => {
    const one = discoverCandidates([ev("m1", "wss://a.example")]);
    expect(one).toEqual([]);
    const two = discoverCandidates([ev("m1", "wss://a.example"), ev("m2", "wss://a.example")]);
    expect(two.map((c) => c.url)).toEqual(["wss://a.example"]);
    expect(two[0]?.monitors).toBe(2);
  });

  it("🔴 同一位監測者發十顆也只算一票——否則多來源那道防線是假的", () => {
    const spam = Array.from({ length: 10 }, () => ev("m1", "wss://a.example"));
    expect(discoverCandidates(spam)).toEqual([]);
  });

  it("已知的站不再列為候選（比對走正規化後的字串）", () => {
    const events = [ev("m1", "wss://Known.example/"), ev("m2", "wss://known.example")];
    expect(discoverCandidates(events, { known: ["wss://known.example"] })).toEqual([]);
  });

  it("非 30166 的事件一律忽略", () => {
    const wrong = [{ ...ev("m1", "wss://a.example"), kind: 1 }, { ...ev("m2", "wss://a.example"), kind: 1 }];
    expect(discoverCandidates(wrong)).toEqual([]);
  });

  it("回報最低的 open RTT，壞值當成沒報", () => {
    const events = [
      ev("m1", "wss://a.example", [["R", "!payment"], ["rtt-open", "300"]]),
      ev("m2", "wss://a.example", [["R", "!payment"], ["rtt-open", "120"]]),
      ev("m3", "wss://a.example", [["R", "!payment"], ["rtt-open", "abc"]]),
    ];
    expect(discoverCandidates(events)[0]).toMatchObject({ rttMs: 120, monitors: 3 });
  });

  it("🔴 排序依監測者數與 URL，**不依 RTT**——RTT 是本地量測值", () => {
    // 依 RTT 排會讓不同地點的人拿到不同順序，而這份清單是要給人比對的。
    const events = [
      ev("m1", "wss://b.example", [["R", "!payment"], ["rtt-open", "10"]]),
      ev("m2", "wss://b.example", [["R", "!payment"], ["rtt-open", "10"]]),
      ev("m1", "wss://a.example", [["R", "!payment"], ["rtt-open", "900"]]),
      ev("m2", "wss://a.example", [["R", "!payment"], ["rtt-open", "900"]]),
      ev("m3", "wss://a.example", [["R", "!payment"]]),
    ];
    expect(discoverCandidates(events).map((c) => c.url)).toEqual([
      "wss://a.example", // 3 位監測者（雖然 RTT 高得多）
      "wss://b.example",
    ]);
  });

  it("minMonitors 可調（單一監測者的環境仍可用，但要明確指定）", () => {
    expect(discoverCandidates([ev("m1", "wss://a.example")], { minMonitors: 1 })).toHaveLength(1);
  });
});
