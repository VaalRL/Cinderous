import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeIdentity, scopedGet, scopedRemove, scopedSet } from "./identity-scoped.js";

describe("身分層覆寫、回退裝置層（ADR-0167）", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const setActive = (pk: string | null): void => {
    if (pk) store.set("nb.profiles", JSON.stringify({ profiles: [], active: pk }));
    else store.delete("nb.profiles");
  };

  it("activeIdentity：讀 nb.profiles.active；無/壞值回 null", () => {
    expect(activeIdentity()).toBeNull();
    setActive("pkA");
    expect(activeIdentity()).toBe("pkA");
    store.set("nb.profiles", "not json");
    expect(activeIdentity()).toBeNull();
  });

  it("讀：身分層覆寫優先，回退裝置層", () => {
    store.set("nb.accent", "#device"); // 裝置層
    setActive("pkA");
    expect(scopedGet("accent")).toBe("#device"); // pkA 尚無覆寫 → 回退裝置層
    store.set("nb.pkA.accent", "#idA"); // pkA 覆寫
    expect(scopedGet("accent")).toBe("#idA");
    setActive("pkB");
    expect(scopedGet("accent")).toBe("#device"); // pkB 無覆寫 → 仍回退裝置層（各身分獨立）
  });

  it("寫：有作用中身分 → 身分層；未登入 → 裝置層", () => {
    setActive("pkA");
    scopedSet("layout", "modern");
    expect(store.get("nb.pkA.layout")).toBe("modern");
    expect(store.has("nb.layout")).toBe(false); // 不動裝置層
    setActive(null);
    scopedSet("layout", "classic");
    expect(store.get("nb.layout")).toBe("classic"); // 未登入 → 裝置層
  });

  it("清除：有身分 → 只清身分層（回退裝置層）", () => {
    store.set("nb.accent", "#device");
    setActive("pkA");
    scopedSet("accent", "#idA");
    scopedRemove("accent");
    expect(store.has("nb.pkA.accent")).toBe(false);
    expect(scopedGet("accent")).toBe("#device"); // 回退裝置層
  });
});
