import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BG_PRESETS,
  chatBgCss,
  getAvatar,
  getChatBg,
  getConvoSize,
  presetCss,
  removeAvatar,
  removeChatBg,
  setAvatar,
  setChatBg,
  setConvoSize,
} from "./personalize.js";

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

describe("本地個人化儲存（ADR-0077）", () => {
  it("對話框尺寸 round-trip、四捨五入、無值回 null", () => {
    expect(getConvoSize()).toBeNull();
    setConvoSize({ w: 520.6, h: 480.2 });
    expect(getConvoSize()).toEqual({ w: 521, h: 480 });
  });

  it("頭像 set/get/remove、以 pubkey 隔離", () => {
    expect(getAvatar("pkA")).toBeNull();
    setAvatar("pkA", "data:image/jpeg;base64,AAA");
    setAvatar("pkB", "data:image/jpeg;base64,BBB");
    expect(getAvatar("pkA")).toBe("data:image/jpeg;base64,AAA");
    expect(getAvatar("pkB")).toBe("data:image/jpeg;base64,BBB"); // 不同 pubkey 不互覆蓋
    removeAvatar("pkA");
    expect(getAvatar("pkA")).toBeNull();
    expect(getAvatar("pkB")).toBe("data:image/jpeg;base64,BBB");
  });

  it("背景 preset/image round-trip、以對話隔離、清除", () => {
    expect(getChatBg("c1")).toBeNull();
    setChatBg("c1", { type: "preset", value: "sky" });
    setChatBg("c2", { type: "image", value: "data:img" });
    expect(getChatBg("c1")).toEqual({ type: "preset", value: "sky" });
    expect(getChatBg("c2")).toEqual({ type: "image", value: "data:img" });
    removeChatBg("c1");
    expect(getChatBg("c1")).toBeNull();
    expect(getChatBg("c2")).toEqual({ type: "image", value: "data:img" });
  });

  it("壞值安全回 null（不丟例外）", () => {
    localStorage.setItem("nb.chatbg.bad", "{not json");
    localStorage.setItem("nb.convoSize", "{not json");
    expect(getChatBg("bad")).toBeNull();
    expect(getConvoSize()).toBeNull();
  });

  it("presetCss：有效 id 回 CSS、未知回 undefined", () => {
    expect(presetCss(BG_PRESETS[0]!.id)).toBe(BG_PRESETS[0]!.css);
    expect(presetCss("nope")).toBeUndefined();
  });

  it("chatBgCss：preset→CSS、image→url()、未設/壞 preset→undefined", () => {
    expect(chatBgCss(null)).toBeUndefined();
    expect(chatBgCss({ type: "preset", value: "sky" })).toBe(presetCss("sky"));
    expect(chatBgCss({ type: "preset", value: "nope" })).toBeUndefined();
    expect(chatBgCss({ type: "image", value: "data:img" })).toContain('url("data:img")');
  });
});
