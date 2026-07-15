// 行動端本地個人化儲存（ADR-0134）：對話背景 round-trip、壞值回 null、清除。
// 與桌面同一鍵前綴（`nb.chatbg.<id>`）；node 環境無 localStorage → 用 Map shim。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChatBg, removeChatBg, setChatBg } from "./personalize.js";

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

describe("行動端對話背景儲存（ADR-0134）", () => {
  it("未設回 null；設 preset／image 後讀得回；清除後回 null", () => {
    expect(getChatBg("c1")).toBeNull();
    expect(setChatBg("c1", { type: "preset", value: "sky" })).toBe(true);
    expect(setChatBg("c2", { type: "image", value: "data:img" })).toBe(true);
    expect(getChatBg("c1")).toEqual({ type: "preset", value: "sky" });
    expect(getChatBg("c2")).toEqual({ type: "image", value: "data:img" });
    removeChatBg("c1");
    expect(getChatBg("c1")).toBeNull();
    expect(getChatBg("c2")).toEqual({ type: "image", value: "data:img" }); // 各對話獨立
  });

  it("壞值（非 JSON／缺欄位）回 null，不丟例外", () => {
    localStorage.setItem("nb.chatbg.bad", "{not json");
    expect(getChatBg("bad")).toBeNull();
    localStorage.setItem("nb.chatbg.bad2", JSON.stringify({ type: "preset" }));
    expect(getChatBg("bad2")).toBeNull();
  });
});
