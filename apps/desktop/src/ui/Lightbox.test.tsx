// @vitest-environment jsdom
//
// 燈箱快速複製（ADR-0132）：複製圖片一律有；複製路徑僅在已另存（有 savedPath）時出現。
// 在 jsdom 掛真元件、點按鈕，驗它呼叫了 native 剪貼簿層（該層自身另有單元測試）。

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n.js";
import { Lightbox, type LightboxItem } from "./ConversationWindow.js";
import { mount } from "../test/jsdom-mount.js";

// native 剪貼簿層換成 spy——這裡只驗 UI 有沒有把對的東西交出去。
const copyImageFromUrl = vi.fn().mockResolvedValue(true);
const copyText = vi.fn().mockResolvedValue(true);
vi.mock("../native/clipboard.js", () => ({
  copyImageFromUrl: (src: string) => copyImageFromUrl(src),
  copyText: (t: string) => copyText(t),
}));

afterEach(() => {
  copyImageFromUrl.mockClear();
  copyText.mockClear();
});

const item = (over: Partial<LightboxItem> = {}): LightboxItem => ({
  id: "m1",
  name: "cat.png",
  mime: "image/png",
  preview: "blob:cat",
  hasOriginal: true, // 本 session 有原圖 → state 直接是 ok，動作列會出現
  ...over,
});

const render = (it: LightboxItem): JSX.Element => (
  <I18nProvider>
    <Lightbox item={it} onClose={() => {}} onRelocated={() => {}} />
  </I18nProvider>
);

const click = async (el: Element | null): Promise<void> => {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("燈箱快速複製（ADR-0132）", () => {
  it("複製圖片鈕一律出現；點它 → 以顯示中的 src 呼叫 copyImageFromUrl", async () => {
    const m = mount(render(item()));
    const btn = m.container.querySelector('[data-testid="copy-image"]');
    expect(btn).not.toBeNull();
    await click(btn);
    expect(copyImageFromUrl).toHaveBeenCalledWith("blob:cat");
  });

  it("沒有 savedPath → **不顯示**複製路徑鈕（沒存過的圖沒有路徑可複製）", () => {
    const m = mount(render(item()));
    expect(m.container.querySelector('[data-testid="copy-path"]')).toBeNull();
  });

  it("有 savedPath → 顯示複製路徑鈕；點它 → 以 savedPath 呼叫 copyText", async () => {
    const m = mount(render(item({ savedPath: "C:/imgs/cat.png" })));
    const btn = m.container.querySelector('[data-testid="copy-path"]');
    expect(btn).not.toBeNull();
    await click(btn);
    expect(copyText).toHaveBeenCalledWith("C:/imgs/cat.png");
  });
});
