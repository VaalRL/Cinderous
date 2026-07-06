import { describe, expect, it } from "vitest";
import { buildRtcConfig } from "./rtc-config.js";

const turn: RTCIceServer[] = [{ urls: "turn:turn.acme.internal:3478", username: "u", credential: "p" }];

describe("buildRtcConfig（企業強制 TURN）", () => {
  it("無政策、無 TURN → undefined（維持原生預設）", () => {
    expect(buildRtcConfig(false, undefined)).toBeUndefined();
    expect(buildRtcConfig(false, [])).toBeUndefined();
  });

  it("forceTurn 開 → iceTransportPolicy relay（不揭露內網 IP）", () => {
    expect(buildRtcConfig(true, undefined)).toEqual({ iceTransportPolicy: "relay" });
  });

  it("forceTurn 開 + TURN → relay-only 且帶 TURN 伺服器", () => {
    expect(buildRtcConfig(true, turn)).toEqual({ iceTransportPolicy: "relay", iceServers: turn });
  });

  it("僅配置 TURN（未強制）→ 帶 iceServers、不限制 transport", () => {
    expect(buildRtcConfig(false, turn)).toEqual({ iceServers: turn });
  });
});
