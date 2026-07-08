import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ComposerRewrite } from "./ComposerRewrite.js";

const render = (text: string) =>
  renderToStaticMarkup(
    <I18nProvider locale="en">
      <ComposerRewrite text={text} onRewrite={async () => "改寫"} onAdopt={() => {}} />
    </I18nProvider>,
  );

describe("ComposerRewrite（ADR-0060）", () => {
  it("有文字時渲染 ✨ 改寫鈕、面板預設關閉、鈕未停用", () => {
    const html = render("hello");
    expect(html).toContain('data-testid="ai-rewrite-btn"');
    expect(html).not.toContain('data-testid="ai-rewrite-panel"');
    expect(html).not.toContain("disabled");
  });

  it("無文字時 ✨ 鈕停用", () => {
    expect(render("")).toContain("disabled");
  });
});
