// 404 頁（ADR-0247）：SSR 斷言吉祥物、404、標題與回首頁連結皆有渲染。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { BASE_PATH } from "../routes.js";
import { NotFound } from "./NotFound.js";

describe("NotFound 404 頁（ADR-0247）", () => {
  it("含吉祥物、404、標題與回首頁連結", () => {
    const html = renderToStaticMarkup(<NotFound c={useCopy("en")} />);
    expect(html).toContain('data-testid="notfound"');
    expect(html).toContain('aria-label="Cinderous"'); // 吉祥物
    expect(html).toContain(">404<");
    expect(html).toContain("This campfire has gone out");
    expect(html).toContain(`href="${BASE_PATH}"`); // 回首頁
  });
});
