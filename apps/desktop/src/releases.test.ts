import { describe, expect, it } from "vitest";
import { RELEASES, releaseFor } from "./releases.js";
import { APP_VERSION } from "./version.js";

// ADR-0227 P4：__RELEASES__ 由 vite `define` 注入（源自 docs/releases.json 單一雙語來源）。
describe("RELEASES（ADR-0227 P4）", () => {
  it("注入為非空陣列、每筆含 zh/en 條目", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    for (const r of RELEASES) {
      expect(Array.isArray(r.zh)).toBe(true);
      expect(Array.isArray(r.en)).toBe(true);
    }
  });

  it("含當前版本的 note（發版一致性）", () => {
    expect(RELEASES.some((r) => r.version === APP_VERSION)).toBe(true);
    expect(releaseFor(APP_VERSION)?.version).toBe(APP_VERSION);
  });
});
