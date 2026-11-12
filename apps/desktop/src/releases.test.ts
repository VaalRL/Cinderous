import { describe, expect, it } from "vitest";
import { richSegments } from "@cinderous/i18n";
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

// releases.json 的條目用 **粗體** 與 `程式碼`（GitHub 發版說明也吃同一份）；關於頁用 RichText 渲染，標記必須成對
describe("發版條目的行內標記", () => {
  it("現有所有發版條目渲染後都不再露出 ** 標記", () => {
    for (const r of RELEASES)
      for (const line of [...r.zh, ...r.en])
        for (const s of richSegments(line)) if (s.kind !== "code") expect(s.text, line).not.toContain("**");
  });
});
