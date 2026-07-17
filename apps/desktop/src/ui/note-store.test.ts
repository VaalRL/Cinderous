import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadNote, saveNote } from "./note-store.js";

describe("便條本機儲存（ADR-0182）", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("每對話一張：依 id 命名空間存取，互不干擾", () => {
    saveNote("p1", "買牛奶\n12*8");
    saveNote("p2", "另一個對話的便條");
    expect(loadNote("p1")).toBe("買牛奶\n12*8");
    expect(loadNote("p2")).toBe("另一個對話的便條");
    expect(loadNote("p3")).toBe(""); // 未寫過＝空
  });

  it("空字串＝清除（不留空鍵）", () => {
    saveNote("p1", "暫存");
    saveNote("p1", "");
    expect(loadNote("p1")).toBe("");
    expect(localStorage.getItem("nb.note.p1")).toBeNull(); // 鍵已移除
  });

  it("無 localStorage（SSR）安全：load 回空、save 不丟例外", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadNote("p1")).toBe("");
    expect(() => saveNote("p1", "x")).not.toThrow();
  });
});
