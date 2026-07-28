// 比較頁（ADR-0254）：與 Signal/LINE/WhatsApp 的誠實比較表。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Compare } from "./Compare.js";

describe("比較頁（ADR-0254）", () => {
  it("zh/en 都渲染完整比較表：四個產品欄＋十列＋Cinderous 欄突顯", () => {
    for (const locale of ["zh-Hant", "en"] as const) {
      const html = renderToStaticMarkup(<Compare c={useCopy(locale)} />);
      expect(html).toContain('data-testid="compare-table"');
      for (const name of ["Cinderous", "Signal", "LINE", "WhatsApp"]) expect(html).toContain(name);
      expect(html).toContain("cmp__us"); // 我方欄突顯樣式
      expect((html.match(/scope="row"/g) ?? []).length).toBe(10); // 十列
    }
  });

  it("🔴 FS 硬閘（ADR-0245）：前向保密列的 Cinderous 格不得為 ✓，且明示審計前不宣稱", () => {
    for (const locale of ["zh-Hant", "en"] as const) {
      const c = useCopy(locale);
      expect(c.cp_r9a).not.toContain("✓");
      expect(c.cp_r9b).toContain("✓"); // Signal 誠實給 ✓（承認別人有≠宣稱自己有）
    }
    expect(useCopy("zh-Hant").cp_r9a).toContain("審計");
    expect(useCopy("en").cp_r9a.toLowerCase()).toContain("audit");
  });

  it("誠實列存在：功能成熟度自承開發中（誠實表比全勝表可信）", () => {
    expect(useCopy("zh-Hant").cp_r10a).toContain("開發中");
    expect(useCopy("en").cp_r10a).toContain("In development");
  });

  it("商標聲明與資料時間（只用文字名稱、不用第三方 logo）", () => {
    const zh = renderToStaticMarkup(<Compare c={useCopy("zh-Hant")} />);
    expect(zh).toContain('data-testid="compare-note"');
    expect(zh).toContain("商標");
    expect(zh).toContain("2026");
    const en = renderToStaticMarkup(<Compare c={useCopy("en")} />);
    expect(en).toContain("trademarks");
  });
});
