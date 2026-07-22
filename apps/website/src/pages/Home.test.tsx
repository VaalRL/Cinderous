// hero icon 按鈕列（ADR-0229）：分平台下載（Windows 可用、macOS／行動版 disabled）＋
// 網頁版／GitHub 入口＋tooltip／aria-label；「看技術原理」保留文字連結。SSR 斷言。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { GITHUB_URL, WEBAPP_URL } from "../App.js";
import { Home } from "./Home.js";

const render = (locale: "zh-Hant" | "en" = "zh-Hant"): string =>
  renderToStaticMarkup(<Home c={useCopy(locale)} theme="light" onNode={() => {}} onTech={() => {}} />);

describe("Home hero icon 按鈕列（ADR-0229）", () => {
  it("Windows 為主要下載、連 GitHub releases；網頁版與 GitHub 為一般入口", () => {
    const html = render();
    expect(html).toContain(`${GITHUB_URL}/releases`);
    expect(html).toContain(WEBAPP_URL);
    expect(html).toContain("iconbtn--primary");
    expect(html).toContain('aria-label="下載 Windows 版"');
  });

  it("macOS 與行動版 disabled：aria-disabled＋灰階 class＋「即將推出」tooltip", () => {
    const html = render();
    const disabledCount = (html.match(/aria-disabled="true"/g) ?? []).length;
    expect(disabledCount).toBe(2);
    expect(html).toContain("iconbtn--disabled");
    expect(html).toContain("即將推出");
  });

  it("tooltip 與手機可見標籤皆存在；「看技術原理」保留文字連結", () => {
    const html = render();
    expect(html).toContain("iconbtn__tip");
    expect(html).toContain("iconbtn__label");
    expect(html).toContain("看技術原理");
    const en = render("en");
    expect(en).toContain('aria-label="Download for Windows"');
    expect(en).toContain("Coming soon");
  });
});
