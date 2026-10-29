import { describe, expect, it } from "vitest";
import { connectionBannerText, nextRelayUnavailable } from "./index.js";

// 2026-10-30 00:00 UTC＝台灣 08:00
const RESET = Date.UTC(2026, 9, 30, 0, 0, 0);
const TPE = "Asia/Taipei";

describe("連線列文案（ADR-0395）", () => {
  it("🔴 額度用完：說原因與恢復時間（當地時間），不是只說「重連中」", () => {
    const u = { kind: "over-quota" as const, retryAt: 0, resetsAt: RESET };
    expect(connectionBannerText("zh-Hant", "offline", u, TPE)).toBe("已斷線：中繼站今天的額度用完了，約 08:00 恢復");
    expect(connectionBannerText("en", "offline", u, TPE)).toBe("Disconnected: the relay has used up today's quota. It should be back around 08:00.");
  });

  it("暫時不能用：說下一次重試的時間", () => {
    const u = { kind: "unavailable" as const, retryAt: Date.UTC(2026, 9, 29, 3, 5, 0) };
    expect(connectionBannerText("zh-Hant", "offline", u, TPE)).toBe("已斷線：中繼站暫時不能用，約 11:05 重試");
  });

  it("重試中（connecting）也繼續說原因；沒有原因時維持原本的文案", () => {
    const u = { kind: "over-quota" as const, retryAt: 0, resetsAt: RESET };
    expect(connectionBannerText("zh-Hant", "connecting", u, TPE)).toContain("額度用完");
    expect(connectionBannerText("zh-Hant", "offline", undefined)).toBe("已斷線，重連中…");
    expect(connectionBannerText("zh-Hant", "connecting", undefined)).toBe("連線中…");
  });

  it("原因留到真的上線或一般斷線才清掉：5 分鐘一次的重試不會讓它閃掉", () => {
    const u = { kind: "over-quota" as const, retryAt: 0, resetsAt: RESET };
    expect(nextRelayUnavailable(undefined, "offline", u)).toBe(u);
    expect(nextRelayUnavailable(u, "connecting", undefined)).toBe(u);
    expect(nextRelayUnavailable(u, "online", undefined)).toBeUndefined();
    expect(nextRelayUnavailable(u, "offline", undefined)).toBeUndefined();
  });
});
