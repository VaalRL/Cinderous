import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccentProvider } from "../accent.js";
import { I18nProvider } from "../i18n.js";
import { ThemeProvider } from "../theme.js";
import { relayChangeReady, SettingsPanel, type SettingsPanelProps } from "./SettingsPanel.js";

describe("relayChangeReady（更換輸入驗證）", () => {
  it("ws(s):// 且與現值不同才可套用", () => {
    expect(relayChangeReady("wss://new.example", "wss://x")).toBe(true);
    expect(relayChangeReady("ws://localhost:8787", "wss://x")).toBe(true);
    expect(relayChangeReady("wss://x", "wss://x")).toBe(false); // 同值
    expect(relayChangeReady("https://x", "wss://x")).toBe(false); // 非 ws(s)
    expect(relayChangeReady("  ", "wss://x")).toBe(false); // 空
  });
});

function render(extra: Partial<SettingsPanelProps> = {}): string {
  return renderToStaticMarkup(
    <ThemeProvider>
      <AccentProvider>
        <I18nProvider locale="zh-Hant">
          <SettingsPanel
            relayUrl="wss://x"
            notifications={false}
            onToggleNotifications={() => {}}
            onClose={() => {}}
            {...extra}
          />
        </I18nProvider>
      </AccentProvider>
    </ThemeProvider>,
  );
}

describe("SettingsPanel relay 區塊：更換中繼站（ADR-0066 H2）", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = {
      matchMedia: () => ({ matches: false }),
    };
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
    };
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("提供 onRelayChange 時顯示「更換」鈕", () => {
    expect(render({ onRelayChange: () => {} })).toContain('data-testid="relay-change"');
  });

  it("relayLocked（工作身分）：顯示鎖定說明、無更換鈕", () => {
    const out = render({ relayLocked: true });
    expect(out).toContain('data-testid="relay-locked"');
    expect(out).not.toContain('data-testid="relay-change"');
  });

  it("皆未提供（示範模式）：無更換鈕也無鎖定說明", () => {
    const out = render();
    expect(out).not.toContain('data-testid="relay-change"');
    expect(out).not.toContain('data-testid="relay-locked"');
  });

  it("排水中（ADR-0066 H3）：顯示舊站與「提前完成」；未排水則無此區塊", () => {
    const out = render({
      drain: { url: "wss://old.example", until: 4102444800000 },
      onDrainComplete: () => {},
    });
    expect(out).toContain('data-testid="relay-drain"');
    expect(out).toContain("wss://old.example");
    expect(render()).not.toContain('data-testid="relay-drain"');
  });
});
