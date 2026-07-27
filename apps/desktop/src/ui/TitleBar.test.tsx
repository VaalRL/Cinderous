import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { TitleBar, type TitleBarActions } from "./TitleBar.js";
import type { IdentityControlsBundle, TitlebarControls } from "./titlebar-controls.js";

const noop: TitleBarActions = { minimize() {}, toggleMaximize() {}, close() {} };

const render = (over: {
  controls?: TitlebarControls;
  preview?: boolean;
  onOpenSettings?: () => void;
  identityControls?: IdentityControlsBundle | null;
} = {}): string =>
  renderToStaticMarkup(
    <ThemeProvider>
      <I18nProvider locale="zh-Hant">
        <TitleBar actions={noop} {...over} />
      </I18nProvider>
    </ThemeProvider>,
  );

describe("TitleBar 自繪視窗標題列（ADR-0150/0151）", () => {
  it("預設：拖曳區＋標題＋右側依序 ─ □ ✕；未接 onOpenSettings 時不畫 ⚙", () => {
    const html = render();
    expect(html).toContain("data-tauri-drag-region"); // 拖曳＋雙擊最大化（Tauri 內建）
    expect(html).toContain("Cinderous");
    const iTitle = html.indexOf("titlebar__title");
    const iMin = html.indexOf('data-testid="titlebar-min"');
    const iMax = html.indexOf('data-testid="titlebar-max"');
    const iClose = html.indexOf('data-testid="titlebar-close"');
    expect(iTitle).toBeLessThan(iMin);
    expect(iMin).toBeLessThan(iMax);
    expect(iMax).toBeLessThan(iClose);
    expect(html).not.toContain('data-testid="titlebar-settings"'); // 沒有開啟器就不畫 ⚙
  });

  it("⚙ 設定鈕（ADR-0151/0152）：接了 onOpenSettings 才渲染，預設貼在最小化左側（右帶最前）", () => {
    const html = render({ onOpenSettings: () => {} });
    const iSettings = html.indexOf('data-testid="titlebar-settings"');
    const iTitle = html.indexOf("titlebar__title");
    const iMin = html.indexOf('data-testid="titlebar-min"');
    expect(iSettings).toBeGreaterThanOrEqual(0);
    expect(iTitle).toBeLessThan(iSettings); // 右帶：標題之後
    expect(iSettings).toBeLessThan(iMin); // 緊貼 ─ 左側
  });

  it("自訂雙帶順序：left/right 各依陣列序渲染", () => {
    const html = render({
      controls: { left: ["close", "min"], right: ["max", "settings"], autoHide: false, style: "flat" },
      onOpenSettings: () => {},
    });
    const iTitle = html.indexOf("titlebar__title");
    const iMin = html.indexOf('data-testid="titlebar-min"');
    const iMax = html.indexOf('data-testid="titlebar-max"');
    const iClose = html.indexOf('data-testid="titlebar-close"');
    const iSettings = html.indexOf('data-testid="titlebar-settings"');
    expect(iClose).toBeLessThan(iMin);
    expect(iMin).toBeLessThan(iTitle); // 左帶：✕ ─
    expect(iTitle).toBeLessThan(iMax);
    expect(iMax).toBeLessThan(iSettings); // 右帶：□ ⚙
  });

  it("autoHide 語意升級（ADR-0153）：隱藏由殼層（ChromeFrame）處理，TitleBar 不再對按鈕帶掛類", () => {
    const on = render({ controls: { left: [], right: ["min", "max", "close"], autoHide: true, style: "flat" } });
    expect(on).not.toContain("titlebar__controls--autohide");
  });

  it("preview 模式：加 titlebar--preview（設定頁迷你預覽、不可互動）", () => {
    expect(render({ preview: true })).toContain("titlebar--preview");
    expect(render()).not.toContain("titlebar--preview");
  });
});

describe("標題列明暗鈕（ADR-0249）", () => {
  // gate：identityControls 僅三欄＋Tauri 時由 App 註冊（ADR-0206）——有＝畫 🌙/☀️、無＝不畫
  // （Tauri 經典由 ContactListWindow 的 TitleControls 提供，不在標題列重複）。
  const idc: IdentityControlsBundle = {
    active: "pk1",
    options: [{ pubkey: "pk1", label: "👤 Me" }],
    switchLabel: "切換身分",
    addLabel: "新增身分",
    onSwitch: () => {},
    onAdd: () => {},
    unlock: null,
    roster: null,
  };

  it("有 identityControls（三欄＋Tauri）→ 畫 titlebar-theme；無 → 不畫", () => {
    const withId = render({ identityControls: idc });
    expect(withId).toContain('data-testid="titlebar-theme"');
    expect(withId).toContain("🌙"); // SSR 無偏好 → 預設淺色圖示（ADR-0250）
    expect(render()).not.toContain('data-testid="titlebar-theme"');
  });
});
