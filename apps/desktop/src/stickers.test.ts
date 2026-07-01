import { describe, expect, it } from "vitest";
import { formatSticker, parseSticker, STICKER_PACKS, stickerSvg } from "./stickers.js";

describe("貼圖參照（Sticker，M7）", () => {
  it("format/parse round-trip", () => {
    const content = formatSticker("buddy", "cat");
    expect(content).toBe("nb-sticker:v1:buddy/cat");
    expect(parseSticker(content)).toEqual({ pack: "buddy", id: "cat" });
  });

  it("一般文字不視為貼圖", () => {
    expect(parseSticker("嗨，晚點聊")).toBeNull();
    expect(parseSticker("nb-sticker:v1:")).toBeNull();
    expect(parseSticker("nb-sticker:v1:buddy")).toBeNull();
    expect(parseSticker("nb-sticker:v1:buddy/")).toBeNull();
    expect(parseSticker("nb-sticker:v1:a/b/c")).toBeNull();
  });

  it("內建包每個貼圖都有可渲染的 SVG", () => {
    for (const [pack, items] of Object.entries(STICKER_PACKS)) {
      for (const id of Object.keys(items)) {
        const s = stickerSvg(pack, id);
        expect(s, `${pack}/${id}`).toBeDefined();
        expect(s!.startsWith("<svg")).toBe(true);
      }
    }
  });

  it("未知貼圖回傳 undefined", () => {
    expect(stickerSvg("buddy", "nope")).toBeUndefined();
    expect(stickerSvg("nope", "cat")).toBeUndefined();
  });
});
