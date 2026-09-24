// 開發者文件頁（ADR-0368）。
//
// 最重要的是「數字對得上」那一組：文件寫的保存期、配額與速率上限，必須就是中繼站
// 實際在執行的常數。文件說 7 天、實際存 2 小時，是第三方開發者最難查的一種錯。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  APP_ADDRESSABLE_PER_AUTHOR,
  MAX_EVENTS_PER_MINUTE,
  MAX_MESSAGES_PER_MINUTE,
  MAX_SUBSCRIPTIONS,
  PUBLIC_LANE_ADDRESSABLE_PER_AUTHOR,
  PUBLIC_LANE_RETENTION_SECONDS,
} from "../../../../relay/src/host-config.js";
import { devDocsFor, type Block } from "../devdocs/content.js";
import { DEV_DOC_SLUGS, isDevDocSlug, type DevDocSlug } from "../devdocs/structure.js";
import { routeHref } from "../routes.js";
import { Developers } from "./Developers.js";

type Loc = "en" | "zh-Hant";
const LOCALES: Loc[] = ["en", "zh-Hant"];
const render = (locale: Loc, doc?: DevDocSlug) =>
  renderToStaticMarkup(doc === undefined ? <Developers locale={locale} /> : <Developers locale={locale} doc={doc} />);

/** 某頁所有文字（含表格與清單）串成一個字串，方便找標記。 */
function textsOf(blocks: Block[]): string[] {
  return blocks.flatMap((b) =>
    "p" in b ? [b.p] : "note" in b ? [b.note] : "list" in b ? b.list : "table" in b ? [...b.table.head, ...b.table.rows.flat()] : [],
  );
}

describe("開發者文件的結構（ADR-0368）", () => {
  it("每一頁中英兩版都渲染得出來，H1 是該頁標題", () => {
    for (const locale of LOCALES) {
      const docs = devDocsFor(locale);
      for (const doc of [undefined, ...DEV_DOC_SLUGS]) {
        const out = render(locale, doc);
        const title = docs.pages[doc ?? "overview"].title;
        expect(out, `${locale}/${doc}`).toMatch(new RegExp(`<h1[^>]*>${title.replace(/[()]/g, "\\$&")}</h1>`));
      }
    }
  });

  it("左側導覽列出每一頁，而且都是可跟隨的 <a href>", () => {
    const out = render("en", "limits");
    expect(out).toContain(`href="${routeHref({ view: "developers", locale: "en" })}"`);
    for (const doc of DEV_DOC_SLUGS) {
      expect(out, doc).toContain(`href="${routeHref({ view: "developers", locale: "en", doc })}"`);
    }
  });

  it("右側目錄指向本頁每一個段落", () => {
    for (const doc of DEV_DOC_SLUGS) {
      const out = render("en", doc);
      for (const section of devDocsFor("en").pages[doc].sections) {
        expect(out, `${doc}#${section.id}`).toContain(`id="${section.id}"`);
        expect(out, `${doc}#${section.id}`).toContain(`href="#${section.id}"`);
      }
    }
  });

  it("上一頁／下一頁：總覽沒有上一頁、最後一頁沒有下一頁", () => {
    const first = render("en");
    expect(first).not.toContain('data-testid="doc-prev"');
    expect(first).toContain(`href="${routeHref({ view: "developers", locale: "en", doc: "quick-start" })}"`);
    const last = render("en", DEV_DOC_SLUGS[DEV_DOC_SLUGS.length - 1]);
    expect(last).not.toContain('data-testid="doc-next"');
  });

  it("🔴 內容裡的站內連結都指向真的存在的頁面", () => {
    for (const locale of LOCALES) {
      for (const page of Object.values(devDocsFor(locale).pages)) {
        for (const text of page.sections.flatMap((s) => textsOf(s.blocks))) {
          for (const m of text.matchAll(/\]\(doc:([^)]*)\)/g)) {
            const slug = m[1] ?? "";
            expect(slug === "" || isDevDocSlug(slug), `${locale}: doc:${slug}`).toBe(true);
          }
        }
      }
    }
  });

  it("連結標記全部被換成真正的網址——HTML 裡不留 doc:／repo:／view:", () => {
    for (const locale of LOCALES) {
      for (const doc of [undefined, ...DEV_DOC_SLUGS]) {
        const out = render(locale, doc);
        expect(out, `${locale}/${doc}`).not.toMatch(/href="(doc|repo|view):/);
        expect(out, `${locale}/${doc}`).not.toContain("](");
        expect(out, `${locale}/${doc}`).not.toContain("**");
      }
    }
  });

  it("每頁的段落 id 不重複（否則目錄會跳錯地方）", () => {
    for (const locale of LOCALES) {
      for (const page of Object.values(devDocsFor(locale).pages)) {
        const ids = page.sections.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it("中英兩版的段落結構一致（同樣的 id、同樣的順序）", () => {
    for (const key of ["overview", ...DEV_DOC_SLUGS] as const) {
      const en = devDocsFor("en").pages[key].sections.map((s) => s.id);
      const zh = devDocsFor("zh-Hant").pages[key].sections.map((s) => s.id);
      expect(zh, key).toEqual(en);
    }
  });
});

describe("🔴 文件裡的數字就是中繼實際在執行的值", () => {
  it("保存期：公用車道 2 小時", () => {
    expect(PUBLIC_LANE_RETENTION_SECONDS).toBe(2 * 60 * 60);
    expect(render("en", "retention")).toContain("2 hours");
    expect(render("zh-Hant", "retention")).toContain("2 小時");
  });

  it("可尋址位址配額：已知租戶與公用車道", () => {
    for (const locale of LOCALES) {
      const out = render(locale, "retention");
      expect(out).toContain(`<td>${APP_ADDRESSABLE_PER_AUTHOR}</td>`);
      expect(out).toContain(`<td>${PUBLIC_LANE_ADDRESSABLE_PER_AUTHOR}</td>`);
    }
  });

  it("速率上限：訊息、事件、訂閱數", () => {
    const out = render("en", "limits");
    expect(out).toContain(`${MAX_MESSAGES_PER_MINUTE} per minute`);
    expect(out).toContain(`${MAX_EVENTS_PER_MINUTE} per minute`);
    expect(out).toContain(`<td>${MAX_SUBSCRIPTIONS}</td>`);
  });

  it("端點：列出的錨點就是維護者清單上的那兩座", async () => {
    const list = (await import("../../../../relay/bootstrap/relays.json", { with: { type: "json" } })) as {
      default: { relays: string[] };
    };
    const out = render("en", "endpoints");
    for (const url of list.default.relays) expect(out, url).toContain(url);
  });
});
