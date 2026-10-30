// CLI 使用說明頁（ADR-0405）。
//
// 最重要的是「寫的都是真的」：頁面上的每一個 `--旗標` 與 `cinder <指令>` 都必須存在於 CLI 的 HELP，
// 速率數字必須是中繼站實際的值，下載連結必須是發版腳本產出的檔名。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HELP } from "../../../cli/src/args.js";
import { MAX_EVENTS_PER_MINUTE } from "../../../../relay/src/index.js";
import { ARTIFACT_NAME } from "../../../../scripts/cli-artifact.mjs";
import { GITHUB_URL } from "../App.js";
import { cliGuideFor } from "../cli-guide.js";
import { useCopy } from "../copy.js";
import { routeHref } from "../routes.js";
import { Cli, CLI_CHECKSUM_URL, CLI_DOWNLOAD_URL } from "./Cli.js";
import { Home } from "./Home.js";

type Loc = "en" | "zh-Hant";
const LOCALES: Loc[] = ["en", "zh-Hant"];
const render = (locale: Loc) => renderToStaticMarkup(<Cli locale={locale} />);

describe("CLI 頁（ADR-0405）", () => {
  it("下載連結指向最新 Release 的固定檔名（換版不用改網站）", () => {
    expect(CLI_DOWNLOAD_URL).toBe(`${GITHUB_URL}/releases/latest/download/${ARTIFACT_NAME}`);
    expect(CLI_CHECKSUM_URL).toBe(`${CLI_DOWNLOAD_URL}.sha256`);
    for (const l of LOCALES) {
      const html = render(l);
      expect(html).toContain(`href="${CLI_DOWNLOAD_URL}"`);
      expect(html).toContain(`href="${CLI_CHECKSUM_URL}"`);
      expect(html).toContain("Node.js 22");
    }
  });

  it("🔴 頁面上的每一個旗標都真的存在於 CLI", () => {
    for (const l of LOCALES) {
      const flags = new Set(render(l).match(/(?<![\w-])--[a-z][a-z-]+/g) ?? []);
      expect(flags.size).toBeGreaterThan(8);
      for (const f of flags) expect(HELP, `${l} 頁面寫了 ${f}`).toContain(f);
    }
  });

  it("🔴 頁面上的每一個指令都真的存在於 CLI", () => {
    for (const l of LOCALES) {
      const subs = new Set([...render(l).matchAll(/cinder\.mjs (\w+)/g)].map((m) => m[1]!));
      expect([...subs].sort()).toEqual(["ask", "keygen", "listen", "send"]);
      for (const s of subs) expect(HELP).toContain(`cinder ${s}`);
    }
  });

  it("速率數字就是中繼站實際的值", () => {
    expect(render("en")).toContain(`${MAX_EVENTS_PER_MINUTE} events a minute`);
    expect(render("zh-Hant")).toContain(`每分鐘最多 ${MAX_EVENTS_PER_MINUTE} 則事件`);
  });

  it("🔴 不誇大：兩種語言都寫出明文會到模型、狀態目錄與私鑰同機、--fs 只保護中繼上的密文", () => {
    const en = render("en");
    expect(en).toContain("model sees the plaintext");
    expect(en).toContain("on the same machine");
    expect(en).toContain("only protects ciphertext stored on relays");
    const zh = render("zh-Hant");
    expect(zh).toContain("模型看得到明文");
    expect(zh).toContain("同一台機器上");
    expect(zh).toContain("只保護存在中繼上的密文");
  });

  it("只教學、不收資料（ADR-0090）：沒有表單、沒有輸入欄", () => {
    for (const l of LOCALES) {
      const html = render(l);
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<input");
    }
  });

  it("每一節都有標題與錨點，兩種語言節數相同", () => {
    expect(cliGuideFor("en").sections.map((s) => s.id)).toEqual(cliGuideFor("zh-Hant").sections.map((s) => s.id));
    const html = render("en");
    for (const s of cliGuideFor("en").sections) expect(html).toContain(`id="${s.id}"`);
  });
});

describe("首頁的 CLI 入口（ADR-0405）", () => {
  it("hero 列有一顆 CLI，連到 CLI 頁", () => {
    for (const l of LOCALES) {
      const html = renderToStaticMarkup(
        <Home c={useCopy(l)} theme="light" onNode={() => {}} onTech={() => {}} cliHref={routeHref({ view: "cli", locale: l })} />,
      );
      expect(html).toContain(`href="${routeHref({ view: "cli", locale: l })}"`);
      expect(html).toContain(useCopy(l).hero_tip_cli);
    }
  });
});
