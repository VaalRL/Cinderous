// @vitest-environment jsdom
//
// 高對比套用到 DOM 的 useEffect 測試（ADR-0253，模式比照 theme.effect.test）：
// `data-contrast` 是高對比實際生效的地方（CSS `[data-contrast="high"]` 吃它），SSR 測不到。
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ContrastProvider, useContrast } from "./contrast.js";
import { mount } from "./test/jsdom-mount.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-contrast");
});

function Toggle(): JSX.Element {
  const { toggle } = useContrast();
  return (
    <button data-testid="tg" onClick={toggle}>
      toggle
    </button>
  );
}

describe("高對比套用到 DOM（ADR-0253）", () => {
  it("預設 normal → root 無 data-contrast（完全無痕）", () => {
    mount(
      <ContrastProvider>
        <span />
      </ContrastProvider>,
    );
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });

  it("localStorage 記著 high → 掛載即套用", () => {
    localStorage.setItem("nb.contrast", "high");
    mount(
      <ContrastProvider>
        <span />
      </ContrastProvider>,
    );
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
  });

  it("切換 → 屬性即時掛/卸，且落地（下次開機讀得回）", () => {
    const { container } = mount(
      <ContrastProvider>
        <Toggle />
      </ContrastProvider>,
    );
    const btn = container.querySelector("[data-testid=tg]") as HTMLButtonElement;
    act(() => btn.click());
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(localStorage.getItem("nb.contrast")).toBe("high");
    act(() => btn.click());
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
    expect(localStorage.getItem("nb.contrast")).toBe("normal"); // 明確記住「關」＝不再跟隨系統
  });
});
