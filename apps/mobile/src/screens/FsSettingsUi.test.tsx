// 行動端前向保密設定區（ADR-0306 D1）——與桌面 SettingsPanel.test 的三條斷言**刻意對齊**，
// 避免兩端漂移：未經審計的揭露必須「明示」，且啟用前後都要在。
//
// 行動端目前純 SSR，互動不跑；這裡驗的是**顯示分流與揭露是否在場**，
// 那正好就是 ADR-0306 D1 的驗收條件（揭露不在場＝這條路退回成遮羞布）。
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

const withFs = (enabled: boolean) =>
  renderToStaticMarkup(<SettingsScreen {...base} fs={{ enabled, onEnable: () => {}, onRotate: () => {} }} />);

describe("行動端前向保密設定區（ADR-0306 D1）", () => {
  it("未提供 fs → 不顯示區塊（沿用既有的『未提供則不顯示』慣例）", () => {
    const html = renderToStaticMarkup(<SettingsScreen {...base} />);
    expect(html).not.toContain('data-testid="fs-enable"');
    expect(html).not.toContain('data-testid="fs-unaudited"');
  });

  it("未啟用 → 顯示啟用鈕、不顯示換鑰鈕", () => {
    const html = withFs(false);
    expect(html).toContain('data-testid="fs-enable"');
    expect(html).not.toContain('data-testid="fs-rotate"');
  });

  it("已啟用 → 顯示換鑰鈕、不顯示啟用鈕", () => {
    const html = withFs(true);
    expect(html).toContain('data-testid="fs-rotate"');
    expect(html).not.toContain('data-testid="fs-enable"');
  });

  it("🔴 未啟用時就必須看得到「尚未經外部審計」，不能等按下去才說", () => {
    expect(withFs(false)).toContain('data-testid="fs-unaudited"');
  });

  it("🔴 已啟用後那句揭露不得消失（啟用不是把警語關掉的開關）", () => {
    expect(withFs(true)).toContain('data-testid="fs-unaudited"');
  });

  it("🔴 標題必須帶「實驗性」，不得只寫「進階」", () => {
    const html = withFs(false);
    expect(html).toContain("實驗性");
    expect(html).not.toContain("前向保密（進階）");
  });
});

describe("FS 自動輪替與停用的 UI（ADR-0313／0314）", () => {
  type FsProp = NonNullable<Parameters<typeof SettingsScreen>[0]["fs"]>;
  const render = (fs: FsProp): string => renderToStaticMarkup(<SettingsScreen {...base} fs={fs} />);

  it("已啟用時說明「每 7 天自動更換」——保護來自自動，不是那顆手動鈕", () => {
    const html = render({ enabled: true, onEnable: () => {}, onRotate: () => {} });
    expect(html).toContain('data-testid="fs-auto-rotate"');
    expect(html).toContain("7");
  });

  it("🔴 提供 onDisable 時顯示停用鈕——啟用確認說了「可以隨時關閉」", () => {
    const html = render({ enabled: true, onEnable: () => {}, onRotate: () => {}, onDisable: () => {} });
    expect(html).toContain('data-testid="fs-disable"');
  });

  it("未啟用時不顯示停用鈕（沒有可停用的東西）", () => {
    const html = render({ enabled: false, onEnable: () => {}, onRotate: () => {}, onDisable: () => {} });
    expect(html).not.toContain('data-testid="fs-disable"');
    expect(html).not.toContain('data-testid="fs-auto-rotate"');
  });
});

describe("解封失敗的可見性（ADR-0316）", () => {
  type FsProp = NonNullable<Parameters<typeof SettingsScreen>[0]["fs"]>;
  const render = (fs: FsProp): string => renderToStaticMarkup(<SettingsScreen {...base} fs={fs} />);
  const enabled = { enabled: true, onEnable: () => {}, onRotate: () => {} };

  it("沒發生過就不顯示（不用一段警告文字佔版面）", () => {
    expect(render(enabled)).not.toContain('data-testid="fs-undecryptable"');
    expect(render({ ...enabled, undecryptable: { count: 0, lastAt: 0 } })).not.toContain('data-testid="fs-undecryptable"');
  });

  it("🔴 發生過就要看得見——這正是 ADR-0315 第 1 步要解的「靜默消失」", () => {
    const html = render({ ...enabled, undecryptable: { count: 3, lastAt: Date.now() } });
    expect(html).toContain('data-testid="fs-undecryptable"');
    expect(html).toContain("3");
  });

  it("🔴 文案不得把「可能」寫成「是」——無法分辨要講出來", () => {
    const html = render({ ...enabled, undecryptable: { count: 1, lastAt: Date.now() } });
    expect(html).toContain("可能");
    expect(html).toContain("無法分辨");
    expect(html).toContain("查不出是誰送的"); // NIP-59 的必然限制，別讓使用者以為我們藏著
  });
});
