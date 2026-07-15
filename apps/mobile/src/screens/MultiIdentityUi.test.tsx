// 行動端多身分 UI 分流（ADR-0138）：設定裡的身分切換器、新增身分入口、登入的「返回」（新增模式）。
// 切換/新增的核心邏輯在 identities.test.ts；這裡驗 SSR 可斷言的顯示分流。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsScreen } from "./SettingsScreen.js";
import { NsecSignInScreen } from "./NsecSignInScreen.js";

const settingsBase = {
  selfName: "A",
  selfNpub: "npub1a",
  selfNsec: "nsec1a",
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

const ids = [
  { pubkey: "pk_a", name: "A", active: true },
  { pubkey: "pk_b", name: "B", active: false },
];

describe("設定：身分切換器（ADR-0138）", () => {
  it("提供 onAddIdentity → 列出各身分＋新增入口", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...settingsBase} onAddIdentity={() => {}} onSwitchIdentity={() => {}} identities={ids} />,
    );
    expect(html).toContain('data-testid="identity-pk_a"');
    expect(html).toContain('data-testid="identity-pk_b"');
    expect(html).toContain('data-testid="identity-add"');
    expect(html).toContain("使用中"); // 作用中身分有標記
  });

  it("未提供 onAddIdentity（示範模式）→ 無切換器", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} />);
    expect(html).not.toContain('data-testid="identity-add"');
    expect(html).not.toContain('data-testid="identity-pk_a"');
  });
});

describe("登入：新增身分模式的返回（ADR-0138）", () => {
  it("提供 onBack → 顯示返回", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} onBack={() => {}} locale="zh-Hant" />);
    expect(html).toContain('data-testid="signin-back"');
  });

  it("未提供 onBack（初次登入）→ 不顯示返回", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} locale="zh-Hant" />);
    expect(html).not.toContain('data-testid="signin-back"');
  });
});
