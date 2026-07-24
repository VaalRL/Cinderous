import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CinderMascot } from "./index.js";

describe("CinderMascot（品牌 SSOT，ADR-0247）", () => {
  it("待機：無紅點徽章、aria-label 為 Cinderous", () => {
    const html = renderToStaticMarkup(<CinderMascot />);
    expect(html).toContain('aria-label="Cinderous"');
    expect(html).not.toContain(">1<");
  });

  it("有新訊息：紅點徽章「1」＋提示文字", () => {
    const html = renderToStaticMarkup(<CinderMascot alert />);
    expect(html).toContain("有新訊息");
    expect(html).toContain(">1<");
  });

  it("身體色跟隨 var(--accent)——桌面吃主題色、官網吃站台 accent", () => {
    const html = renderToStaticMarkup(<CinderMascot />);
    expect(html).toContain("var(--accent");
  });

  it("高度＝寬度 × 1.25（viewBox 120:150）", () => {
    const html = renderToStaticMarkup(<CinderMascot size={48} />);
    expect(html).toContain('width="48"');
    expect(html).toContain('height="60"');
  });
});
