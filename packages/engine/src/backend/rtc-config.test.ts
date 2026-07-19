import { describe, expect, it } from "vitest";
import { buildRtcConfig, DEFAULT_STUN } from "./rtc-config.js";

const turn: RTCIceServer[] = [{ urls: "turn:turn.acme.internal:3478", username: "u", credential: "p" }];
const stun = [...DEFAULT_STUN];

describe("buildRtcConfig（一般 STUN／企業強制 TURN，ADR-0210）", () => {
  it("一般模式、無 TURN → 帶預設 STUN（跨網路 P2P 才連得起來）", () => {
    expect(buildRtcConfig(false, undefined)).toEqual({ iceServers: stun });
    expect(buildRtcConfig(false, [])).toEqual({ iceServers: stun });
  });

  it("forceTurn 開 → iceTransportPolicy relay（不加 STUN、不揭露 IP）", () => {
    expect(buildRtcConfig(true, undefined)).toEqual({ iceTransportPolicy: "relay" });
  });

  it("forceTurn 開 + TURN → relay-only 且帶 TURN 伺服器（仍不加 STUN）", () => {
    expect(buildRtcConfig(true, turn)).toEqual({ iceTransportPolicy: "relay", iceServers: turn });
  });

  it("一般模式 + 配置 TURN → 預設 STUN ＋ TURN、不限制 transport", () => {
    expect(buildRtcConfig(false, turn)).toEqual({ iceServers: [...stun, ...turn] });
  });
});
