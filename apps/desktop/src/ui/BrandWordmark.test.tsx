import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { SITE_BASE } from "../site.js";
import { BrandWordmark } from "./BrandWordmark.js";

function html(node: JSX.Element): string {
  return renderToStaticMarkup(<I18nProvider locale="zh-Hant">{node}</I18nProvider>);
}

describe("BrandWordmark（ADR-0250）", () => {
  it("是外連官網的連結：href=SITE_BASE、target=_blank、rel 帶 noopener、文字＝Cinderous", () => {
    const out = html(<BrandWordmark />);
    expect(out).toContain(`href="${SITE_BASE}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
    expect(out).toContain(">Cinderous</a>");
  });

  it("className 可覆寫（供標題列/視窗標題各自貼合樣式）", () => {
    const out = html(<BrandWordmark className="titlebar__title" />);
    expect(out).toContain('class="titlebar__title"');
  });
});
