import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { UnlockScreen } from "./UnlockScreen.js";

describe("UnlockScreen（ADR-0067 本地密碼解鎖）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = {
      matchMedia: () => ({ matches: false }),
    };
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("顯示身分名稱、密碼欄為 password 型別、空密碼時按鈕停用", () => {
    const out = renderToStaticMarkup(
      <ThemeProvider>
        <I18nProvider locale="zh-Hant">
          <UnlockScreen name="小美" onUnlock={async () => true} />
        </I18nProvider>
      </ThemeProvider>,
    );
    expect(out).toContain("小美");
    expect(out).toContain('type="password"');
    expect(out).toContain("disabled");
  });
});
