// 威脅情報 snapshot 拉取與快取（ADR-0231 P2）：opt-in 開關、快取 round-trip、失敗靜默。
import { setKvBackend, type KvStore } from "@cinderous/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  lastThreatFetch,
  loadCachedThreatDb,
  refreshThreatDb,
  setThreatIntelEnabled,
  threatIntelEnabled,
} from "./threat-db.js";

const SNAPSHOT = {
  updated: "2026-07-22",
  sources: [{ id: "urlhaus", name: "URLhaus", url: "https://urlhaus.abuse.ch" }],
  domains: { urlhaus: ["evil.com"] },
};

const mem = new Map<string, string>();
const memKv: KvStore = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
};

beforeEach(() => setKvBackend(memKv));
afterEach(() => {
  setKvBackend(null);
  mem.clear();
});

describe("threatIntelEnabled（opt-in）", () => {
  it("預設開；關閉／重開往返", () => {
    expect(threatIntelEnabled()).toBe(true);
    setThreatIntelEnabled(false);
    expect(threatIntelEnabled()).toBe(false);
    setThreatIntelEnabled(true);
    expect(threatIntelEnabled()).toBe(true);
  });
});

describe("refreshThreatDb／loadCachedThreatDb", () => {
  const okFetch = (body: unknown): typeof fetch =>
    (() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })) as unknown as typeof fetch;

  it("成功 → 回 ThreatDb＋寫快取＋記時間；快取可還原", async () => {
    const db = await refreshThreatDb(okFetch(SNAPSHOT), "https://x/threat-intel.json", 1234);
    expect(db).not.toBeNull();
    expect(db!.domains.get("urlhaus")!.has("evil.com")).toBe(true);
    expect(lastThreatFetch()).toBe(1234);
    const cached = loadCachedThreatDb();
    expect(cached!.sources[0]!.name).toBe("URLhaus");
  });

  it("HTTP 失敗／壞 JSON／壞形狀 → 靜默 null、不動快取", async () => {
    const notOk = (() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch;
    const throws = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    await expect(refreshThreatDb(notOk, "https://x", 1)).resolves.toBeNull();
    await expect(refreshThreatDb(throws, "https://x", 1)).resolves.toBeNull();
    await expect(refreshThreatDb(okFetch({ sources: [], domains: {} }), "https://x", 1)).resolves.toBeNull();
    expect(loadCachedThreatDb()).toBeNull();
    expect(lastThreatFetch()).toBeNull();
  });

  it("無快取／快取壞資料 → null", () => {
    expect(loadCachedThreatDb()).toBeNull();
    memKv.setItem("nb.threatIntel.snapshot", "not-json");
    expect(loadCachedThreatDb()).toBeNull();
  });
});
