import { describe, expect, it } from "vitest";
import { capabilityGapText } from "./index.js";

const none = { required: [], devices: [], selfMissing: [] };

describe("裝置能力缺口的提示（ADR-0397）", () => {
  it("沒有缺口：不顯示", () => {
    expect(capabilityGapText("zh-Hant", none)).toBeUndefined();
  });

  it("🔴 未回報的舊裝置：指名是哪一台、說要更新", () => {
    const gap = { required: ["ek-pq-v1"], devices: [{ pk: "ab", label: "舊手機", reported: false, missing: ["ek-pq-v1"] }], selfMissing: [] };
    expect(capabilityGapText("zh-Hant", gap)).toBe("有裝置可能收不到訊息：「舊手機」沒有回報版本，可能還是舊版。請把它更新到最新版。");
    expect(capabilityGapText("en", gap)).toBe('A device may miss messages: "舊手機" has not reported its version and may be out of date. Please update it to the latest version.');
  });

  it("回報了但缺能力：帶版號；沒有標籤時用裝置 id 前 8 碼", () => {
    const gap = { required: ["ek-pq-v1"], devices: [{ id: "0011223344556677", ver: "0.0.17", reported: true, missing: ["ek-pq-v1"] }], selfMissing: [] };
    expect(capabilityGapText("zh-Hant", gap)).toBe("有裝置可能收不到訊息：「裝置 00112233（0.0.17）」不支援目前的加密方式。請把它更新到最新版。");
  });

  it("好幾台：說台數、指去設定頁", () => {
    const d = { reported: false, missing: ["ek-pq-v1"] };
    const gap = { required: ["ek-pq-v1"], devices: [{ ...d, label: "A" }, { ...d, label: "B" }], selfMissing: [] };
    expect(capabilityGapText("zh-Hant", gap)).toBe("有 2 台裝置可能收不到訊息，請到「設定 → 裝置」查看並更新。");
  });

  it("本機跟不上優先：那是使用者正在看的這台", () => {
    const gap = { required: [], devices: [], selfMissing: ["ek-pq-v2"] };
    expect(capabilityGapText("zh-Hant", gap)).toBe("這台裝置的版本太舊，可能收不到訊息。請更新到最新版。");
  });

  it("🔴 不宣稱「量子安全」（ADR-0306 文案紅線）", () => {
    const gap = { required: ["ek-pq-v1"], devices: [{ label: "A", reported: false, missing: ["ek-pq-v1"] }], selfMissing: ["x"] };
    for (const loc of ["zh-Hant", "en"]) {
      const all = [capabilityGapText(loc, gap), capabilityGapText(loc, { ...gap, selfMissing: [] })].join(" ");
      expect(all).not.toMatch(/量子|quantum/i);
    }
  });
});
