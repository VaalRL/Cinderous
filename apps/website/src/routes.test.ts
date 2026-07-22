import { describe, expect, it } from "vitest";
import {
  allRoutes,
  alternates,
  BASE_PATH,
  parseRoute,
  routeHref,
  routeSlug,
  routeUrl,
  VIEWS,
} from "./routes.js";

describe("官網路由（ADR-0235 SEO-1／SEO-3）", () => {
  it("預設語言走根路徑，不產生 /zh-Hant/（避免重複內容）", () => {
    expect(routeSlug({ view: "home", locale: "zh-Hant" })).toBe("");
    expect(routeSlug({ view: "tech", locale: "zh-Hant" })).toBe("tech");
    expect(routeHref({ view: "home", locale: "zh-Hant" })).toBe("/Cinderous/");
    expect(routeHref({ view: "tech", locale: "zh-Hant" })).toBe("/Cinderous/tech/");
  });

  it("英文走 /en/ 前綴——沒有這個，英文內容永遠不會被索引", () => {
    expect(routeSlug({ view: "home", locale: "en" })).toBe("en");
    expect(routeSlug({ view: "roadmap", locale: "en" })).toBe("en/roadmap");
    expect(routeHref({ view: "node", locale: "en" })).toBe("/Cinderous/en/node/");
  });

  it("絕對網址供 canonical／og:url／sitemap 使用", () => {
    expect(routeUrl({ view: "tech", locale: "en" })).toBe("https://vaalrl.github.io/Cinderous/en/tech/");
    expect(routeUrl({ view: "home", locale: "zh-Hant" })).toBe("https://vaalrl.github.io/Cinderous/");
  });

  it("parseRoute 是 routeHref 的反函式（每一條路由都要 round-trip）", () => {
    for (const route of allRoutes()) {
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
  });

  it("parseRoute 容忍無尾斜線與 base 本身", () => {
    expect(parseRoute("/Cinderous/tech")).toEqual({ view: "tech", locale: "zh-Hant" });
    expect(parseRoute("/Cinderous")).toEqual({ view: "home", locale: "zh-Hant" });
    expect(parseRoute("/Cinderous/en")).toEqual({ view: "home", locale: "en" });
  });

  it("無法辨識的路徑退回首頁，不 crash", () => {
    expect(parseRoute("/Cinderous/nope/deeper")).toEqual({ view: "home", locale: "zh-Hant" });
    expect(parseRoute("")).toEqual({ view: "home", locale: "zh-Hant" });
    expect(parseRoute("/")).toEqual({ view: "home", locale: "zh-Hant" });
  });

  it("base 為根站（綁自訂網域後）也正確", () => {
    expect(routeHref({ view: "tech", locale: "en" }, "/")).toBe("/en/tech/");
    expect(parseRoute("/en/tech/", "/")).toEqual({ view: "tech", locale: "en" });
    expect(parseRoute("/", "/")).toEqual({ view: "home", locale: "zh-Hant" });
  });

  it("allRoutes 涵蓋語言 × 頁面全部組合，且無重複 URL", () => {
    const routes = allRoutes();
    expect(routes).toHaveLength(2 * VIEWS.length);
    const urls = routes.map((r) => routeUrl(r));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("alternates 給出同頁的所有語言版本（hreflang）", () => {
    const alts = alternates({ view: "tech", locale: "en" });
    expect(alts.map((a) => a.locale).sort()).toEqual(["en", "zh-Hant"]);
    expect(alts.find((a) => a.locale === "zh-Hant")?.url).toBe("https://vaalrl.github.io/Cinderous/tech/");
  });

  it("BASE_PATH 前後都有斜線（拼接 URL 的前提）", () => {
    expect(BASE_PATH.startsWith("/")).toBe(true);
    expect(BASE_PATH.endsWith("/")).toBe(true);
  });
});
