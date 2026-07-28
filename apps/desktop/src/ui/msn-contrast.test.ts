// 高對比 CSS ↔ @cinderous/theme 對齊（ADR-0253）：msn.css 的 [data-contrast="high"] 區塊
// 值必須與 HIGH_CONTRAST（SSOT）一致——改一邊沒改另一邊＝這裡紅（比照 tokens.test 的對齊模式）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, HIGH_CONTRAST } from "@cinderous/theme";

const css = readFileSync(new URL("./msn.css", import.meta.url), "utf8");

/** 取出 CSS 中某選擇器區塊的內文（找不到＝空字串，讓斷言明確失敗）。 */
function block(selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) return "";
  return css.slice(at, css.indexOf("}", at));
}

describe("高對比 CSS 對齊 SSOT（ADR-0253）", () => {
  it("亮色高對比區塊存在且值與 HIGH_CONTRAST.light 一致", () => {
    const b = block(':root[data-contrast="high"]');
    const hc = HIGH_CONTRAST.light;
    expect(b).toContain(`--ink: ${hc.ink}`);
    expect(b).toContain(`--muted: ${hc.muted}`);
    expect(b).toContain(`--border: ${hc.border}`);
    expect(b).toContain(`--in-name: ${hc.inName}`);
  });

  it("暗色高對比區塊存在且值與 HIGH_CONTRAST.dark 一致", () => {
    const b = block(':root[data-theme="dark"][data-contrast="high"]');
    const hc = HIGH_CONTRAST.dark;
    expect(b).toContain(`--ink: ${hc.ink}`);
    expect(b).toContain(`--muted: ${hc.muted}`);
    expect(b).toContain(`--border: ${hc.border}`);
    expect(b).toContain(`--in-name: ${hc.inName}`);
    expect(b).toContain(`--panel: ${hc.panel}`);
    expect(b).toContain(`--field: ${hc.field}`);
  });

  it("高對比下焦點環加粗與連結底線的規則存在", () => {
    expect(css).toContain(':root[data-contrast="high"] button:focus-visible');
    expect(css).toContain(':root[data-contrast="high"] a { text-decoration: underline; }');
  });

  it("色覺友善色票（ADR-0253）：白字對比全數 ≥4.5（主色當按鈕底色配白字）", async () => {
    const { ACCENT_PRESETS_CB } = await import("../accent.js");
    for (const p of ACCENT_PRESETS_CB) {
      expect(contrastRatio(p.hex, "#ffffff"), p.key).toBeGreaterThanOrEqual(4.5);
    }
  });
});
