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

  const render = (props: Partial<Parameters<typeof UnlockScreen>[0]> = {}) =>
    renderToStaticMarkup(
      <ThemeProvider>
        <I18nProvider locale="zh-Hant">
          <UnlockScreen name="小美" onUnlock={async () => true} {...props} />
        </I18nProvider>
      </ThemeProvider>,
    );

  it("顯示身分名稱、密碼欄為 password 型別、空密碼時按鈕停用", () => {
    const out = render();
    expect(out).toContain("小美");
    expect(out).toContain('type="password"');
    expect(out).toContain("disabled");
  });

  it("提供 onRescue（ADR-0073）時顯示「忘記密碼？」逃生口；未提供則無", () => {
    expect(render({ onRescue: async () => true })).toContain('data-testid="unlock-forgot"');
    expect(render()).not.toContain('data-testid="unlock-forgot"');
  });
});
