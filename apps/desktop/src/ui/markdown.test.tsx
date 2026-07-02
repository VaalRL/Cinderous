import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { renderMarkdown } from "./markdown.js";

const html = (text: string) => renderToStaticMarkup(<>{renderMarkdown(text)}</>);
// 風險連結（RiskyLink）需要 i18n context。
const htmlI18n = (text: string) => renderToStaticMarkup(<I18nProvider>{renderMarkdown(text)}</I18nProvider>);

describe("行內 Markdown 渲染", () => {
  it("粗體 / 斜體 / 刪除線 / 行內碼", () => {
    expect(html("**粗** *斜* ~~刪~~ `碼`")).toBe(
      "<strong>粗</strong> <em>斜</em> <s>刪</s> <code>碼</code>",
    );
  });

  it("http(s) 連結會渲染為 a，並帶 noopener", () => {
    const out = html("看 [這裡](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain(">這裡</a>");
  });

  it("換行轉為 <br>", () => {
    expect(html("a\nb")).toBe("a<br/>b");
  });

  it("XSS：javascript: 連結不會變成 a，HTML 會被跳脫", () => {
    expect(html("[x](javascript:alert(1))")).not.toContain("<a");
    expect(html("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });

  it("純文字原樣保留", () => {
    expect(html("hello world")).toBe("hello world");
  });

  it("高風險連結（ADR-0038）：文字偽裝連結帶 ⚠ 徽章與 danger 樣式", () => {
    const out = htmlI18n("[https://bank.com](https://evil.io/login)");
    expect(out).toContain("risklink--danger");
    expect(out).toContain("⚠");
    expect(out).toContain('href="https://evil.io/login"');
  });

  it("高風險連結：http 為 caution；乾淨 https 連結不帶徽章", () => {
    expect(htmlI18n("[載點](http://example.com/f)")).toContain("risklink--caution");
    const clean = htmlI18n("[這裡](https://example.com)");
    expect(clean).not.toContain("risklink");
    expect(clean).not.toContain("⚠");
  });
});
