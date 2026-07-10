import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n.js";
import { Avatar } from "./Avatar.js";
import { setAvatar } from "./personalize.js";

const render = (node: JSX.Element) => renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);

describe("Avatar 自訂/生成分支（ADR-0077 O2）", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("無自訂圖：渲染生成頭像（名字首字）", () => {
    const html = render(<Avatar id="pkX" name="Amy" />);
    expect(html).toContain(">A<"); // 首字
    expect(html).not.toContain("background-image");
  });

  it("有自訂圖：渲染背景圖、不顯示首字", () => {
    setAvatar("pkX", "data:image/jpeg;base64,ZZZ");
    const html = render(<Avatar id="pkX" name="Amy" />);
    expect(html).toContain("background-image");
    expect(html).toContain("data:image/jpeg;base64,ZZZ");
    expect(html).not.toContain(">A<");
  });
});
