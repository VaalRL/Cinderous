// 身分世代守衛（ADR-0329）。
import { describe, expect, it } from "vitest";
import { makeEpochGuard } from "./identity-epoch.js";

describe("身分世代守衛（ADR-0329）", () => {
  it("同一個世代內：還是同一個身分", () => {
    const g = makeEpochGuard();
    const still = g.mark();
    expect(still()).toBe(true);
  });

  it("🔴 切過身分後落地：必須回 false——那份結果屬於上一個身分", () => {
    const g = makeEpochGuard();
    const still = g.mark();
    g.bump();
    expect(still()).toBe(false);
  });

  it("🔴 切走再切回來也算變了——中間那段時間的狀態已經被重設過", () => {
    const g = makeEpochGuard();
    const still = g.mark();
    g.bump();
    g.bump();
    expect(still()).toBe(false);
  });

  it("不同時間點記下的 mark 各自獨立", () => {
    const g = makeEpochGuard();
    const a = g.mark();
    g.bump();
    const b = g.mark();
    expect(a()).toBe(false);
    expect(b()).toBe(true);
  });
});
