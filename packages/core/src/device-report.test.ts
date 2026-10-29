import { describe, expect, it } from "vitest";
import { buildDeviceReport, DEVICE_REPORT_KIND, readDeviceReport, type DeviceReport } from "./device-report.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";

const sk = generateSecretKey();
const report: DeviceReport = { id: "a1b2c3d4e5f60718", pk: "ab".repeat(32), ver: "0.0.21", caps: ["ek-v1", "ek-pq-v1"], at: 1_800_000_000 };

describe("裝置報告（ADR-0397）", () => {
  it("往返：可尋址、d＝裝置 id、內容加密給自己", () => {
    const evt = buildDeviceReport(sk, report);
    expect(evt.kind).toBe(DEVICE_REPORT_KIND);
    expect(evt.tags).toEqual([["d", report.id]]);
    expect(evt.content).not.toContain("ek-pq-v1"); // 版號與能力不給中繼看
    expect(evt.content).not.toContain("0.0.21");
    expect(readDeviceReport(evt, sk)).toEqual(report);
  });

  it("別人發的、解不開的一律丟", () => {
    const other = generateSecretKey();
    expect(readDeviceReport(buildDeviceReport(other, report), sk)).toBeNull();
  });

  it("d tag 與內容的 id 不符：丟（不讓一台替另一台報）", () => {
    const evt = buildDeviceReport(sk, report);
    const forged = finalizeEvent({ kind: evt.kind, created_at: evt.created_at, tags: [["d", "ffffffffffffffff"]], content: evt.content }, sk);
    expect(readDeviceReport(forged, sk)).toBeNull();
  });

  it("畸形內容：丟；未知欄位不影響、能力字串過長或太多也丟", () => {
    expect(readDeviceReport(buildDeviceReport(sk, { ...report, caps: ["x".repeat(17)] }), sk)).toBeNull();
    expect(readDeviceReport(buildDeviceReport(sk, { ...report, caps: Array.from({ length: 33 }, (_, i) => `c${i}`) }), sk)).toBeNull();
    expect(readDeviceReport(buildDeviceReport(sk, { ...report, pk: "zz" }), sk)).toBeNull();
    const { ver: _ver, ...noVer } = report;
    expect(readDeviceReport(buildDeviceReport(sk, noVer), sk)).toEqual(noVer); // 版號可省
    expect(getPublicKey(sk)).toMatch(/^[0-9a-f]{64}$/);
  });
});
