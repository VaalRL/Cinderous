import { describe, expect, it } from "vitest";
import { p2pPathChip, P2P_PATH_COLORS, type P2pPathValue } from "./p2p-path.js";
import { STATUS_COLORS } from "./tokens.js";

describe("p2pPathChip 四態（ADR-0213／0344）", () => {
  it("未連線一律「直連未建立」，path 不影響", () => {
    for (const path of [undefined, "direct", "relay", "unknown"] as const) {
      expect(p2pPathChip(false, path)).toMatchObject({ tone: "none", label: "convo_p2pNone" });
    }
  });

  it("relay 優先於其他判定（那是使用者最需要知道的一態）", () => {
    expect(p2pPathChip(true, "relay")).toMatchObject({ tone: "relay", icon: "🔁", label: "convo_p2pRelay" });
  });

  it("direct → 綠燈", () => {
    expect(p2pPathChip(true, "direct")).toMatchObject({ tone: "direct", icon: "⚡", label: "convo_p2pDirect" });
  });

  it("unknown／未帶 → 中性，不樂觀升級為直連", () => {
    expect(p2pPathChip(true, "unknown")).toMatchObject({ tone: "unknown", label: "convo_p2pUnknown" });
    expect(p2pPathChip(true)).toMatchObject({ tone: "unknown", label: "convo_p2pUnknown" });
  });
});

describe("情境只換說明文字，不換標籤與配色", () => {
  it("同一判定給不同 tooltip", () => {
    expect(p2pPathChip(true, "relay", "convo").hint).toBe("convo_p2pRelayHint");
    expect(p2pPathChip(true, "relay", "call").hint).toBe("call_pathRelayHint");
  });

  it("tone／icon／label 與情境無關", () => {
    for (const path of ["direct", "relay", "unknown"] as P2pPathValue[]) {
      const convo = p2pPathChip(true, path, "convo");
      const call = p2pPathChip(true, path, "call");
      expect(call.tone).toBe(convo.tone);
      expect(call.icon).toBe(convo.icon);
      expect(call.label).toBe(convo.label);
      expect(call.hint).not.toBe(convo.hint);
    }
  });

  it("預設情境為對話", () => {
    expect(p2pPathChip(true, "direct").hint).toBe("convo_p2pDirectHint");
  });
});

describe("語義色與桌面 msn.css 對齊（改一邊沒改另一邊＝紅）", () => {
  it("direct 沿用上線綠——「一切正常」是同一套視覺語言", () => {
    expect(P2P_PATH_COLORS.direct).toBe(STATUS_COLORS.online);
    expect(P2P_PATH_COLORS.direct).toBe("#36c46b");
  });

  it("relay 是琥珀而**不是紅**——經中繼不是故障，只是較慢且計費", () => {
    expect(P2P_PATH_COLORS.relay).toBe("#e6a23c");
    expect(P2P_PATH_COLORS.relay).not.toBe(STATUS_COLORS.busy);
  });

  it("unknown 為中性灰藍，不暗示好壞", () => {
    expect(P2P_PATH_COLORS.unknown).toBe("#8ca0b4");
  });
});
