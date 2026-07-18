import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CinderMark, CinderMascot } from "./Brand.js";

describe("Cinderous 品牌元件", () => {
  it("CinderMark：渲染餘燼光球 SVG", () => {
    const html = renderToStaticMarkup(<CinderMark size={64} />);
    expect(html).toContain("<svg");
    expect(html).toContain('aria-label="Cinderous"');
  });

  it("CinderMascot 待機：無紅點徽章", () => {
    const html = renderToStaticMarkup(<CinderMascot />);
    expect(html).toContain('aria-label="Cinderous"');
    expect(html).not.toContain(">1<");
  });

  it("CinderMascot 有訊息：紅點徽章「1」", () => {
    const html = renderToStaticMarkup(<CinderMascot alert />);
    expect(html).toContain("有新訊息");
    expect(html).toContain(">1<");
  });
});
