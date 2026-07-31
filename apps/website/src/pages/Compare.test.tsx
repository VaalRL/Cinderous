// 比較頁（ADR-0254）：與 Signal/LINE/WhatsApp 的誠實比較表。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Compare } from "./Compare.js";

describe("比較頁（ADR-0254）", () => {
  it("zh/en 都渲染完整比較表：四個產品欄＋十列＋Cinderous 欄突顯", () => {
    for (const locale of ["zh-Hant", "en"] as const) {
      const html = renderToStaticMarkup(<Compare c={useCopy(locale)} locale={locale} />);
      expect(html).toContain('data-testid="compare-table"');
      for (const name of ["Cinderous", "Signal", "LINE", "WhatsApp"]) expect(html).toContain(name);
      expect(html).toContain("cmp__us"); // 我方欄突顯樣式
      expect((html.match(/scope="row"/g) ?? []).length).toBe(10); // 十列
    }
  });

  // ADR-0306 D2.2：規則由「不得宣稱」改為「**不得以對等形式宣稱**」。
  // 這張表的語意**就是**對等比較，故 ✓ 仍然禁止；但可以誠實說「已實作」——
  // ~~原為「開發中」~~，那在功能實際出貨（實驗性）之後已是**低估**。
  it("🔴 FS 對等式硬閘：前向保密列的 Cinderous 格**永遠不得**為 ✓", () => {
    for (const locale of ["zh-Hant", "en"] as const) {
      const c = useCopy(locale);
      expect(c.cp_r9a).not.toContain("✓");
      expect(c.cp_r9b).toContain("✓"); // Signal 誠實給 ✓（承認別人有≠宣稱自己有）
    }
  });

  it("🔴 該格得寫「已實作」，但必須同時帶限定——不得只有「已實作」三個字", () => {
    // 只寫「已實作」而不限定，在這張與 Signal 並列的表裡讀起來就是對等宣稱。
    expect(useCopy("zh-Hant").cp_r9a).toContain("已實作");
    expect(useCopy("zh-Hant").cp_r9a).toContain("實驗性");
    const en = useCopy("en").cp_r9a.toLowerCase();
    expect(en).toContain("implemented");
    expect(en).toContain("experimental");
  });

  it("🔴 表下註腳必須寫明「未經外部審計」——格子塞不下的那半要有地方講", () => {
    for (const locale of ["zh-Hant", "en"] as const) {
      const html = renderToStaticMarkup(<Compare c={useCopy(locale)} locale={locale} />);
      expect(locale === "zh-Hant" ? html.includes("審計") : html.toLowerCase().includes("audit")).toBe(true);
    }
  });

  it("誠實列存在：功能成熟度自承開發中（誠實表比全勝表可信）", () => {
    expect(useCopy("zh-Hant").cp_r10a).toContain("開發中");
    expect(useCopy("en").cp_r10a).toContain("In development");
  });

  it("互連（ADR-0255）：比較頁有連往企業版的 locale-aware 連結", () => {
    const zh = renderToStaticMarkup(<Compare c={useCopy("zh-Hant")} locale="zh-Hant" />);
    expect(zh).toContain('data-testid="compare-ent-link"');
    expect(zh).toContain('href="/Cinderous/zh-Hant/enterprise/"');
    const en = renderToStaticMarkup(<Compare c={useCopy("en")} locale="en" />);
    expect(en).toContain('href="/Cinderous/enterprise/"');
  });

  it("商標聲明與資料時間（只用文字名稱、不用第三方 logo）", () => {
    const zh = renderToStaticMarkup(<Compare c={useCopy("zh-Hant")} locale="zh-Hant" />);
    expect(zh).toContain('data-testid="compare-note"');
    expect(zh).toContain("商標");
    expect(zh).toContain("2026");
    const en = renderToStaticMarkup(<Compare c={useCopy("en")} locale="en" />);
    expect(en).toContain("trademarks");
  });
});
