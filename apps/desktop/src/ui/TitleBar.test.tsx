import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { TitleBar, type TitleBarActions } from "./TitleBar.js";
import type { TitlebarControls } from "./titlebar-controls.js";

const noop: TitleBarActions = { minimize() {}, toggleMaximize() {}, close() {} };

const render = (over: {
  controls?: TitlebarControls;
  preview?: boolean;
  onOpenSettings?: () => void;
} = {}): string =>
  renderToStaticMarkup(
    <I18nProvider locale="zh-Hant">
      <TitleBar actions={noop} {...over} />
    </I18nProvider>,
  );

describe("TitleBar 自繪視窗標題列（ADR-0150/0151）", () => {
  it("預設：拖曳區＋標題＋右側依序 ─ □ ✕；未接 onOpenSettings 時不畫 ⚙", () => {
    const html = render();
    expect(html).toContain("data-tauri-drag-region"); // 拖曳＋雙擊最大化（Tauri 內建）
    expect(html).toContain("Cinder");
    const iTitle = html.indexOf("titlebar__title");
    const iMin = html.indexOf('data-testid="titlebar-min"');
    const iMax = html.indexOf('data-testid="titlebar-max"');
    const iClose = html.indexOf('data-testid="titlebar-close"');
    expect(iTitle).toBeLessThan(iMin);
    expect(iMin).toBeLessThan(iMax);
    expect(iMax).toBeLessThan(iClose);
    expect(html).not.toContain('data-testid="titlebar-settings"'); // 沒有開啟器就不畫 ⚙
  });

  it("⚙ 設定鈕（ADR-0151）：接了 onOpenSettings 才渲染，預設在左帶（標題前）", () => {
    const html = render({ onOpenSettings: () => {} });
    const iSettings = html.indexOf('data-testid="titlebar-settings"');
    const iTitle = html.indexOf("titlebar__title");
    expect(iSettings).toBeGreaterThanOrEqual(0);
    expect(iSettings).toBeLessThan(iTitle); // 左帶在標題前
  });

  it("自訂雙帶順序：left/right 各依陣列序渲染", () => {
    const html = render({
      controls: { left: ["close", "min"], right: ["max", "settings"], autoHide: false },
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

  it("autoHide（ADR-0151）：開啟時按鈕帶掛 --autohide（滑鼠碰標題列才顯示）", () => {
    const on = render({ controls: { left: [], right: ["min", "max", "close"], autoHide: true } });
    expect(on).toContain("titlebar__controls--autohide");
    expect(render()).not.toContain("titlebar__controls--autohide");
  });

  it("preview 模式：加 titlebar--preview（設定頁迷你預覽、不可互動）", () => {
    expect(render({ preview: true })).toContain("titlebar--preview");
    expect(render()).not.toContain("titlebar--preview");
  });
});
