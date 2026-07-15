// 行動端身分安全 UI 分流（ADR-0135/0070）：改密碼、備份碼、備份碼登入欄位的顯示條件。
// 互動（打字→產碼→複製）需 jsdom，行動端目前純 SSR；這裡驗 SSR 可斷言的**顯示分流**，
// 產碼/改密碼的核心邏輯在 auth-security.test.ts、@cinder/core 已測。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsScreen } from "./SettingsScreen.js";
import { NsecSignInScreen } from "./NsecSignInScreen.js";

const settingsBase = {
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

describe("設定：更改顯示名稱（ADR-0144）", () => {
  it("提供 onRename → 顯示改名欄（預填目前名稱）", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} onRename={() => {}} />);
    expect(html).toContain('data-testid="rename-input"');
    expect(html).toContain('data-testid="rename-apply"');
    expect(html).toContain(`value="${settingsBase.selfName}"`);
  });

  it("未提供 onRename → 無改名欄（顯示唯讀名稱）", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} />);
    expect(html).not.toContain('data-testid="rename-input"');
  });
});

describe("設定：改密碼分流（ADR-0135）", () => {
  it("提供 onChangePassword → 顯示改密碼表單", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} onChangePassword={() => true} />);
    expect(html).toContain('data-testid="pw-old"');
    expect(html).toContain('data-testid="pw-change"');
  });

  it("未提供（未記住身分）→ 不顯示改密碼表單", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} />);
    expect(html).not.toContain('data-testid="pw-old"');
  });
});

describe("設定：加密備份碼分流（ADR-0070）", () => {
  it("提供 onMakeBackupCode → 顯示產碼表單", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} onMakeBackupCode={() => "CODE"} />);
    expect(html).toContain('data-testid="backup-pw"');
    expect(html).toContain('data-testid="backup-make"');
  });

  it("尚未產碼 → 不顯示備份碼結果／複製鈕", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} onMakeBackupCode={() => "CODE"} />);
    expect(html).not.toContain('data-testid="backup-code"');
    expect(html).not.toContain('data-testid="backup-copy"');
  });

  it("未提供（示範模式無 relay）→ 不顯示備份碼區", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...settingsBase} />);
    expect(html).not.toContain('data-testid="backup-make"');
  });
});

describe("登入：貼 nsec 時不顯示備份密碼欄（ADR-0070）", () => {
  it("初始（空輸入）→ 無備份密碼欄", () => {
    const html = renderToStaticMarkup(<NsecSignInScreen onSignIn={() => {}} locale="zh-Hant" />);
    expect(html).not.toContain('data-testid="backup-password"');
  });
});
