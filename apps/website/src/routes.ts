// 官網路由（ADR-0235 SEO-1／SEO-3）。純函式，可完整於 node 測試。
//
// ## 修正前的問題
//
// 四個「頁面」（home/tech/node/roadmap）全靠 `useState` 切換，導覽是 `<button onClick>`。
// 語言切換同理。結果是**整站只有一個 URL**：
//
//   - Google 只索引得到一個頁面，`tech`／`node`／`roadmap` 的內容永遠不會出現在搜尋結果
//   - 沒有 `<a href>` ＝ 爬蟲**沒有任何可跟隨的內部連結**（`<button>` 是死路）
//   - 無法深連結、無法分享特定頁、無法累積該頁的外連權重
//   - 中英文共用 `/`，沒有 hreflang → **英文內容完全無法被索引**
//
// 現在每個 (view, locale) 組合都有真實 URL，建置時各自產出一份靜態 HTML。

import type { Locale } from "@cinderous/i18n";

/** 官網的頁面。 */
export type View = "home" | "tech" | "node" | "roadmap";

export const VIEWS: readonly View[] = ["home", "tech", "node", "roadmap"] as const;

/** 官網支援的語言；`zh-Hant` 為預設（根路徑），其餘走 `/<locale>/` 前綴。 */
export const LOCALES: readonly Locale[] = ["zh-Hant", "en"] as const;

/** 預設語言＝根路徑，不加前綴（避免 `/zh-Hant/` 與 `/` 重複內容）。 */
export const DEFAULT_LOCALE: Locale = "zh-Hant";

export interface Route {
  view: View;
  locale: Locale;
}

/**
 * 站台來源（含協定，無尾斜線）與部署基底路徑（前後皆有斜線）。
 *
 * ⚠️ 綁自訂網域時要一起改的地方：本檔的 `SITE_ORIGIN`／`BASE_PATH`、`vite.config.ts` 的
 * `base`、以及 **`apps/desktop/src/update-check.ts` 與 `threat-db.ts` 的 endpoint**
 * ——後兩者是硬編碼的，漏改會讓新版 app 指向舊網址（ADR-0235 SEO-6）。
 */
export const SITE_ORIGIN = "https://vaalrl.github.io";
export const BASE_PATH = "/Cinderous/";

/** 頁面在該語言下的路徑片段（相對於 base，無前後斜線）；首頁為空字串。 */
function viewSegment(view: View): string {
  return view === "home" ? "" : view;
}

/** 路由 → 相對於 base 的路徑（無前導斜線）。首頁為 `""`、英文首頁為 `"en"`。 */
export function routeSlug(route: Route): string {
  const localePart = route.locale === DEFAULT_LOCALE ? "" : route.locale;
  const viewPart = viewSegment(route.view);
  return [localePart, viewPart].filter(Boolean).join("/");
}

/** 路由 → 站內絕對路徑（含 base，目錄式尾斜線，供 `<a href>` 與 canonical 使用）。 */
export function routeHref(route: Route, base: string = BASE_PATH): string {
  const slug = routeSlug(route);
  return slug === "" ? base : `${base}${slug}/`;
}

/** 路由 → 完整絕對網址（canonical／og:url／sitemap 用）。 */
export function routeUrl(route: Route, origin: string = SITE_ORIGIN, base: string = BASE_PATH): string {
  return `${origin}${routeHref(route, base)}`;
}

/**
 * 由瀏覽器 pathname 解析路由。無法辨識的路徑退回預設首頁
 * （靜態站的 404 會由 host 處理，這裡只保證不會 crash）。
 */
export function parseRoute(pathname: string, base: string = BASE_PATH): Route {
  let rest = pathname;
  if (base !== "/" && rest.startsWith(base)) rest = rest.slice(base.length);
  else if (base !== "/" && rest === base.replace(/\/$/, "")) rest = "";
  else if (base === "/") rest = rest.replace(/^\//, "");
  const parts = rest.split("/").filter(Boolean);

  let locale: Locale = DEFAULT_LOCALE;
  if (parts[0] && (LOCALES as readonly string[]).includes(parts[0])) {
    locale = parts.shift() as Locale;
  }
  const seg = parts[0] ?? "";
  const view = (VIEWS as readonly string[]).includes(seg) ? (seg as View) : "home";
  return { view, locale };
}

/** 所有需要預渲染／列入 sitemap 的路由（語言 × 頁面）。 */
export function allRoutes(): Route[] {
  return LOCALES.flatMap((locale) => VIEWS.map((view) => ({ view, locale })));
}

/** 同一頁面的其他語言版本（hreflang alternate 用）。 */
export function alternates(route: Route): { locale: Locale; url: string }[] {
  return LOCALES.map((locale) => ({ locale, url: routeUrl({ view: route.view, locale }) }));
}
