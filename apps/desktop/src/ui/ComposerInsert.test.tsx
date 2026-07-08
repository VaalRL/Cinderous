import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { calloutTemplate, codeTemplate, ComposerInsert, listTemplate } from "./ComposerInsert.js";

describe("快速插入模板（純函式）", () => {
  it("calloutTemplate：文字含 [!type]，選取範圍剛好是標題佔位", () => {
    const tpl = calloutTemplate("tip", "標題", "內容");
    expect(tpl.text).toBe("> [!tip] 標題\n> 內容");
    expect(tpl.text.slice(tpl.selStart, tpl.selEnd)).toBe("標題");
    expect(tpl.icon).toBe("💡");
  });

  it("codeTemplate / listTemplate：選取範圍是佔位字", () => {
    const code = codeTemplate("程式碼", "程式碼區塊");
    expect(code.text.slice(code.selStart, code.selEnd)).toBe("程式碼");
    expect(code.text.startsWith("```\n")).toBe(true);
    const list = listTemplate("項目", "清單");
    expect(list.text).toBe("- 項目");
    expect(list.text.slice(list.selStart, list.selEnd)).toBe("項目");
  });
});

describe("ComposerInsert 元件", () => {
  it("渲染 ➕ 插入鈕、面板預設關閉", () => {
    const out = renderToStaticMarkup(
      <I18nProvider locale="en">
        <ComposerInsert onPick={() => {}} />
      </I18nProvider>,
    );
    expect(out).toContain('data-testid="insert-btn"');
    expect(out).not.toContain('data-testid="insert-panel"');
  });
});
