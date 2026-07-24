// 預渲染產出驗收（ADR-0235 SEO-1／SEO-2）。
//
// 這份測試存在的理由：CSR 退化是**靜默**的。把 `hydrateRoot` 改回 `createRoot`、
// 或把某個 `<a href>` 改回 `<button onClick>`，畫面看起來一模一樣，網站也照常運作
// ——只有爬蟲與答案引擎看到的東西默默變回一個空 `<div id="root">`。
// 直接對「渲染後的 HTML 字串」下斷言，退化就會在 CI 被擋下。

import { describe, expect, it } from "vitest";
import { applyTemplate, renderAll, renderNotFound, renderRoute } from "./entry-server.js";
import { allRoutes, BASE_PATH, routeHref, VIEWS } from "./routes.js";

const pages = renderAll();

describe("預渲染輸出", () => {
  it("每一條路由都產出一份 HTML，路徑為目錄式 index.html", () => {
    expect(pages).toHaveLength(allRoutes().length);
    const files = pages.map((p) => p.file);
    // ADR-0246：預設語言 en 走根路徑；繁中改走 /zh-Hant/ 前綴。
    expect(files).toContain("index.html"); // en 首頁
    expect(files).toContain("tech/index.html"); // en 技術頁
    expect(files).toContain("enterprise/index.html"); // en 企業版頁（新頁）
    expect(files).toContain("zh-Hant/index.html"); // 繁中首頁
    expect(files).toContain("zh-Hant/roadmap/index.html"); // 繁中藍圖
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

  // ADR-0246 迴歸：修正前模板套用會誤刪注入的正確 title、留下模板預設值，導致每頁 <title> 全毀。
  it("applyTemplate 留下每頁正確 title、丟掉模板預設，且換對 lang", () => {
    const template = [
      "<!doctype html>",
      '<html lang="zh-Hant">',
      "  <head>",
      '    <meta charset="utf-8" />',
      "    <!--app-head-->",
      "    <title>Cinderous — 開源・永久免費・隱私優先</title>",
      "  </head>",
      '  <body><div id="root"><!--app-html--></div></body>',
      "</html>",
    ].join("\n");
    const html = applyTemplate(template, renderRoute({ view: "home", locale: "en" }));
    expect(html).not.toContain("開源・永久免費・隱私優先"); // 模板預設值必須被丟棄
    expect(html).toContain('<html lang="en">');
    // head 區（body 前）只剩一個 title，且是英文首頁的 SEO title
    const headTitles = html.slice(0, html.indexOf('<div id="root"')).match(/<title>[^<]*<\/title>/g) ?? [];
    expect(headTitles).toHaveLength(1);
    expect(headTitles[0]).toContain("Open-source");
  });

  // ADR-0247：頁尾吉祥物——每頁 footer 都帶 CinderMascot（aria-label Cinderous）。
  it("每頁頁尾都有吉祥物", () => {
    for (const page of pages) {
      expect(page.body).toContain("footer__inner");
      expect(page.body).toContain('aria-label="Cinderous"');
    }
  });

  // ADR-0247：404 頁——輸出 404.html、noindex、含吉祥物與回首頁連結。
  it("renderNotFound 產出 noindex 的 404.html，含吉祥物與回首頁", () => {
    const nf = renderNotFound();
    expect(nf.file).toBe("404.html");
    expect(nf.head).toContain('name="robots" content="noindex');
    expect(nf.body).toContain('data-testid="notfound"');
    expect(nf.body).toContain('aria-label="Cinderous"');
    expect(nf.body).toContain(`href="${BASE_PATH}"`);
  });
});
