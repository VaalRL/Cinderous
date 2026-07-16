import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n.js";
import { ChromeFrame, TitlebarProvider, WindowChrome } from "./titlebar.js";

describe("WindowChrome 自繪外框殼層（ADR-0150）", () => {
  it("瀏覽器模式（非 Tauri）→ 原樣透傳、不畫標題列", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <TitlebarProvider>
          <WindowChrome>
            <div>內容照舊</div>
          </WindowChrome>
        </TitlebarProvider>
      </I18nProvider>,
    );
    expect(html).toContain("內容照舊");
    expect(html).not.toContain("titlebar"); // 外框是瀏覽器的，這裡不畫
  });
});

describe("ChromeFrame 自動隱藏（ADR-0153：整條標題列滑出、頂端熱區喚回）", () => {
  const noop = { minimize() {}, toggleMaximize() {}, close() {} };
  const frame = (autoHide: boolean): string =>
    renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <ChromeFrame controls={{ left: [], right: ["min", "max", "close"], autoHide }} actions={noop}>
          <div>內容</div>
        </ChromeFrame>
      </I18nProvider>,
    );

  it("autoHide 開 → 殼層掛 --autohide、渲染頂端熱區（滑鼠碰到才滑入）", () => {
    const html = frame(true);
    expect(html).toContain("window-chrome--autohide");
    expect(html).toContain('data-testid="chrome-hotzone"');
    expect(html).toContain("titlebar"); // 標題列仍在（覆蓋層），只是平時滑出畫面
  });

  it("autoHide 關 → 一般殼層、無熱區", () => {
    const html = frame(false);
    expect(html).not.toContain("window-chrome--autohide");
    expect(html).not.toContain('data-testid="chrome-hotzone"');
  });
});
