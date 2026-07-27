// 威脅情報產生器純邏輯測試（ADR-0248）。以 Node 內建 runner 執行（無相依）：
//   node --test scripts/threat-snapshot.test.mjs
// 只測與 I/O 無關的核心：解析、絕不封鎖比對、多-feed 聯集＋逐-feed 記憶、變動量護欄。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardTripped, isNeverBlocked, parseHosts, unionWithMemory } from "./threat-snapshot.mjs";

describe("parseHosts", () => {
  it("抽出 hosts 網域、去 www.、濾註解與佔位條目", () => {
    const got = parseHosts(["# comment", "0.0.0.0 bad.example", "127.0.0.1 www.evil.test", "0.0.0.0 localhost", ""].join("\n"));
    assert.deepEqual([...got].sort(), ["bad.example", "evil.test"]);
  });

  it("濾掉非法網域（單段、空白）", () => {
    const got = parseHosts(["0.0.0.0 nodot", "0.0.0.0 ok.tld"].join("\n"));
    assert.deepEqual([...got], ["ok.tld"]);
  });

  it("絕不封鎖網域即使上游列出也不收（apex 精確）", () => {
    const got = parseHosts(["0.0.0.0 google.com", "0.0.0.0 ads.google.com"].join("\n"));
    assert.deepEqual([...got], ["ads.google.com"]); // apex 擋、子網域收
  });
});

describe("isNeverBlocked", () => {
  it("apex 精確：本身受保護、子網域不受", () => {
    assert.equal(isNeverBlocked("google.com"), true);
    assert.equal(isNeverBlocked("ads.google.com"), false);
  });
  it("自家基礎設施：後綴（含子網域）受保護", () => {
    assert.equal(isNeverBlocked("cinder-relay.jt0856.workers.dev"), true);
    assert.equal(isNeverBlocked("x.cinder-relay.jt0856.workers.dev"), true);
    assert.equal(isNeverBlocked("evil.workers.dev"), false); // 不整片放行共享網域
  });
});

describe("unionWithMemory（多-feed 聯集＋逐-feed 記憶）", () => {
  const feeds = ["A", "B"];

  it("兩 feed 皆新鮮：去重排序聯集", () => {
    const { domains } = unionWithMemory(feeds, { A: ["b.tld", "a.tld"], B: ["a.tld", "c.tld"] });
    assert.deepEqual(domains, ["a.tld", "b.tld", "c.tld"]);
  });

  it("某 feed 失敗但有記憶：聯集不縮水（核心止血）", () => {
    const { domains } = unionWithMemory(feeds, { A: null, B: ["c.tld"] }, { A: ["a.tld", "b.tld"] });
    assert.deepEqual(domains, ["a.tld", "b.tld", "c.tld"]);
  });

  it("全 feed 失敗且無記憶：回 null（呼叫端保留上一版）", () => {
    const { domains } = unionWithMemory(feeds, { A: null, B: null }, {});
    assert.equal(domains, null);
  });

  it("全 feed 失敗但有記憶：仍用記憶聯集、非 null", () => {
    const { domains } = unionWithMemory(feeds, { A: null, B: null }, { A: ["a.tld"], B: ["b.tld"] });
    assert.deepEqual(domains, ["a.tld", "b.tld"]);
  });

  it("feedMemory：新鮮者記新的、失敗者沿用記憶", () => {
    const { feedMemory } = unionWithMemory(feeds, { A: ["fresh.tld"], B: null }, { B: ["remembered.tld"] });
    assert.deepEqual(feedMemory.A, ["fresh.tld"]);
    assert.deepEqual(feedMemory.B, ["remembered.tld"]);
  });

  it("fresh=[]（200 但解析 0 筆）視同失敗：不覆寫記憶、聯集不縮水（審查修正）", () => {
    const { domains, feedMemory } = unionWithMemory(feeds, { A: [], B: ["c.tld"] }, { A: ["a.tld", "b.tld"] });
    assert.deepEqual(domains, ["a.tld", "b.tld", "c.tld"]); // A 的記憶仍在聯集
    assert.deepEqual(feedMemory.A, ["a.tld", "b.tld"]); // 記憶未被空陣列清空
  });

  it("全 feed 皆空陣列且無記憶：回 null（不把來源寫成空）", () => {
    const { domains } = unionWithMemory(feeds, { A: [], B: [] }, {});
    assert.equal(domains, null);
  });
});

describe("guardTripped（變動量護欄）", () => {
  it("門檻內不觸發", () => {
    assert.equal(guardTripped(120, 100, 0.5), false);
    assert.equal(guardTripped(60, 100, 0.5), false);
  });
  it("超門檻觸發", () => {
    assert.equal(guardTripped(700, 368, 0.5), true); // 換源造成的舊病：+90%
    assert.equal(guardTripped(40, 100, 0.5), true); // -60%
  });
  it("首次建立／空前版不觸發", () => {
    assert.equal(guardTripped(999, 0, 0.5), false);
    assert.equal(guardTripped(999, undefined, 0.5), false);
  });
});
