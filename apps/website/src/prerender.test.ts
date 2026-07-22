// 預渲染產出驗收（ADR-0235 SEO-1／SEO-2）。
//
// 這份測試存在的理由：CSR 退化是**靜默**的。把 `hydrateRoot` 改回 `createRoot`、
// 或把某個 `<a href>` 改回 `<button onClick>`，畫面看起來一模一樣，網站也照常運作
// ——只有爬蟲與答案引擎看到的東西默默變回一個空 `<div id="root">`。
// 直接對「渲染後的 HTML 字串」下斷言，退化就會在 CI 被擋下。

import { describe, expect, it } from "vitest";
import { renderAll, renderRoute } from "./entry-server.js";
import { allRoutes, routeHref, VIEWS } from "./routes.js";

const pages = renderAll();

describe("預渲染輸出", () => {
  it("每一條路由都產出一份 HTML，路徑為目錄式 index.html", () => {
    expect(pages).toHaveLength(allRoutes().length);
    const files = pages.map((p) => p.file);
    expect(files).toContain("index.html");
    expect(files).toContain("tech/index.html");
    expect(files).toContain("en/index.html");
    expect(files).toContain("en/roadmap/index.html");
    // GitHub Pages 直接服務目錄下的 index.html——爬蟲拿到 200 而非 404 轉址。
    for (const f of files) expect(f.endsWith("index.html")).toBe(true);
  });

  it("body 有實質內容——不是空的 <div id=\"root\">", () => {
    for (const page of pages) {
      // 一個空殼大約是 0；有內容的頁面都在數千字元以上。
      expect(page.body.length).toBeGreaterThan(2000);
    }
  });

  it("首頁的 H1 含品牌名**與**說明句（修正前只有品牌名）", () => {
    const zh = renderRoute({ view: "home", locale: "zh-Hant" });
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(zh.body)?.[1] ?? "";
    expect(h1).toContain("Cinderous");
    expect(h1).toContain("加密");
    const en = renderRoute({ view: "home", locale: "en" });
    const h1en = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(en.body)?.[1] ?? "";
    expect(h1en.toLowerCase()).toContain("encrypted");
  });

  it("導覽是可跟隨的 <a href>，不是 <button>——爬蟲只走 href", () => {
    const home = renderRoute({ view: "home", locale: "zh-Hant" });
    for (const view of VIEWS) {
      const href = routeHref({ view, locale: "zh-Hant" });
      expect(home.body).toContain(`href="${href}"`);
    }
  });

  it("每頁都連得到另一個語言版本（hreflang 指向的頁面必須真的可達）", () => {
    const zh = renderRoute({ view: "tech", locale: "zh-Hant" });
    expect(zh.body).toContain(`href="${routeHref({ view: "tech", locale: "en" })}"`);
    const en = renderRoute({ view: "tech", locale: "en" });
    expect(en.body).toContain(`href="${routeHref({ view: "tech", locale: "zh-Hant" })}"`);
  });

  it("lang 屬性隨語言而變", () => {
    expect(renderRoute({ view: "home", locale: "en" }).lang).toBe("en");
    expect(renderRoute({ view: "home", locale: "zh-Hant" }).lang).toBe("zh-Hant");
  });

  it("head 帶 canonical 與該頁專屬 title", () => {
    const titles = pages.map((p) => /<title>([^<]*)<\/title>/.exec(p.head)?.[1] ?? "");
    expect(new Set(titles).size).toBe(pages.length);
    for (const page of pages) expect(page.head).toContain('<link rel="canonical"');
  });
});
