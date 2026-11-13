// @vitest-environment jsdom
//
// ADR-0421：畫面元件丟例外時不再整片空白（只剩底色）——改顯示錯誤畫面，並把錯誤記進本機診斷紀錄。

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiagLog, memoryDiagStore } from "@cinderous/engine";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { mount, type Mounted } from "../test/jsdom-mount.js";

function Boom(): JSX.Element {
  throw new Error("render exploded npub1" + "x".repeat(58));
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.documentElement.lang = "";
  vi.restoreAllMocks();
});

describe("ErrorBoundary（ADR-0421）", () => {
  it("子元件正常 ⇒ 原樣顯示", () => {
    const log = createDiagLog({ store: memoryDiagStore(), version: "t" });
    m = mount(
      <ErrorBoundary log={log}>
        <p>正常內容</p>
      </ErrorBoundary>,
    );
    expect(m.container.textContent).toContain("正常內容");
    expect(log.list()).toEqual([]);
  });

  it("🔴 子元件丟例外 ⇒ 顯示錯誤畫面（不是空白），並記一筆 render（已遮罩）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // React 自己會 console.error 一次
    document.documentElement.lang = "zh-Hant";
    const log = createDiagLog({ store: memoryDiagStore(), version: "t" });
    m = mount(
      <ErrorBoundary log={log}>
        <Boom />
      </ErrorBoundary>,
    );
    const fallback = m.container.querySelector('[data-testid="crash-screen"]');
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toContain("畫面出錯了");
    expect(m.container.querySelector('[data-testid="crash-reload"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="crash-copy"]')).not.toBeNull();
    const [e] = log.list();
    expect(e).toMatchObject({ src: "render" });
    expect(e!.msg).toContain("render exploded [npub]");
  });

  it("錯誤畫面不依賴 I18nProvider：用 <html lang> 決定語言（英文）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.documentElement.lang = "en";
    const log = createDiagLog({ store: memoryDiagStore(), version: "t" });
    m = mount(
      <ErrorBoundary log={log}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(m.container.textContent).toContain("Something went wrong");
  });
});
