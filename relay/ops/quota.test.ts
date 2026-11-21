// 錨點額度警示（ADR-0427）：判定與報告是純函式，GraphQL 回應形狀用固定樣本鎖住。
// 真的打 Cloudflare API 只在 workflow 裡做（需要唯讀 token）。
import { describe, expect, it } from "vitest";
import { FREE_LIMITS, evaluateUsage, parseUsage, quotaQuery, quotaReport, quotaVars, utcDate } from "./quota.js";

const sample = (o: { w?: number; d?: number; r?: number; wr?: number; s?: number[] } = {}) => ({
  data: {
    viewer: {
      accounts: [
        {
          workers: [{ sum: { requests: o.w ?? 0 } }],
          doInvocations: [{ sum: { requests: o.d ?? 0 } }],
          doPeriodic: [{ sum: { rowsRead: o.r ?? 0, rowsWritten: o.wr ?? 0 } }],
          doStorage: (o.s ?? [0]).map((b) => ({ max: { storedBytes: b } })),
        },
      ],
    },
  },
  errors: null,
});

describe("quotaQuery／quotaVars", () => {
  it("一次查四項：Worker 請求、DO 請求、DO 讀寫列、DO 儲存", () => {
    const q = quotaQuery();
    for (const k of ["workersInvocationsAdaptive", "durableObjectsInvocationsAdaptiveGroups", "durableObjectsPeriodicGroups", "durableObjectsSqlStorageGroups", "rowsRead", "rowsWritten", "storedBytes"]) {
      expect(q).toContain(k);
    }
  });
  it("帶帳號與 UTC 日期（額度每天 00:00 UTC 重算）", () => {
    expect(quotaVars("acct", "2026-11-21")).toEqual({ account: "acct", date: "2026-11-21" });
  });
  it("utcDate 用 UTC，不是本機時區", () => {
    expect(utcDate(new Date("2026-11-21T23:30:00-08:00"))).toBe("2026-11-22");
  });
});

describe("parseUsage", () => {
  it("把四項加總起來；儲存是各 namespace 的最大值相加", () => {
    expect(parseUsage(sample({ w: 10, d: 20, r: 30, wr: 40, s: [100, 200] }))).toEqual({
      workerRequests: 10,
      doRequests: 20,
      rowsRead: 30,
      rowsWritten: 40,
      storedBytes: 300,
    });
  });
  it("今天還沒有資料（空陣列）＝0，不是錯誤", () => {
    const empty = { data: { viewer: { accounts: [{ workers: [], doInvocations: [], doPeriodic: [], doStorage: [] }] } }, errors: null };
    expect(parseUsage(empty)).toEqual({ workerRequests: 0, doRequests: 0, rowsRead: 0, rowsWritten: 0, storedBytes: 0 });
  });
  it("🔴 API 回錯誤要丟出來——token 過期時不能安靜地回報「一切正常」", () => {
    expect(() => parseUsage({ data: null, errors: [{ message: "not authorized" }] })).toThrow(/not authorized/);
  });
  it("🔴 找不到帳號（account id 打錯）也要丟出來", () => {
    expect(() => parseUsage({ data: { viewer: { accounts: [] } }, errors: null })).toThrow(/帳號/);
  });
});

describe("evaluateUsage", () => {
  it("都在 70% 以下＝沒有警示", () => {
    expect(evaluateUsage(parseUsage(sample({ r: 3_000_000 })))).toEqual([]);
  });
  it("🔴 讀取列數到 70% 就警示（2026-10-22 錨點 1 就是讀取列數用完停一整天）", () => {
    const f = evaluateUsage(parseUsage(sample({ r: 3_600_000 })));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ metric: "rowsRead", used: 3_600_000, limit: FREE_LIMITS.rowsRead });
    expect(f[0]!.ratio).toBeCloseTo(0.72);
  });
  it("多項同時超過全部列出，最嚴重的排前面", () => {
    const f = evaluateUsage(parseUsage(sample({ w: 99_000, wr: 75_000 })));
    expect(f.map((x) => x.metric)).toEqual(["workerRequests", "rowsWritten"]);
  });
  it("門檻可調", () => {
    expect(evaluateUsage(parseUsage(sample({ wr: 50_000 })), 0.5)).toHaveLength(1);
  });
  it("儲存看總量 5 GB", () => {
    expect(evaluateUsage(parseUsage(sample({ s: [4_000_000_000] })))[0]?.metric).toBe("storedBytes");
  });
});

describe("quotaReport", () => {
  it("每項都列出用量與百分比；超過門檻的標出來", () => {
    const u = parseUsage(sample({ r: 3_600_000, w: 1_000 }));
    const md = quotaReport("錨點 1", "2026-11-21", u, evaluateUsage(u));
    expect(md).toContain("錨點 1");
    expect(md).toContain("2026-11-21");
    expect(md).toContain("72.0%");
    expect(md).toMatch(/🔴.*DO 讀取列數/);
    expect(md).toContain("1.0%");
  });
});
