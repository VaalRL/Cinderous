import { describe, expect, it } from "vitest";
import { useCopy } from "./copy.js";
import { allRoutes, routeUrl, type Route } from "./routes.js";
import { BRAND, escapeAttr, headTags, jsonLd, pageMeta, robotsTxt, sitemapXml } from "./seo.js";

const REPO = "https://github.com/VaalRL/Cinderous";
const copyFor = (route: Route) => useCopy(route.locale);

describe("每頁 SEO metadata（ADR-0235 SEO-4）", () => {
  it("每一條路由都有非空、且彼此相異的 title 與 description", () => {
    const metas = allRoutes().map((r) => pageMeta(r, copyFor(r)));
    for (const m of metas) {
      expect(m.title.length).toBeGreaterThan(10);
      expect(m.description.length).toBeGreaterThan(50);
    }
    // 重複的 title/description 會讓搜尋引擎把頁面判為同質內容。
    expect(new Set(metas.map((m) => m.title)).size).toBe(metas.length);
    expect(new Set(metas.map((m) => m.description)).size).toBe(metas.length);
  });

  it("首頁 title 帶關鍵字而非只有品牌名（修正前 H1 就只有 'Cinderous'）", () => {
    const zh = pageMeta({ view: "home", locale: "zh-Hant" }, useCopy("zh-Hant"));
    expect(zh.title).not.toBe(BRAND);
    expect(zh.title).toContain("加密");
    const en = pageMeta({ view: "home", locale: "en" }, useCopy("en"));
    expect(en.title.toLowerCase()).toContain("encrypted");
  });

  it("description 長度落在搜尋結果不會被截斷的範圍內", () => {
    for (const r of allRoutes()) {
      const { description } = pageMeta(r, copyFor(r));
      expect(description.length).toBeLessThanOrEqual(320);
    }
  });

  it("canonical 等於該路由的絕對網址", () => {
    for (const r of allRoutes()) {
      expect(pageMeta(r, copyFor(r)).canonical).toBe(routeUrl(r));
    }
  });
});

describe("head 標籤產出", () => {
  const tags = (r: Route) => headTags(r, copyFor(r), REPO);

  it("含 canonical、雙語 hreflang 與 x-default", () => {
    const html = tags({ view: "tech", locale: "en" });
    expect(html).toContain('<link rel="canonical" href="https://vaalrl.github.io/Cinderous/tech/" />');
    expect(html).toContain('hreflang="zh-Hant" href="https://vaalrl.github.io/Cinderous/zh-Hant/tech/"');
    expect(html).toContain('hreflang="en" href="https://vaalrl.github.io/Cinderous/tech/"');
    // x-default 指向預設語言版本（ADR-0246：改為 en）
    expect(html).toContain('hreflang="x-default" href="https://vaalrl.github.io/Cinderous/tech/"');
  });

  it("含 Open Graph 與 Twitter Card（修正前分享出去沒有預覽卡）", () => {
    const html = tags({ view: "home", locale: "zh-Hant" });
    for (const key of ["og:title", "og:description", "og:url", "og:image", "twitter:card", "twitter:image"]) {
      expect(html).toContain(key);
    }
    expect(html).toContain('content="summary_large_image"');
  });

  it("每頁都有 JSON-LD，首頁額外宣告 SoftwareApplication", () => {
    for (const r of allRoutes()) {
      expect(tags(r)).toContain('type="application/ld+json"');
    }
    const home = jsonLd({ view: "home", locale: "zh-Hant" }, pageMeta({ view: "home", locale: "zh-Hant" }, useCopy("zh-Hant")), REPO);
    const parsed = JSON.parse(home) as { "@graph": { "@type": string }[] };
    expect(parsed["@graph"].map((n) => n["@type"])).toContain("SoftwareApplication");
    const tech = jsonLd({ view: "tech", locale: "en" }, pageMeta({ view: "tech", locale: "en" }, useCopy("en")), REPO);
    expect(JSON.parse(tech)).toBeTruthy();
  });

  it("FAQ 頁輸出 FAQPage，問答對與可見文案同源（ADR-0235 SEO-4）", () => {
    const route = { view: "faq", locale: "zh-Hant" } as const;
    const c = useCopy("zh-Hant");
    const ld = JSON.parse(jsonLd(route, pageMeta(route, c), REPO, c)) as {
      "@graph": { "@type": string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }[];
    };
    const faq = ld["@graph"].find((n) => n["@type"] === "FAQPage");
    expect(faq).toBeTruthy();
    expect(faq?.mainEntity).toHaveLength(c.faqItems.length);
    // 結構化資料的問答必須與頁面可見內容一字不差（Google 政策）。
    expect(faq?.mainEntity?.[0]?.name).toBe(c.faqItems[0]!.q);
    expect(faq?.mainEntity?.[0]?.acceptedAnswer.text).toBe(c.faqItems[0]!.a);
  });

  it("非 FAQ 頁不含 FAQPage", () => {
    const route = { view: "home", locale: "zh-Hant" } as const;
    const c = useCopy("zh-Hant");
    expect(jsonLd(route, pageMeta(route, c), REPO, c)).not.toContain("FAQPage");
  });

  it("JSON-LD 內的 < 一律跳脫——否則內容裡的 </script> 會提早關閉標籤", () => {
    const html = tags({ view: "home", locale: "zh-Hant" });
    const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).not.toContain("<");
  });

  it("屬性值有跳脫（引號不會逃出屬性）", () => {
    expect(escapeAttr('a"b<c>d&e')).toBe("a&quot;b&lt;c&gt;d&amp;e");
  });
});

describe("robots.txt 與 sitemap.xml", () => {
  it("robots 指向 sitemap 並明確允許生成式引擎爬蟲", () => {
    const txt = robotsTxt();
    expect(txt).toContain("Sitemap: https://vaalrl.github.io/Cinderous/sitemap.xml");
    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot"]) expect(txt).toContain(bot);
  });

  it("sitemap 列出每一條路由，且帶 hreflang alternate", () => {
    const xml = sitemapXml(allRoutes());
    for (const r of allRoutes()) expect(xml).toContain(`<loc>${routeUrl(r)}</loc>`);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain('hreflang="x-default"');
    // 合法 XML 的最起碼要求：宣告與根元素閉合
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});
