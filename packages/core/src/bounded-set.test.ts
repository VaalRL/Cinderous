import { describe, expect, it } from "vitest";
import { BoundedSet } from "./bounded-set.js";

describe("BoundedSet（P1-4 有界去重）", () => {
  it("容量內如常運作", () => {
    const s = new BoundedSet<string>(4, 2);
    s.add("a");
    s.add("b");
    expect(s.has("a")).toBe(true);
    expect(s.size).toBe(2);
  });

  it("超過上限時逐出最舊、保留最近 keep 項", () => {
    const s = new BoundedSet<string>(4, 2);
    for (const v of ["a", "b", "c", "d", "e"]) s.add(v); // 第 5 個觸發修剪
    expect(s.size).toBe(2);
    expect(s.has("a")).toBe(false); // 最舊被逐出
    expect(s.has("b")).toBe(false);
    expect(s.has("d")).toBe(true); // 保留最近
    expect(s.has("e")).toBe(true);
  });

  it("重複 add 不重複計數", () => {
    const s = new BoundedSet<string>(4, 2);
    s.add("a");
    s.add("a");
    expect(s.size).toBe(1);
  });

  it("clear 清空", () => {
    const s = new BoundedSet<string>(4, 2);
    s.add("a");
    s.clear();
    expect(s.size).toBe(0);
    expect(s.has("a")).toBe(false);
  });
});
