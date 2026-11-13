// @vitest-environment jsdom
//
// ADR-0421 行動端：畫面丟例外不再白屏、設定頁有「診斷紀錄」（只存在這台裝置）。

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiagLog, memoryDiagStore } from "@cinderous/engine";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { diagLog } from "../native/diag.js";
import { mount, type Mounted } from "../test/jsdom-mount.js";

const base = {
  selfName: "夜",
  selfNpub: "npub1abc",
  selfNsec: "nsec1abc",
  relayUrl: "wss://relay.example",
  theme: "light" as const,
  onTheme: () => {},
  locale: "zh-Hant" as const,
  onLocale: () => {},
  accent: null,
  onAccent: () => {},
  invisible: false,
  onInvisible: () => {},
  onLogout: () => {},
};
const render = (): string => renderToStaticMarkup(<SettingsScreen {...base} />);

function Boom(): JSX.Element {
  throw new Error("mobile exploded nsec1" + "q".repeat(58));
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  diagLog.clear();
  vi.restoreAllMocks();
});

describe("行動端 ErrorBoundary（ADR-0421）", () => {
  it("🔴 子元件丟例外 ⇒ 錯誤畫面＋記一筆 render（已遮罩）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createDiagLog({ store: memoryDiagStore(), version: "t" });
    m = mount(
      <ErrorBoundary log={log} locale="zh-Hant">
        <Boom />
      </ErrorBoundary>,
    );
    expect(m.container.querySelector('[data-testid="crash-screen"]')).not.toBeNull();
    expect(m.container.textContent).toContain("畫面出錯了");
    expect(m.container.querySelector('[data-testid="crash-reload"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="crash-copy"]')).not.toBeNull();
    expect(log.list()[0]).toMatchObject({ src: "render" });
    expect(log.list()[0]!.msg).toContain("mobile exploded [nsec]");
  });
});

describe("行動端設定：診斷紀錄（ADR-0421）", () => {
  it("顯示筆數、複製、清除；沒紀錄時清除停用", () => {
    const html = render();
    expect(html).toContain('data-testid="diag-section"');
    expect(html).toContain("診斷紀錄");
    expect(html).toContain("只存在這台裝置");
    expect(html).toMatch(/data-testid="diag-count"[^>]*>0 筆</);
    expect(html).toContain('data-testid="diag-copy"');
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="diag-clear"|data-testid="diag-clear"[^>]*aria-disabled="true"/);
  });

  it("有紀錄 ⇒ 筆數跟著變、清除可按", () => {
    diagLog.record("window", new Error("x"));
    const html = render();
    expect(html).toMatch(/data-testid="diag-count"[^>]*>1 筆</);
    expect(html).not.toMatch(/aria-disabled="true"[^>]*data-testid="diag-clear"|data-testid="diag-clear"[^>]*aria-disabled="true"/);
  });
});
