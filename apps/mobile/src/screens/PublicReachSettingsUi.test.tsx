// 行動端公開聯絡方式設定區（ADR-0382）——與桌面 SettingsPanel.test〈公開聯絡方式〉刻意對齊，避免兩端漂移。
// 行動端純 SSR，驗的是顯示分流、「收不回」的警語是否在場、目前狀態是否標出來。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsScreen } from "./SettingsScreen.js";

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

const withReach = (contactable: boolean, publicName: boolean) =>
  renderToStaticMarkup(
    <SettingsScreen
      {...base}
      publicReach={{ contactable, publicName, onToggleContactable: () => {}, onTogglePublicName: () => {} }}
    />,
  );

describe("行動端公開聯絡方式（ADR-0382）", () => {
  it("沒提供就不顯示（企業身分、沒有 home）", () => {
    expect(renderToStaticMarkup(<SettingsScreen {...base} />)).not.toContain('data-testid="public-reach"');
  });

  it("兩個獨立開關；🔴「收不回」的警語不論開關狀態都在", () => {
    for (const [c, n] of [[false, false], [true, true]] as const) {
      const html = withReach(c, n);
      expect(html).toContain('data-testid="public-reach-irrevocable"');
      expect(html).toContain('data-testid="public-reach-contactable"');
      expect(html).toContain('data-testid="public-reach-name"');
    }
  });

  it("打開的那一個標 ✓", () => {
    const html = withReach(true, false);
    expect(html).toMatch(/data-testid="public-reach-contactable"[\s\S]*?✓/);
    expect(html).not.toMatch(/data-testid="public-reach-name"[^<]*<[^>]*>[^<]*✓/);
  });
});
