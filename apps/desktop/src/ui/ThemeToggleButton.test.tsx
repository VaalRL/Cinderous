// @vitest-environment jsdom
//
// 明暗切換鈕（ADR-0249）：三欄佈局補上的快速明/暗切換。抽為共用元件（SSOT），
// 桌面標題列、經典聯絡人視窗、三欄 idbar 共用同一顆——這裡在 jsdom 掛載測真實點擊行為。
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { mount } from "../test/jsdom-mount.js";
import { ThemeToggleButton } from "./ThemeToggleButton.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function wrap(node: JSX.Element): JSX.Element {
  return (
    <ThemeProvider>
      <I18nProvider locale="zh-Hant">{node}</I18nProvider>
    </ThemeProvider>
  );
}

describe("ThemeToggleButton（ADR-0249）", () => {
  it("預設淺色 → 顯示 🌙、aria-pressed=false", () => {
    const { container } = mount(wrap(<ThemeToggleButton testId="tt" />));
    const btn = container.querySelector("[data-testid=tt]") as HTMLButtonElement;
    expect(btn.textContent).toBe("🌙");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("點擊 → 切到深色（root data-theme=dark、圖示變 ☀️、落地 localStorage）", () => {
    const { container } = mount(wrap(<ThemeToggleButton testId="tt" />));
    const btn = container.querySelector("[data-testid=tt]") as HTMLButtonElement;
    act(() => btn.click());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(btn.textContent).toBe("☀️");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("nb.theme")).toBe("dark");
  });

  it("className 可覆寫（供 idbar/標題列各自貼合樣式）", () => {
    const { container } = mount(wrap(<ThemeToggleButton className="idbar__add idbar__theme" testId="tt" />));
    const btn = container.querySelector("[data-testid=tt]") as HTMLButtonElement;
    expect(btn.className).toContain("idbar__theme");
  });
});
