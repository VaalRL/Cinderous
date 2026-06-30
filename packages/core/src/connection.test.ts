import { describe, expect, it } from "vitest";
import {
  FILE_TRANSPORT_ORDER,
  NUDGE_TRANSPORT_ORDER,
  selectTransport,
  type Reachability,
} from "./connection.js";

const reach = (over: Partial<Reachability>): Reachability => ({
  p2p: false,
  turn: false,
  relay: false,
  ...over,
});

describe("雙軌降級傳輸選擇（PRD §9）", () => {
  it("Nudge：可 P2P 時優先 P2P", () => {
    expect(selectTransport(NUDGE_TRANSPORT_ORDER, reach({ p2p: true, turn: true, relay: true }))).toBe("p2p");
  });

  it("Nudge：P2P 不可用退 TURN", () => {
    expect(selectTransport(NUDGE_TRANSPORT_ORDER, reach({ turn: true, relay: true }))).toBe("turn");
  });

  it("Nudge：P2P/TURN 皆不可用時退中繼（延遲送達）", () => {
    expect(selectTransport(NUDGE_TRANSPORT_ORDER, reach({ relay: true }))).toBe("relay");
  });

  it("檔案：只走 P2P/TURN，不經中繼", () => {
    expect(selectTransport(FILE_TRANSPORT_ORDER, reach({ turn: true }))).toBe("turn");
    expect(selectTransport(FILE_TRANSPORT_ORDER, reach({ relay: true }))).toBeUndefined();
  });

  it("全不可用回 undefined", () => {
    expect(selectTransport(NUDGE_TRANSPORT_ORDER, reach({}))).toBeUndefined();
  });
});
