// 公司政策條列（ADR-0312，行動端設定頁）：政策不再只表現為「按鈕消失」。
// 清單與順序由 core 的 `policyNotices` 決定（桌面同一份）；這裡驗行動端的接線與文案。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsScreen } from "./SettingsScreen.js";

const base = {
  selfName: "我",
  selfNpub: "npub1abc",
  selfNsec: "nsec1abc",
  locale: "zh-Hant" as const,
  theme: "light" as const,
  onTheme: () => {},
  onLocale: () => {},
  accent: "blue",
  onAccent: () => {},
  relayUrl: "wss://x",
  invisible: false,
  onInvisible: () => {},
  onLogout: () => {},
};

describe("公司政策條列（ADR-0312）", () => {
  it("沒有政策：整段不顯示（一般個人身分看不到這一區）", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...base} />);
    expect(html).not.toContain('data-testid="org-policy"');
  });

  it("空政策物件同樣不顯示", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...base} orgPolicy={{}} />);
    expect(html).not.toContain('data-testid="org-policy"');
  });

  it("🔴 停用的功能逐條列出（使用者看得出是被公司關掉、不是壞了）", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...base} orgPolicy={{ disableFiles: true, disableCalls: true, disableStickers: true }} />,
    );
    expect(html).toContain('data-testid="org-policy"');
    expect(html).toContain('data-testid="org-policy-files"');
    expect(html).toContain('data-testid="org-policy-calls"');
    expect(html).toContain('data-testid="org-policy-stickers"');
    expect(html).toContain("已停用的功能");
    expect(html).toContain("無法在本機關閉"); // 明示不是本機開關
  });

  it("生效中的規則另立一段，數值有內插", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen {...base} orgPolicy={{ forceTurn: true, messageTtlDays: 30, relayFilesMaxMb: 8 }} />,
    );
    expect(html).toContain("生效中的規則");
    expect(html).toContain('data-testid="org-policy-forceTurn"');
    expect(html).toContain("30"); // 保留 30 天
    expect(html).toContain("8"); // 上限 8 MB
    expect(html).not.toContain("{days}"); // 內插確實發生
    expect(html).not.toContain("{mb}");
  });

  it("只有規則、沒有停用時不顯示「已停用的功能」標頭", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...base} orgPolicy={{ forceTurn: true }} />);
    expect(html).toContain('data-testid="org-policy"');
    expect(html).not.toContain("已停用的功能");
  });
});
