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

// ADR-0235 M3：佔位金鑰絆線。
//
// `TRANSPARENCY_PUBKEY` 目前是**開發用佔位金鑰**，`public/funds.json` 也是示範資料。
// 現況安全，因為透明度頁已下架（App.tsx 的 import／路由都註解掉了）。危險的是「某天有人
// 把頁面接回去、卻忘了換金鑰」——那時官網會用一把來歷不明的金鑰驗簽並顯示假的資金數字，
// 而「簽章式資金透明度」這個賣點會變成純粹的裝飾。
//
// 這份測試把那個順序鎖死：頁面接回去的**同一刻**，這裡就會紅。
describe("透明度佔位金鑰絆線（ADR-0235 M3）", () => {
  const PLACEHOLDER = "7fb989c676cce640d545919144ef1f9a65009a79c573cea451e822bd16b5f5a3";
  const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  /** 透明度頁是否已接回 App（非註解的 import）。 */
  const wired = /^\s*import\s+\{\s*Transparency\s*\}/m.test(appSource);

  it("若透明度頁已接回 App，TRANSPARENCY_PUBKEY 就不得再是佔位金鑰", () => {
    if (wired) {
      expect(TRANSPARENCY_PUBKEY).not.toBe(PLACEHOLDER);
    } else {
      // 頁面仍下架：佔位金鑰可以留著，但要確認它真的還是那一把（避免默默換成別的東西）。
      expect(TRANSPARENCY_PUBKEY).toBe(PLACEHOLDER);
    }
  });

  it("佔位資料只在頁面下架時可接受", () => {
    const funds = JSON.parse(readFileSync(new URL("../public/funds.json", import.meta.url), "utf8")) as {
      content: string;
    };
    if (wired) expect(funds.content).not.toContain("佔位");
  });
});
