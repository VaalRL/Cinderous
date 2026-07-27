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

  it("提供 onSwitch（ADR-0211）時顯示「用其他身分登入」入口；未提供則無", () => {
    const out = render({ onSwitch: () => {} });
    expect(out).toContain('data-testid="unlock-switch"');
    expect(out).toContain("用其他身分登入");
    expect(render()).not.toContain('data-testid="unlock-switch"');
  });

  it("逃生口降級為細字連結（ADR-0251）：解鎖獨佔主色、文案縮短", () => {
    const out = render({ onRescue: async () => true, onSwitch: () => {} });
    // 兩顆逃生口掛底線連結語言（signin__relaytoggle），不再 fallback 到 .signin button 主色實心
    expect(out.match(/signin__relaytoggle signin__escape/g)?.length).toBe(2);
    expect(out).not.toContain("settings__reveal"); // 幽靈 class（無 CSS 規則）退場
    expect(out).toContain("忘記密碼？"); // 細節說明留在救援面板 rescue_hint，按鈕不再 16 字
    expect(out).not.toContain("救援登入碼登入回來");
  });
});
