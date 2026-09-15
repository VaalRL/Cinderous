// 對話標頭的連線路徑晶片（ADR-0213／0344；行動端對齊）。
//
// 桌面自 ADR-0213 就有這個晶片，行動端當時列為「另案對齊」。ADR-0344 加上路徑判定後
// 一併補上——規格（圖示／文案／語義色）與桌面共吃 `@cinderous/theme`。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IcePath } from "@cinderous/engine";
import { P2P_PATH_COLORS } from "@cinderous/theme";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "小明",
  messages: [],
  onSend: () => {},
  onBack: () => {},
};

const render = (extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(<ConversationScreen {...base} locale="zh-Hant" {...extra} />);

/** RNW 輸出的是 `rgba(r,g,b,1.00)`，不是 theme 給的 `#rrggbb`。 */
const rnwColor = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1.00)`;
};

describe("對話標頭連線路徑晶片（ADR-0213／0344）", () => {
  it("已連線且為直連 → ⚡直連（上線綠）", () => {
    const html = render({ p2pConnected: true, p2pPath: "direct" satisfies IcePath });
    expect(html).toContain('data-testid="convo-p2p-chip"');
    expect(html).toContain("直連");
    expect(html).toContain(rnwColor(P2P_PATH_COLORS.direct));
  });

  it("已連線但走 TURN → 🔁經中繼（琥珀），說明點出「大檔請斟酌」", () => {
    const html = render({ p2pConnected: true, p2pPath: "relay" satisfies IcePath });
    expect(html).toContain("經中繼");
    expect(html).toContain(rnwColor(P2P_PATH_COLORS.relay));
    // 對話情境的說明談的是檔案，不是通話延遲（aria-label 帶 tooltip 文案）。
    expect(html).toContain("大檔");
  });

  it("已連線但路徑尚未測出 → 🔗已連線（中性），不假裝是直連", () => {
    const html = render({ p2pConnected: true, p2pPath: "unknown" satisfies IcePath });
    expect(html).toContain("已連線");
    expect(html).toContain(rnwColor(P2P_PATH_COLORS.unknown));
    expect(html).not.toContain(rnwColor(P2P_PATH_COLORS.direct));
  });

  it("已連線但未帶 path（舊呼叫端）→ 退回中性，不樂觀當成直連", () => {
    expect(render({ p2pConnected: true })).toContain(rnwColor(P2P_PATH_COLORS.unknown));
  });

  it("未建立直連 → ⚪直連未建立", () => {
    const html = render({ p2pConnected: false });
    expect(html).toContain('data-testid="convo-p2p-chip"');
    expect(html).toContain("直連未建立");
  });

  it("未連線時即使帶了 path 也忽略（沒連上就沒有路徑可言）", () => {
    const html = render({ p2pConnected: false, p2pPath: "relay" satisfies IcePath });
    expect(html).toContain("直連未建立");
    expect(html).not.toContain(rnwColor(P2P_PATH_COLORS.relay));
  });

  it("未提供 p2pConnected（群組／離線，呼叫端不傳）→ 不顯示晶片", () => {
    expect(render()).not.toContain('data-testid="convo-p2p-chip"');
  });

  it("與企業頭銜 chip 並存時兩個都在（相鄰但語義不同：頭銜是身分、這是狀態）", () => {
    const html = render({ title: "工程師", p2pConnected: true, p2pPath: "direct" satisfies IcePath });
    expect(html).toContain('data-testid="convo-title-chip"');
    expect(html).toContain('data-testid="convo-p2p-chip"');
  });
});
