// 裝置能力回報（ADR-0397）：自己有一台裝置跟不上目前的加密方式時，每台裝置都看得到。
import { buildDeviceReport, generateSecretKey, getPublicKey, nsecEncode, readDeviceReport, type DeviceReport, type NostrEvent } from "@cinderous/core";
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setKvBackend } from "../kv.js";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";
import type { ChatBackendEvents } from "./types.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const kv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

const OLD = getPublicKey(generateSecretKey()); // 另一台裝置的公鑰（要是曲線上的點：開 FS 時會對它加密 EK 分發）

function boot(opts: { appVersion?: string } = {}) {
  vi.useFakeTimers();
  setKvBackend(kv());
  const net = createInMemoryRelayNetwork();
  const sk = generateSecretKey();
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "Alice" });
  // 另一台「裝置」：直接對中繼收發事件（模擬我自己的其他裝置）。先訂閱，才收得到本機開機時發的報告
  const seen: NostrEvent[] = [];
  const other = net.connect("other", { onEvent: (_s, e) => seen.push(e) });
  other.subscribe("all", [{ authors: [getPublicKey(sk)] }]);
  const gaps: unknown[] = [];
  const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice", { ...(opts.appVersion ? { appVersion: opts.appVersion } : {}) });
  a.start({ ...noop, onCapabilityGap: (g) => gaps.push(g) });
  vi.advanceTimersByTime(400_000); // 等第一拍：建立裝置目錄（ADR-0322 S1）
  const report = (r: Omit<DeviceReport, "at">) => other.publish(buildDeviceReport(sk, { ...r, at: Math.floor(Date.now() / 1000) }));
  return { a, sk, gaps, seen, report };
}

afterEach(() => {
  vi.useRealTimers();
  setKvBackend(null);
});

describe("🔴 裝置能力回報（ADR-0397）", () => {
  it("本機一上線就發自己的報告：版號、能力，加密給自己", () => {
    const { a, sk, seen } = boot({ appVersion: "0.0.21" });
    const mine = seen.map((e) => readDeviceReport(e, sk)).find((r) => r?.pk === a.selfDevicePk());
    expect(mine?.ver).toBe("0.0.21");
    expect(mine?.caps).toContain("ek-pq-v1");
    a.stop();
  });

  it("沒開前向保密：沒有要求，未回報的舊裝置不算缺口", () => {
    const { a } = boot();
    a.authorizeDevice(OLD, "舊手機");
    expect(a.capabilityGap()).toEqual({ required: [], devices: [], selfMissing: [] });
    a.stop();
  });

  it("🔴 開了前向保密（公告 pq）：沒發報告的裝置標「未回報」——那正是舊版", () => {
    const { a } = boot();
    a.enableFs();
    a.authorizeDevice(OLD, "舊手機");
    const gap = a.capabilityGap();
    expect(gap.required).toEqual(["ek-pq-v1"]);
    expect(gap.devices).toEqual([{ pk: OLD, label: "舊手機", reported: false, missing: ["ek-pq-v1"] }]);
    a.stop();
  });

  it("報告裡沒有需要的能力：列出缺哪些；補上之後缺口消失、UI 收到通知", () => {
    const { a, report, gaps } = boot();
    a.enableFs();
    a.authorizeDevice(OLD, "舊手機");
    report({ id: "0011223344556677", pk: OLD, ver: "0.0.17", caps: ["ek-v1"] });
    expect((gaps.at(-1) as { devices: unknown[] }).devices).toHaveLength(1); // UI 收到的是「有缺口」
    expect(a.capabilityGap().devices).toEqual([{ pk: OLD, id: "0011223344556677", label: "舊手機", ver: "0.0.17", reported: true, missing: ["ek-pq-v1"] }]);
    report({ id: "0011223344556677", pk: OLD, ver: "0.0.21", caps: ["ek-v1", "ek-pq-v1"] });
    expect(a.capabilityGap().devices).toEqual([]);
    expect(gaps.at(-1)).toEqual({ required: ["ek-pq-v1"], devices: [], selfMissing: [] });
    a.stop();
  });

  it("已移除的裝置不算", () => {
    const { a } = boot();
    a.enableFs();
    a.authorizeDevice(OLD, "舊手機");
    a.removeDevice(OLD);
    expect(a.capabilityGap().devices).toEqual([]);
    a.stop();
  });

  it("🔴 本機跟不上：別台宣告了本機不認得的機制 → 請更新這台", () => {
    const { a, report } = boot();
    a.authorizeDevice(OLD, "新筆電");
    report({ id: "8899aabbccddeeff", pk: OLD, ver: "0.1.0", caps: ["ek-v1", "ek-pq-v1", "ek-pq-v2"] });
    expect(a.capabilityGap().selfMissing).toEqual(["ek-pq-v2"]);
    a.stop();
  });

  it("本機自己的報告不算進缺口，也不讓本機跟自己比", () => {
    const { a } = boot();
    a.enableFs();
    expect(a.capabilityGap()).toEqual({ required: ["ek-pq-v1"], devices: [], selfMissing: [] });
    a.stop();
  });
});
