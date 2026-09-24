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
import { DEV_DOC_SLUGS } from "./devdocs/structure.js";

describe("官網路由（ADR-0235 SEO-1／SEO-3）", () => {
  it("預設語言（en）走根路徑，不產生前綴（避免重複內容）", () => {
    expect(routeSlug({ view: "home", locale: "en" })).toBe("");
    expect(routeSlug({ view: "tech", locale: "en" })).toBe("tech");
    expect(routeHref({ view: "home", locale: "en" })).toBe("/Cinderous/");
    expect(routeHref({ view: "tech", locale: "en" })).toBe("/Cinderous/tech/");
  });

  it("繁中走 /zh-Hant/ 前綴——沒有這個，繁中內容永遠不會被索引（ADR-0246 翻轉預設語言）", () => {
    expect(routeSlug({ view: "home", locale: "zh-Hant" })).toBe("zh-Hant");
    expect(routeSlug({ view: "roadmap", locale: "zh-Hant" })).toBe("zh-Hant/roadmap");
    expect(routeHref({ view: "node", locale: "zh-Hant" })).toBe("/Cinderous/zh-Hant/node/");
  });

  it("絕對網址供 canonical／og:url／sitemap 使用", () => {
    expect(routeUrl({ view: "tech", locale: "zh-Hant" })).toBe("https://vaalrl.github.io/Cinderous/zh-Hant/tech/");
    expect(routeUrl({ view: "home", locale: "en" })).toBe("https://vaalrl.github.io/Cinderous/");
  });

  it("parseRoute 是 routeHref 的反函式（每一條路由都要 round-trip）", () => {
    for (const route of allRoutes()) {
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
  });

  it("parseRoute 容忍無尾斜線與 base 本身（無前綴＝預設 en）", () => {
    expect(parseRoute("/Cinderous/tech")).toEqual({ view: "tech", locale: "en" });
    expect(parseRoute("/Cinderous")).toEqual({ view: "home", locale: "en" });
    expect(parseRoute("/Cinderous/zh-Hant")).toEqual({ view: "home", locale: "zh-Hant" });
  });

  it("無法辨識的路徑退回首頁，不 crash", () => {
    expect(parseRoute("/Cinderous/nope/deeper")).toEqual({ view: "home", locale: "en" });
    expect(parseRoute("")).toEqual({ view: "home", locale: "en" });
    expect(parseRoute("/")).toEqual({ view: "home", locale: "en" });
  });

  it("base 為根站（綁自訂網域後）也正確", () => {
    expect(routeHref({ view: "tech", locale: "zh-Hant" }, "/")).toBe("/zh-Hant/tech/");
    expect(parseRoute("/zh-Hant/tech/", "/")).toEqual({ view: "tech", locale: "zh-Hant" });
    expect(parseRoute("/", "/")).toEqual({ view: "home", locale: "en" });
  });

  it("allRoutes 涵蓋語言 × 頁面全部組合，且無重複 URL", () => {
    const routes = allRoutes();
    // 開發者文件的每一個子頁也是一條獨立路由（ADR-0368）。
    expect(routes).toHaveLength(2 * (VIEWS.length + DEV_DOC_SLUGS.length));
    const urls = routes.map((r) => routeUrl(r));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("alternates 給出同頁的所有語言版本（hreflang）", () => {
    const alts = alternates({ view: "tech", locale: "en" });
    expect(alts.map((a) => a.locale).sort()).toEqual(["en", "zh-Hant"]);
    expect(alts.find((a) => a.locale === "en")?.url).toBe("https://vaalrl.github.io/Cinderous/tech/");
    expect(alts.find((a) => a.locale === "zh-Hant")?.url).toBe("https://vaalrl.github.io/Cinderous/zh-Hant/tech/");
  });

  it("BASE_PATH 前後都有斜線（拼接 URL 的前提）", () => {
    expect(BASE_PATH.startsWith("/")).toBe(true);
    expect(BASE_PATH.endsWith("/")).toBe(true);
  });

  it("開發者文件：總覽是 /developers/，子頁是 /developers/<slug>/（ADR-0368）", () => {
    expect(routeHref({ view: "developers", locale: "en" })).toBe("/Cinderous/developers/");
    expect(routeHref({ view: "developers", locale: "en", doc: "quick-start" })).toBe("/Cinderous/developers/quick-start/");
    expect(routeHref({ view: "developers", locale: "zh-Hant", doc: "errors" })).toBe("/Cinderous/zh-Hant/developers/errors/");
    expect(parseRoute("/Cinderous/zh-Hant/developers/errors/")).toEqual({ view: "developers", locale: "zh-Hant", doc: "errors" });
  });

  it("開發者文件：認不得的子頁退回總覽，不 crash", () => {
    expect(parseRoute("/Cinderous/developers/nope/")).toEqual({ view: "developers", locale: "en" });
  });

  it("子頁只屬於開發者文件——其他頁面帶了多餘的路徑段就忽略", () => {
    expect(parseRoute("/Cinderous/tech/quick-start/")).toEqual({ view: "tech", locale: "en" });
  });

  it("alternates 保留子頁：中英對照指向**同一頁**，不是各自的總覽", () => {
    const alts = alternates({ view: "developers", locale: "en", doc: "limits" });
    expect(alts.find((a) => a.locale === "zh-Hant")?.url).toBe(
      "https://vaalrl.github.io/Cinderous/zh-Hant/developers/limits/",
    );
  });
});
