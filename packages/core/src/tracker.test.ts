import { describe, expect, it } from "vitest";
import { LatestPerKey } from "./tracker.js";

describe("LatestPerKey", () => {
  it("保留最新時間戳的值，忽略亂序較舊", () => {
    const t = new LatestPerKey<string>();
    t.observe("k", 100, "a");
    t.observe("k", 200, "b");
    t.observe("k", 150, "stale"); // 較舊，忽略
    expect(t.at("k")).toBe(200);
    expect(t.value("k")).toBe("b");
  });

  it("未知 key 回 undefined", () => {
    const t = new LatestPerKey<string>();
    expect(t.at("x")).toBeUndefined();
    expect(t.value("x")).toBeUndefined();
  });

  it("可作為純時間戳追蹤（value 為 undefined）", () => {
    const t = new LatestPerKey();
    t.observe("k", 1000, undefined);
    expect(t.at("k")).toBe(1000);
  });
});
