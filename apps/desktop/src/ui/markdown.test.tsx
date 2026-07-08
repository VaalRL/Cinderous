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

describe("區塊 Markdown 渲染（程式碼區塊 / 清單）", () => {
  it("``` 程式碼區塊：pre>code、內容字面值（不解析行內語法）", () => {
    const out = html("```\nconst a = 1;\n**not bold**\n```");
    expect(out).toContain('<pre class="md-pre"><code>');
    expect(out).toContain("**not bold**");
    expect(out).not.toContain("<strong>");
  });

  it("未閉合的 ``` 取至結尾（截斷容錯）", () => {
    expect(html("```\nabc")).toContain("abc</code></pre>");
  });

  it("無序清單：- / * 成 ul>li；行內語法在項目內仍有效", () => {
    const out = html("- **粗**\n* b");
    expect(out).toContain('<ul class="md-list">');
    expect(out).toContain("<li><strong>粗</strong></li>");
    expect(out).toContain("<li>b</li>");
  });

  it("有序清單：1. 成 ol>li", () => {
    const out = html("1. 一\n2. 二");
    expect(out).toContain('<ol class="md-list">');
    expect(out).toContain("<li>一</li>");
  });

  it("巢狀清單：tab 或 2 空白縮排一層", () => {
    const tab = html("- a\n\t- b");
    expect(tab.match(/<ul/g)?.length).toBe(2);
    const spaces = html("- a\n  - b");
    expect(spaces.match(/<ul/g)?.length).toBe(2);
  });

  it("清單前後的段落照常渲染；純 - 開頭但無空白不是清單", () => {
    const out = html("前言\n- a\n結語");
    expect(out).toContain("前言");
    expect(out).toContain("結語");
    expect(html("-not a list")).not.toContain("<ul");
  });
});

describe("引言與 Obsidian 風 callout", () => {
  it("callout：型別色系 + 圖示 + 標題 + 內文", () => {
    const out = html("> [!tip] 標題\n> 內文");
    expect(out).toContain("md-callout--green");
    expect(out).toContain("💡");
    expect(out).toContain("標題");
    expect(out).toContain("內文");
  });

  it("無標題時以型別名（首字大寫）為標題；warning 為 amber", () => {
    const out = html("> [!warning]\n> 小心");
    expect(out).toContain("Warning");
    expect(out).toContain("md-callout--amber");
  });

  it("未知型別退回 note（blue）；標題可帶行內格式", () => {
    const out = html("> [!xyz] **粗**標");
    expect(out).toContain("md-callout--blue");
    expect(out).toContain("<strong>粗</strong>");
  });

  it("callout 內文遞迴解析：清單與程式碼區塊都有效", () => {
    const out = html("> [!note] t\n> - a\n> ```\n> code\n> ```");
    expect(out).toContain('<ul class="md-list">');
    expect(out).toContain("md-pre");
  });

  it("一般引言（無 [!type]）成 blockquote；非 callout", () => {
    const out = html("> 純引言");
    expect(out).toContain('<blockquote class="md-quote">');
    expect(out).not.toContain("md-callout");
  });

  it("惡意深巢 > 不撐爆（深度上限退回字面渲染）", () => {
    const evil = `${">".repeat(200)} deep`;
    expect(() => html(evil)).not.toThrow();
    expect(html(evil)).toContain("deep");
  });
});
