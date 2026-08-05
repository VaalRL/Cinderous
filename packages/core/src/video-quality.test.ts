import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_QUALITY,
  VIDEO_QUALITIES,
  isVideoQuality,
  videoConstraints,
  videoProfile,
  type VideoQuality,
} from "./video-quality.js";

describe("視訊畫質檔位（ADR-0337）", () => {
  it("三檔，且預設為 medium 而非 high", () => {
    expect(VIDEO_QUALITIES).toEqual(["low", "medium", "high"]);
    // 預設值服務的是行動數據上的中階手機（ADR-0337 §2）。
    expect(DEFAULT_VIDEO_QUALITY).toBe("medium");
  });

  it("解析度、fps、位元率三者都隨檔位嚴格遞增", () => {
    const profiles = VIDEO_QUALITIES.map(videoProfile);
    for (let i = 1; i < profiles.length; i++) {
      const prev = profiles[i - 1]!;
      const cur = profiles[i]!;
      expect(cur.width).toBeGreaterThan(prev.width);
      expect(cur.height).toBeGreaterThan(prev.height);
      expect(cur.frameRate).toBeGreaterThan(prev.frameRate);
      expect(cur.maxBitrate).toBeGreaterThan(prev.maxBitrate);
    }
  });

  it("low 檔的頻寬要真的省——不到 high 的六分之一", () => {
    // 否則「省流量」只是安慰劑：使用者調了卻沒有實際差別（ADR-0337 §2）。
    expect(videoProfile("low").maxBitrate * 6).toBeLessThan(videoProfile("high").maxBitrate);
  });

  it("每檔都在合理範圍（不會有 0 或荒謬的上限）", () => {
    for (const q of VIDEO_QUALITIES) {
      const p = videoProfile(q);
      expect(p.maxBitrate).toBeGreaterThanOrEqual(100_000);
      expect(p.maxBitrate).toBeLessThanOrEqual(3_000_000);
      expect(p.frameRate).toBeGreaterThanOrEqual(10);
      expect(p.frameRate).toBeLessThanOrEqual(60);
    }
  });

  it("videoConstraints 產出 getUserMedia／applyConstraints 可用的 ideal 約束", () => {
    const c = videoConstraints("high");
    // 用 ideal 而非 exact：相機不支援時要退而求其次，不是整個取媒體失敗。
    expect(c).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
  });

  it("isVideoQuality 擋掉持久化來的髒值", () => {
    // 偏好存在 localStorage，使用者或舊版可能塞進任何東西。
    expect(isVideoQuality("low")).toBe(true);
    expect(isVideoQuality("medium")).toBe(true);
    expect(isVideoQuality("high")).toBe(true);
    expect(isVideoQuality("ultra")).toBe(false);
    expect(isVideoQuality("")).toBe(false);
    expect(isVideoQuality(null)).toBe(false);
    expect(isVideoQuality(undefined)).toBe(false);
    expect(isVideoQuality(720)).toBe(false);
  });

  it("isVideoQuality 收窄型別，可直接餵回 videoProfile", () => {
    const raw: unknown = "low";
    if (isVideoQuality(raw)) {
      const q: VideoQuality = raw;
      expect(videoProfile(q).maxBitrate).toBe(150_000);
    } else {
      throw new Error("應收窄成功");
    }
  });
});
