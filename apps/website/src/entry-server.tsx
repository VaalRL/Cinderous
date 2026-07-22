// 預渲染進入點（ADR-0235 SEO-2）。建置時由 `scripts/prerender.mjs` 對每一條路由呼叫一次，
// 把 React 樹渲染成 HTML 字串寫進靜態檔——於是 GPTBot／ClaudeBot／PerplexityBot 這類
// **不執行 JS** 的爬蟲，第一個位元組就看得到完整內容。
//
// 刻意不 import `styles.css`：CSS 由客戶端 build 產出並注入 HTML 模板，SSR bundle 不需要它。
import { renderToString } from "react-dom/server";
import { App, GITHUB_URL } from "./App.js";
import { useCopy } from "./copy.js";
import { allRoutes, routeSlug, type Route } from "./routes.js";
import { headTags, robotsTxt, sitemapXml } from "./seo.js";

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

/** 附帶產出的靜態檔（robots／sitemap）。 */
export function extraFiles(): { file: string; content: string }[] {
  return [
    { file: "robots.txt", content: robotsTxt() },
    { file: "sitemap.xml", content: sitemapXml(allRoutes()) },
  ];
}
