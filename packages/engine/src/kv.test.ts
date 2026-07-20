import { afterEach, describe, expect, it } from "vitest";
import { getKv, setKvBackend } from "./kv.js";

describe("kv 可換式同步鍵值儲存（ADR-0219）", () => {
  afterEach(() => {
    setKvBackend(null); // 還原預設，避免跨測試洩漏
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("預設走 localStorage 全域：不可用時優雅（getItem 回 null、setItem 不拋）", () => {
    // node 無 localStorage 全域 → 各方法優雅失敗
    expect(getKv().getItem("k")).toBeNull();
    expect(() => getKv().setItem("k", "v")).not.toThrow();
  });

  it("有 localStorage stub → 讀寫刪如常", () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    getKv().setItem("a", "1");
    expect(getKv().getItem("a")).toBe("1");
    getKv().removeItem("a");
    expect(getKv().getItem("a")).toBeNull();
  });

  it("setKvBackend 注入自訂基質（RN MMKV 情境）", () => {
    const mem: Record<string, string> = {};
    setKvBackend({
      getItem: (k) => mem[k] ?? null,
      setItem: (k, v) => {
        mem[k] = v;
      },
      removeItem: (k) => {
        delete mem[k];
      },
    });
    getKv().setItem("x", "y");
    expect(getKv().getItem("x")).toBe("y");
    expect(mem.x).toBe("y");
  });

  it("setKvBackend(null) 還原預設 localStorage 基質", () => {
    setKvBackend({ getItem: () => "custom", setItem: () => {}, removeItem: () => {} });
    expect(getKv().getItem("k")).toBe("custom");
    setKvBackend(null);
    expect(getKv().getItem("k")).toBeNull(); // 還原後 node 無 localStorage → null
  });
});
