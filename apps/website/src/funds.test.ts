import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import { type FundsData, runwayMonths, signFunds, TRANSPARENCY_PUBKEY, verifyFunds } from "./funds.js";

const sample: FundsData = {
  balance: 1000,
  currency: "USD",
  monthlyBurn: 200,
  updatedAt: "2026-07-12T00:00:00Z",
  allocations: [{ period: "2026-06", nodeOps: 180, bonuses: 20, other: 0, note: "x" }],
};

describe("funds 簽章透明度（ADR-0090）", () => {
  it("signFunds→verifyFunds 往返一致", () => {
    const sk = generateSecretKey();
    expect(verifyFunds(signFunds(sample, sk), getPublicKey(sk))).toEqual(sample);
  });

  it("非釘死公鑰簽的 → null（fail-closed，作者不符）", () => {
    expect(verifyFunds(signFunds(sample, generateSecretKey()))).toBeNull();
  });

  it("竄改內容 → 簽章失效 null", () => {
    const sk = generateSecretKey();
    const event = signFunds(sample, sk);
    const tampered = { ...event, content: event.content.replace("1000", "999999") };
    expect(verifyFunds(tampered, getPublicKey(sk))).toBeNull();
  });

  it("內容形狀非法（缺 allocations）→ null", () => {
    const sk = generateSecretKey();
    const bad = signFunds({ ...sample, allocations: [{ period: "x" } as never] }, sk);
    expect(verifyFunds(bad, getPublicKey(sk))).toBeNull();
  });

  it("runwayMonths：balance/burn；burn≤0 → Infinity", () => {
    expect(runwayMonths(sample)).toBeCloseTo(5);
    expect(runwayMonths({ ...sample, monthlyBurn: 0 })).toBe(Infinity);
  });

  it("附帶的佔位 public/funds.json 能對釘死透明度公鑰驗簽通過", () => {
    const raw = readFileSync(resolve(process.cwd(), "public/funds.json"), "utf8");
    const data = verifyFunds(JSON.parse(raw), TRANSPARENCY_PUBKEY);
    expect(data).not.toBeNull();
    expect(data?.currency).toBe("USD");
  });
});
