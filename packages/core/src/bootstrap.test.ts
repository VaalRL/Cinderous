import { describe, expect, it } from "vitest";
import {
  dedupeRelays,
  listEntries,
  mergeBootstrapPool,
  migrationTarget,
  pickWeighted,
  normalizeRelay,
  shouldAdoptList,
  signRelayList,
  verifyRelayList,
  type RelayListDoc,
} from "./bootstrap.js";
import { RELAY_LIST_KIND } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";

const maintSk = generateSecretKey();
const maintPk = getPublicKey(maintSk);

describe("relay 正規化與去重（ADR-0039）", () => {
  it("normalizeRelay：去尾斜線、小寫 host、拒非 ws(s)", () => {
    expect(normalizeRelay("wss://Node2.Example.com/")).toBe("wss://node2.example.com");
    expect(normalizeRelay(" ws://localhost:8787 ")).toBe("ws://localhost:8787");
    expect(normalizeRelay("https://x")).toBeUndefined();
    expect(normalizeRelay("garbage")).toBeUndefined();
  });

  it("dedupeRelays：正規化後去重、保留順序", () => {
    expect(dedupeRelays(["wss://a.com", "wss://a.com/", "wss://B.com", "bad"])).toEqual([
      "wss://a.com",
      "wss://b.com",
    ]);
  });
});

describe("簽章清單 sign/verify（ADR-0039）", () => {
  const doc: RelayListDoc = { relays: ["wss://node2.example.com", "wss://node3.example.com"], updatedAt: 1000 };

  it("維護者簽章的清單通過驗簽並取回文件", () => {
    const event = signRelayList(doc, maintSk);
    expect(event.kind).toBe(RELAY_LIST_KIND);
    expect(verifyRelayList(event, maintPk)).toEqual(doc);
  });

  it("非維護者作者被拒", () => {
    const otherSk = generateSecretKey();
    const forged = signRelayList(doc, otherSk);
    expect(verifyRelayList(forged, maintPk)).toBeNull();
  });

  it("竄改內容（簽章對不上）被拒", () => {
    const event = signRelayList(doc, maintSk);
    const tampered = { ...event, content: JSON.stringify({ relays: ["wss://evil.com"], updatedAt: 9999 }) };
    expect(verifyRelayList(tampered, maintPk)).toBeNull();
  });

  it("空清單 / 非法內容 / 錯 kind 被拒", () => {
    expect(verifyRelayList(signRelayList({ relays: [], updatedAt: 1 }, maintSk), maintPk)).toBeNull();
    const badJson = finalizeEvent(
      { kind: RELAY_LIST_KIND, created_at: 1, tags: [], content: "not json" },
      maintSk,
    );
    expect(verifyRelayList(badJson, maintPk)).toBeNull();
    const wrongKind = finalizeEvent(
      { kind: 1, created_at: 1, tags: [], content: JSON.stringify(doc) },
      maintSk,
    );
    expect(verifyRelayList(wrongKind, maintPk)).toBeNull();
  });
});

describe("採用策略 shouldAdoptList（ADR-0039 防清空）", () => {
  it("較新才取代；無 current 時採用；節點不足拒絕", () => {
    const cur: RelayListDoc = { relays: ["wss://a.com"], updatedAt: 100 };
    expect(shouldAdoptList(null, cur)).toBe(true);
    expect(shouldAdoptList(cur, { relays: ["wss://b.com"], updatedAt: 200 })).toBe(true);
    expect(shouldAdoptList(cur, { relays: ["wss://b.com"], updatedAt: 50 })).toBe(false); // 較舊
    expect(shouldAdoptList(cur, { relays: ["wss://b.com"], updatedAt: 100 })).toBe(false); // 同時
    expect(shouldAdoptList(null, { relays: [], updatedAt: 999 })).toBe(false); // 空
  });
});

describe("引導 pool 合併 mergeBootstrapPool（ADR-0039）", () => {
  it("錨點在前、清單與 extra 併入、正規化去重", () => {
    const pool = mergeBootstrapPool(
      ["wss://anchor1.example", "wss://anchor2.example"],
      ["wss://node2.example.com", "wss://anchor1.example/"], // 與錨點重複
      ["wss://home.example", "wss://node2.example.com"], // 與清單重複
    );
    expect(pool).toEqual([
      "wss://anchor1.example",
      "wss://anchor2.example",
      "wss://node2.example.com",
      "wss://home.example",
    ]);
  });
});

describe("清單 entries 擴充（ADR-0069）", () => {
  it("sign/verify 帶 entries 往返：非法項濾除、URL 正規化、retired 保留", () => {
    const doc: RelayListDoc = {
      relays: ["wss://a", "wss://b"],
      entries: [
        { url: "wss://a" },
        { url: "wss://b/", accepting: false, weight: 3, status: "draining" },
        { url: "https://bad" },
        { url: "wss://c", status: "retired" },
      ],
      updatedAt: 100,
    };
    const verified = verifyRelayList(signRelayList(doc, maintSk), maintPk)!;
    expect(verified.entries?.map((e) => e.url)).toEqual(["wss://a", "wss://b", "wss://c"]);
    const mat = listEntries(verified);
    expect(mat[0]).toEqual({ url: "wss://a", accepting: true, weight: 1, status: "ok" });
    expect(mat[1]).toEqual({ url: "wss://b", accepting: false, weight: 3, status: "draining" });
    expect(mat[2]?.status).toBe("retired");
  });

  it("舊清單相容：無 entries 時 listEntries 由 relays 物化為 ok 座；舊欄位驗證不變", () => {
    const evt = signRelayList({ relays: ["wss://a"], updatedAt: 1 }, maintSk);
    const verified = verifyRelayList(evt, maintPk)!;
    expect(verified.entries).toBeUndefined();
    expect(listEntries(verified)).toEqual([{ url: "wss://a", accepting: true, weight: 1, status: "ok" }]);
  });

  it("pickWeighted（I4 自動分配）：只在 accepting 且 ok 中加權隨機；rand 注入可測", () => {
    const entries = listEntries({
      relays: [],
      entries: [
        { url: "wss://a", weight: 1 },
        { url: "wss://b", weight: 3 },
        { url: "wss://c", accepting: false },
        { url: "wss://d", status: "draining" },
      ],
      updatedAt: 1,
    });
    expect(pickWeighted(entries, 0)).toBe("wss://a"); // 權重累計 [0,1) → a
    expect(pickWeighted(entries, 0.26)).toBe("wss://b"); // [1,4) → b
    expect(pickWeighted(entries, 0.99)).toBe("wss://b");
    expect(pickWeighted([], 0.5)).toBeUndefined();
  });

  it("migrationTarget（I2/I3 搬家目標）：清單序首個 accepting 且 ok、排除指定座（決定性防 split-brain）", () => {
    const entries = listEntries({
      relays: [],
      entries: [
        { url: "wss://old", status: "retired" },
        { url: "wss://busy", accepting: false },
        { url: "wss://next" },
        { url: "wss://other" },
      ],
      updatedAt: 1,
    });
    expect(migrationTarget(entries, "wss://old")).toBe("wss://next");
    expect(migrationTarget(entries, "wss://next")).toBe("wss://other");
    expect(migrationTarget(listEntries({ relays: ["wss://x"], updatedAt: 1 }), "wss://x")).toBeUndefined();
  });
});
