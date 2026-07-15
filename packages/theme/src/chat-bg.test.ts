import { describe, expect, it } from "vitest";
import { BG_PRESETS, chatBgCss, chatBgStyle, presetCss } from "./chat-bg.js";

describe("對話背景 token（ADR-0077／0134）", () => {
  it("presetCss：有效 id 回 CSS、未知回 undefined", () => {
    expect(presetCss(BG_PRESETS[0]!.id)).toBe(BG_PRESETS[0]!.css);
    expect(presetCss("nope")).toBeUndefined();
  });

  it("chatBgCss（桌面簡寫字串）：preset→漸層、image→url()、未設/壞→undefined", () => {
    expect(chatBgCss(null)).toBeUndefined();
    expect(chatBgCss({ type: "preset", value: "sky" })).toBe(presetCss("sky"));
    expect(chatBgCss({ type: "preset", value: "nope" })).toBeUndefined();
    expect(chatBgCss({ type: "image", value: "data:img" })).toBe('center / cover no-repeat url("data:img")');
  });

  it("chatBgStyle（行動端樣式物件）：preset→backgroundImage 漸層、未設/壞→undefined", () => {
    expect(chatBgStyle(null)).toBeUndefined();
    expect(chatBgStyle({ type: "preset", value: "sky" })).toEqual({ backgroundImage: presetCss("sky") });
    expect(chatBgStyle({ type: "preset", value: "nope" })).toBeUndefined();
  });

  it("chatBgStyle image：url() ＋ cover ＋ 置中", () => {
    expect(chatBgStyle({ type: "image", value: "data:img" })).toEqual({
      backgroundImage: 'url("data:img")',
      backgroundSize: "cover",
      backgroundPosition: "center",
    });
  });
});
