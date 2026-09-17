// 自架教學頁（ADR-0357）。
//
// 最重要的是第二個 describe：ADR-0090 的硬隔離鐵則說官網永不接觸通訊平面。這裡把那條規則
// 變成**測試擋得住的東西**——日後有人想在這頁加「幫你部署」或「查詢部署狀態」，會先撞到它。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { SelfHost } from "./SelfHost.js";

const render = (locale: "zh-Hant" | "en") =>
  renderToStaticMarkup(<SelfHost c={useCopy(locale)} locale={locale} />);

describe("自架教學頁的內容（ADR-0357）", () => {
  it("三條路線都列出來，各自標明適合誰", () => {
    const out = render("zh-Hant");
    expect(out).toContain('data-testid="sh-routes"');
    expect(out).toContain(useCopy("zh-Hant").sh_r1);
    expect(out).toContain(useCopy("zh-Hant").sh_r2);
    expect(out).toContain(useCopy("zh-Hant").sh_r3);
  });

  it("🔴 Deploy 按鈕那條路要講明它的兩個限制——不講的話使用者會卡在「然後呢」", () => {
    const out = render("zh-Hant");
    expect(out).toContain('data-testid="sh-deploy-warn"');
    expect(out).toContain("GitHub"); // 會在你的 GitHub 建一個程式庫
    expect(out).toContain("網址不會自己回到 App");
  });

  it("🔴 指令用 npx 而不是 pnpm dlx——後者在 pnpm 10 會直接中止", () => {
    const out = render("zh-Hant");
    expect(out).toContain("npx --yes wrangler@4");
    expect(out).not.toContain("pnpm dlx");
  });

  it("指令裡的 pnpm script 名稱在 relay 的 package.json 裡真的存在", async () => {
    // 文案寫在字串裡，沒有東西盯著它——改了 script 名稱不會有人發現（ADR-0357 後續 1）。
    const pkg = (await import("../../../../relay/package.json", { with: { type: "json" } })) as {
      default: { scripts: Record<string, string> };
    };
    const out = render("en");
    for (const name of ["deploy", "deploy:unified"]) {
      expect(out, name).toContain(`pnpm run ${name}`);
      expect(pkg.default.scripts, name).toHaveProperty(name);
    }
  });

  it("統一模式要原樣講出信任降級，不是只講好處", () => {
    expect(render("zh-Hant")).toContain("它被入侵就等於能換掉程式碼");
  });

  it("費用導向 Cloudflare 官方計價頁，不自己宣稱免費", () => {
    const out = render("zh-Hant");
    expect(out).toContain("developers.cloudflare.com/workers/platform/pricing");
    expect(out).not.toContain("永久免費");
  });

  it("教使用者自己用 /healthz 確認——官網不可能替他確認（鐵則的直接代價）", () => {
    expect(render("zh-Hant")).toContain("/healthz");
  });

  it("常見錯誤四條都在，而且每條都有做法", () => {
    const out = render("zh-Hant");
    expect(out).toContain('data-testid="sh-errors"');
    expect(out).toContain(useCopy("zh-Hant").sh_err3_b); // run_worker_first 那條最容易中
  });

  it("誠實邊界寫在頁面上，不是只寫在 ADR 裡", () => {
    const out = render("zh-Hant");
    expect(out).toContain('data-testid="sh-limits"');
    expect(out).toContain("Cloudflare 帳號名");
  });

  it("中英兩版都渲染得出來，且不是同一份文字", () => {
    const zh = render("zh-Hant");
    const en = render("en");
    expect(zh).toContain(useCopy("zh-Hant").sh_title);
    expect(en).toContain(useCopy("en").sh_title);
    expect(zh).not.toBe(en);
  });
});

describe("🔴 硬隔離鐵則在這一頁的具體形狀（ADR-0090／0357 §2）", () => {
  const pages = [render("zh-Hant"), render("en")];

  it("沒有任何表單或輸入欄位——不收 token、不收 npub、不收任何東西", () => {
    for (const out of pages) {
      expect(out).not.toContain("<form");
      expect(out).not.toContain("<input");
      expect(out).not.toContain("<textarea");
    }
  });

  it("沒有分析、cookie 或第三方 widget", () => {
    for (const out of pages) {
      expect(out).not.toContain("<script");
      expect(out).not.toContain("<iframe");
      expect(out.toLowerCase()).not.toContain("analytics");
    }
  });

  it("外連一律 noreferrer——連「他從哪裡點過去的」都不外流", () => {
    for (const out of pages) {
      const externals = out.match(/<a [^>]*href="https?:\/\/[^"]*"[^>]*>/g) ?? [];
      expect(externals.length).toBeGreaterThan(0);
      for (const a of externals) expect(a, a).toContain('rel="noreferrer"');
    }
  });
});
