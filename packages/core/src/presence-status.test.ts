import { describe, expect, it } from "vitest";
import { jitter } from "./heartbeat.js";
import { decodePresence, encodePresence } from "./presence-status.js";

describe("彙整在線狀態（F5 心跳合併）", () => {
  it("encode/decode round-trip（含 now-playing）", () => {
    const p = { s: "away" as const, m: "開會中", np: "Daft Punk - Digital Love" };
    expect(decodePresence(encodePresence(p))).toEqual(p);
  });

  it("缺 np 欄位時退回空字串", () => {
    expect(decodePresence(JSON.stringify({ s: "online", m: "hi" }))).toEqual({ s: "online", m: "hi", np: "" });
  });

  it("非法內容視為純文字狀態訊息", () => {
    expect(decodePresence("純文字")).toEqual({ s: "online", m: "純文字", np: "" });
    expect(decodePresence(JSON.stringify({ s: "bogus" }))).toEqual({ s: "online", m: JSON.stringify({ s: "bogus" }), np: "" });
  });
});

describe("心跳抖動 jitter（F5）", () => {
  it("落在 base ± ratio 範圍內，且不低於 base/2", () => {
    const base = 30_000;
    for (const r of [0, 0.5, 1, 0.999, 0.001]) {
      const d = jitter(base, 0.2, () => r);
      expect(d).toBeGreaterThanOrEqual(base / 2);
      expect(d).toBeGreaterThanOrEqual(base * 0.8 - 1);
      expect(d).toBeLessThanOrEqual(base * 1.2 + 1);
    }
  });

  it("rand=0.5 時無偏移（回傳 base）", () => {
    expect(jitter(30_000, 0.2, () => 0.5)).toBe(30_000);
  });
});
