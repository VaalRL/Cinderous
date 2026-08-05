// 觀測老化（ADR-0324）。
import { describe, expect, it } from "vitest";
import { DEVICE_STALE_MS, isDeviceStale } from "./device-age.js";

const NOW = 1_800_000_000_000;

describe("推定離線的門檻（ADR-0324）", () => {
  it("剛看到 → 不算老化", () => {
    expect(isDeviceStale({ lastSeen: NOW }, NOW)).toBe(false);
  });

  it("剛好在門檻上 → 還不算（邊界含在窗內，同 FS grace 的寫法）", () => {
    expect(isDeviceStale({ lastSeen: NOW - DEVICE_STALE_MS }, NOW)).toBe(false);
  });

  it("超過一毫秒 → 算", () => {
    expect(isDeviceStale({ lastSeen: NOW - DEVICE_STALE_MS - 1 }, NOW)).toBe(true);
  });

  it("🔴 時鐘倒退時不得判為老化——寧可多等，也不要因為時鐘怪怪的就把自己的裝置踢出判斷", () => {
    expect(isDeviceStale({ lastSeen: NOW + 86_400_000 }, NOW)).toBe(false);
  });

  it("門檻是 90 天（與 OR-Set 墓碑同一個視野，不另立新標準）", () => {
    expect(DEVICE_STALE_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});
