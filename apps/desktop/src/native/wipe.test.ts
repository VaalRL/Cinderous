// clearBrowserNamespace（ADR-0202）：只清該身分 namespace 的 localStorage 鍵，
// 不誤刪其他身分或全域鍵（nb.profiles 等）。純函式對真 localStorage 替身的行為驗證。

import { beforeEach, describe, expect, it } from "vitest";
import { clearBrowserNamespace } from "./wipe.js";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return backing.size;
    },
    key: (i: number) => [...backing.keys()][i] ?? null,
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

describe("clearBrowserNamespace（ADR-0202 移除單一身分）", () => {
  it("只清 nb.<ns>.* ，不動其他身分與全域鍵", () => {
    localStorage.setItem("nb.aaa.contacts", "x");
    localStorage.setItem("nb.aaa.msg.bob", "x");
    localStorage.setItem("nb.bbb.contacts", "keep"); // 另一身分
    localStorage.setItem("nb.profiles", "keep"); // 全域登錄
    localStorage.setItem("nb.relayUrl", "keep"); // 全域

    clearBrowserNamespace("aaa");

    expect(localStorage.getItem("nb.aaa.contacts")).toBeNull();
    expect(localStorage.getItem("nb.aaa.msg.bob")).toBeNull();
    expect(localStorage.getItem("nb.bbb.contacts")).toBe("keep");
    expect(localStorage.getItem("nb.profiles")).toBe("keep");
    expect(localStorage.getItem("nb.relayUrl")).toBe("keep");
  });

  it("空 namespace（legacy）＝不動任何鍵（避免誤刪全域）", () => {
    localStorage.setItem("nb.profiles", "keep");
    localStorage.setItem("nb.contacts", "keep");
    clearBrowserNamespace("");
    expect(localStorage.getItem("nb.profiles")).toBe("keep");
    expect(localStorage.getItem("nb.contacts")).toBe("keep");
  });
});
