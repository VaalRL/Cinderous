import { describe, expect, it } from "vitest";
import { noteSegments, RELEASES, releaseFor } from "./releases.js";
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

// releases.json 的條目用 **粗體** 與 `程式碼`（GitHub 發版說明也吃同一份）；App 內要渲染、不能原樣露出星號
describe("noteSegments：發版條目的行內標記", () => {
  it("**粗體** 與 `程式碼` 拆成段落", () => {
    expect(noteSegments("**新功能：** 設 `ROSTER_ADMIN_PUBKEY` 就好")).toEqual([
      { kind: "bold", text: "新功能：" },
      { kind: "text", text: " 設 " },
      { kind: "code", text: "ROSTER_ADMIN_PUBKEY" },
      { kind: "text", text: " 就好" },
    ]);
  });

  it("沒有標記 → 一段純文字；沒配對的星號或反引號原樣保留", () => {
    expect(noteSegments("一般文字")).toEqual([{ kind: "text", text: "一般文字" }]);
    expect(noteSegments("a ** b ` c")).toEqual([{ kind: "text", text: "a ** b ` c" }]);
  });

  it("現有所有發版條目渲染後都不再露出 ** 標記", () => {
    for (const r of RELEASES)
      for (const line of [...r.zh, ...r.en])
        for (const s of noteSegments(line)) if (s.kind !== "code") expect(s.text, line).not.toContain("**");
  });
});
