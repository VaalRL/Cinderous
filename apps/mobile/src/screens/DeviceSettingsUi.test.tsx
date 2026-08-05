// 行動端「我的裝置」區（ADR-0322 S3／ADR-0323）——與桌面 SettingsPanel.test 的斷言刻意對齊，
// 避免兩端漂移。
//
// 行動端目前純 SSR，互動不跑；這裡驗的是**入口與揭露是否在場**：
//   - 移除入口在不在（過去只有桌面有 ⇒「手機丟了要開電腦才撤銷得掉」，而手機正是最常掉的那台）；
//   - 金鑰等級有沒有照實說（ADR-0297 §6 紅線）。
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

const dev = (id: string, source: string, extra: Record<string, unknown> = {}) => ({
  id,
  firstSeen: 1_700_000_000_000,
  source,
  inDirectory: true,
  ...extra,
});

const render = (p: Record<string, unknown>) => renderToStaticMarkup(<SettingsScreen {...base} {...p} />);

describe("行動端裝置移除入口（ADR-0323）", () => {
  const devices = [dev("aaaa1111bbbb2222", "local"), dev("cccc3333dddd4444", "snapshot")];

  it("🔴 有 onRemoveDevice → 別台顯示移除鈕（手機不必開電腦才撤銷得掉）", () => {
    const html = render({ devices, onRemoveDevice: () => {} });
    expect(html).toContain('data-testid="device-remove-cccc3333dddd4444"');
  });

  it("🔴 這台自己不給移除鈕——移除自己只會把這台鎖在門外", () => {
    const html = render({ devices, onRemoveDevice: () => {} });
    expect(html).not.toContain('data-testid="device-remove-aaaa1111bbbb2222"');
  });

  it("已撤銷的不再給移除鈕，但要看得出它已被撤銷", () => {
    const html = render({
      devices: [dev("aaaa1111bbbb2222", "local"), dev("eeee5555ffff6666", "snapshot", { revoked: true })],
      onRemoveDevice: () => {},
    });
    expect(html).not.toContain('data-testid="device-remove-eeee5555ffff6666"');
    expect(html).toContain("已移除");
  });

  it("未提供 onRemoveDevice → 不顯示（沿用既有的『未提供則不顯示』慣例）", () => {
    expect(render({ devices })).not.toContain("device-remove-");
  });
});

describe("久未出現與從清單移除（ADR-0324）", () => {
  const gone = dev("cccc3333dddd4444", "snapshot", { inDirectory: false, stale: true });

  it("🔴 久未出現要標出來——它已經被排除在撤銷判定之外，那會影響行為", () => {
    expect(render({ devices: [dev("aaaa1111bbbb2222", "local"), gone] })).toContain("久未出現");
  });

  it("🔴 不在目錄內的不給撤銷鈕——它沒有目錄項，按下去是靜默什麼都不做", () => {
    const html = render({ devices: [dev("aaaa1111bbbb2222", "local"), gone], onRemoveDevice: () => {} });
    expect(html).not.toContain('data-testid="device-remove-cccc3333dddd4444"');
  });

  it("改給「從清單移除」", () => {
    const html = render({ devices: [dev("aaaa1111bbbb2222", "local"), gone], onForgetDevice: () => {} });
    expect(html).toContain("從清單移除");
  });

  it("在目錄內的不給「從清單移除」——那只會把它藏起來，授權原封不動", () => {
    const inDir = dev("cccc3333dddd4444", "snapshot", { inDirectory: true });
    const html = render({ devices: [dev("aaaa1111bbbb2222", "local"), inDir], onForgetDevice: () => {} });
    expect(html).not.toContain("從清單移除");
  });
});

describe("行動端金鑰保護等級（ADR-0297 §6 紅線）", () => {
  const devices = [dev("aaaa1111bbbb2222", "local")];

  it("🔴 明文時要說出後果：移除裝置擋不住拿到磁碟副本的人", () => {
    const html = render({ devices, deviceKeyTier: "plaintext" });
    expect(html).toContain('data-testid="key-tier-plaintext"');
    expect(html).toContain("「移除裝置」擋不住他");
  });

  it("🔴 只有軟體 Keystore 的機型講 encrypted，不得混進 keystore（0297 §6 的重點）", () => {
    const html = render({ devices, deviceKeyTier: "encrypted" });
    expect(html).toContain('data-testid="key-tier-encrypted"');
    expect(html).not.toContain('data-testid="key-tier-keystore"');
  });

  it("🔴 金鑰庫打不開時要說「這台不會出現在裝置清單」", () => {
    const html = render({ devices, deviceKeyTier: "ephemeral" });
    expect(html).toContain('data-testid="key-tier-ephemeral"');
    expect(html).toContain("這台不會出現在你的裝置清單裡");
  });

  it("🔴 由明文遷入者要加那句告白（刪副本收不回已被拿走的東西）", () => {
    const html = render({ devices, deviceKeyTier: "keystore", deviceKeyEverPlaintext: true });
    expect(html).toContain('data-testid="key-tier-was-plain"');
  });

  it("原生於金鑰庫者不掛那句（沒發生過的事不要嚇人）", () => {
    expect(render({ devices, deviceKeyTier: "keystore" })).not.toContain("key-tier-was-plain");
  });
});
