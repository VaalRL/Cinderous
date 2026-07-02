import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";

const markup = () =>
  renderToStaticMarkup(
    <I18nProvider>
      <LanguageSwitcher />
    </I18nProvider>,
  );

describe("LanguageSwitcher 結構與無障礙", () => {
  it("觸發鈕帶 listbox 語意，預設收合", () => {
    const html = markup();
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    // 收合狀態不渲染選單
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
  });

  it("觸發鈕顯示地球圖示與當前語系標籤", () => {
    const html = markup();
    expect(html).toContain("🌐");
    // 預設語系隨環境（localStorage / navigator）而定，顯示其中一個有效標籤即可
    expect(html).toMatch(/繁中|EN/);
  });
});
