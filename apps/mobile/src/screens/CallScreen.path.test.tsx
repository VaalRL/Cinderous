// 行動端通話連線路徑晶片（ADR-0344；行動端對齊）。
//
// 規格（圖示／文案／語義色）與桌面共吃 `@cinderous/theme` 的 `p2pPathChip`——
// 這組測試驗的是**行動端有把它接上**，以及顯示條件與桌面一致。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CallState } from "@cinderous/core";
import type { IcePath } from "@cinderous/engine";
import { P2P_PATH_COLORS } from "@cinderous/theme";
import { CallScreen } from "./CallScreen.js";

const base = {
  peerName: "Amy",
  media: "audio" as const,
  localStream: null,
  remoteStream: null,
  onAccept: () => {},
  onReject: () => {},
  onHangup: () => {},
  quality: "medium" as const,
  onQualityChange: () => {},
  localMedia: "audio" as const,
  remoteMedia: "audio" as const,
  canChangeMedia: false,
  onMediaChange: () => {},
  facing: null,
  canFlipCamera: false,
  onFlipCamera: () => {},
  locale: "zh-Hant" as const,
};

const render = (state: CallState, icePath?: IcePath) =>
  renderToStaticMarkup(<CallScreen {...base} state={state} {...(icePath !== undefined ? { icePath } : {})} />);

/**
 * `@cinderous/theme` 給的是 `#rrggbb`，但 react-native-web 輸出的是 `rgba(r,g,b,1.00)`。
 * 斷言要比對**畫面上真的出現的那個字串**，否則色票對了測試也是紅的。
 */
const rnwColor = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1.00)`;
};

describe("行動端通話路徑晶片（ADR-0344）", () => {
  it("通話中且為直連 → ⚡直連，上線綠", () => {
    const html = render("active", "direct");
    expect(html).toContain('data-testid="call-path-chip"');
    expect(html).toContain("直連");
    expect(html).toContain(rnwColor(P2P_PATH_COLORS.direct));
  });

  it("通話中且走 TURN → 🔁經中繼，琥珀（不是紅——連線是好的，只是較慢且計費）", () => {
    const html = render("active", "relay");
    expect(html).toContain("經中繼");
    expect(html).toContain(rnwColor(P2P_PATH_COLORS.relay));
  });

  it("通話中但路徑尚未測出 → 已連線（中性），不假裝是直連", () => {
    const html = render("active", "unknown");
    expect(html).toContain("已連線");
    expect(html).toContain(rnwColor(P2P_PATH_COLORS.unknown));
    expect(html).not.toContain(rnwColor(P2P_PATH_COLORS.direct));
  });

  it("未帶 icePath（舊呼叫端）→ 同樣退回中性", () => {
    expect(render("active")).toContain(rnwColor(P2P_PATH_COLORS.unknown));
  });

  it.each(["incoming", "outgoing", "connecting"] as CallState[])(
    "尚未接通（%s）不顯示晶片——接通前談路徑沒有意義",
    (state) => {
      expect(render(state, "relay")).not.toContain('data-testid="call-path-chip"');
    },
  );
});
