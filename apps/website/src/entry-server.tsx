// 預渲染進入點（ADR-0235 SEO-2）。建置時由 `scripts/prerender.mjs` 對每一條路由呼叫一次，
// 把 React 樹渲染成 HTML 字串寫進靜態檔——於是 GPTBot／ClaudeBot／PerplexityBot 這類
// **不執行 JS** 的爬蟲，第一個位元組就看得到完整內容。
//
// 刻意不 import `styles.css`：CSS 由客戶端 build 產出並注入 HTML 模板，SSR bundle 不需要它。
import { renderToString } from "react-dom/server";
import { App, GITHUB_URL } from "./App.js";
import { useCopy } from "./copy.js";
import { NotFound } from "./pages/NotFound.js";
import { allRoutes, DEFAULT_LOCALE, routeSlug, type Route } from "./routes.js";
import { BRAND, escapeAttr, headTags, robotsTxt, sitemapXml } from "./seo.js";

export interface RenderedPage {
  /** 相對於 dist 根的輸出路徑，如 `index.html`、`tech/index.html`、`en/tech/index.html`。 */
  file: string;
  /** `<html lang>` 的值。 */
  lang: string;
  /** 注入 `<head>` 的標籤字串。 */
  head: string;
  /** 注入 `<div id="root">` 的 HTML。 */
  body: string;
}

/** 渲染單一路由。 */
export function renderRoute(route: Route): RenderedPage {
  const c = useCopy(route.locale);
  const slug = routeSlug(route);
  return {
    file: slug === "" ? "index.html" : `${slug}/index.html`,
    lang: route.locale,
    head: headTags(route, c, GITHUB_URL),
    body: renderToString(<App route={route} />),
  };
}

/** 渲染全部路由（語言 × 頁面）。 */
export function renderAll(): RenderedPage[] {
  return allRoutes().map(renderRoute);
}

/**
 * 404 頁（ADR-0247）：GitHub Pages 對 `/Cinderous/` 下未匹配路徑服務 `dist/404.html`。
 * 不列入 `allRoutes`／sitemap；`robots: noindex`。預設語言（en）單頁，預渲染時由 prerender 剝掉 app JS
 * → 純靜態、不 hydrate（否則 SPA 的 unknown→home 會把 404 內容覆蓋掉）。
 */
export function renderNotFound(): RenderedPage {
  const c = useCopy(DEFAULT_LOCALE);
  const head = [
    `<title>${escapeAttr(c.nf_title)}｜${BRAND}</title>`,
    `<meta name="description" content="${escapeAttr(c.nf_lead)}" />`,
    `<meta name="robots" content="noindex, follow" />`,
    `<meta name="theme-color" content="#f7f2ea" />`,
  ].join("\n    ");
  return { file: "404.html", lang: DEFAULT_LOCALE, head, body: renderToString(<NotFound c={c} />) };
}

/**
 * 把單一預渲染頁套進 HTML 模板：換 `<html lang>`、移除模板自帶的預設 `<title>`、注入 head 與 body。
 *
 * ⚠️ 順序關鍵（ADR-0246 修正）：**先移除模板的預設 title、再注入 head**。
 * 模板在注入前只有一個 `<title>`（那個要丟掉的預設值）；若先注入 head，注入內容的
 * 「每頁正確 title」會排在模板 title **之前**，非全域 `replace` 只會刪到第一個——結果誤刪正確 title、
 * 留下模板預設值（先前所有預渲染頁的 `<title>` 都變成同一個模板預設，SEO 最重要的標籤全毀而測試沒攔到）。
 */
export function applyTemplate(template: string, page: RenderedPage): string {
  return template
    .replace('<html lang="zh-Hant">', `<html lang="${page.lang}">`)
    .replace(/\n\s*<title>[^<]*<\/title>/, "")
    .replace("<!--app-head-->", page.head)
    .replace("<!--app-html-->", page.body);
}

/** 附帶產出的靜態檔（robots／sitemap）。 */
export function extraFiles(): { file: string; content: string }[] {
  return [
    { file: "robots.txt", content: robotsTxt() },
    { file: "sitemap.xml", content: sitemapXml(allRoutes()) },
  ];
}
