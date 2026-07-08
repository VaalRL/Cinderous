import { describe, expect, it } from "vitest";
import { accentForTheme, ACCENT_PRESETS, lightenHex } from "./accent.js";

describe("自訂主題色（ADR-0064）", () => {
  it("lightenHex：往白色混、比例正確、白不變、非法原樣", () => {
    expect(lightenHex("#000000", 0.5)).toBe("#808080");
    expect(lightenHex("#2f6cd6", 0)).toBe("#2f6cd6");
    expect(lightenHex("#ffffff", 0.5)).toBe("#ffffff");
    expect(lightenHex("nope", 0.3)).toBe("nope");
  });

  it("accentForTheme：深色提亮、淺色原樣、輸出合法 hex", () => {
    expect(accentForTheme("#2f6cd6", "light")).toBe("#2f6cd6");
    const dark = accentForTheme("#2f6cd6", "dark");
    expect(dark).not.toBe("#2f6cd6");
    expect(dark).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("預設色票：皆為合法 hex 且鍵不重複", () => {
    for (const p of ACCENT_PRESETS) expect(p.hex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(ACCENT_PRESETS.map((p) => p.key)).size).toBe(ACCENT_PRESETS.length);
  });
});
