import { describe, expect, it } from "vitest";
import {
  formatSticker,
  parseSticker,
  resolveSticker,
  STICKER_PACK_META,
  STICKER_PACK_ORDER,
  STICKER_PACKS,
  stickerSvg,
} from "./stickers.js";

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

  it("每個 metadata 包都存在、封面可解析（#2）", () => {
    for (const pack of STICKER_PACK_ORDER) {
      const meta = STICKER_PACK_META[pack]!;
      expect(STICKER_PACKS[pack], pack).toBeDefined();
      expect(resolveSticker(pack, meta.cover), `${pack} cover`).toBeDefined();
    }
  });

  it("動態包 motion 為宣告式 CSS 動畫且尊重 prefers-reduced-motion（#3/ADR-0031）", () => {
    const motion = STICKER_PACKS.motion;
    expect(motion).toBeDefined();
    for (const [id, s] of Object.entries(motion!)) {
      expect(s.svg.startsWith("<svg"), id).toBe(true);
      expect(s.svg.includes("@keyframes"), `${id} 應含動畫`).toBe(true);
      expect(s.svg.includes("prefers-reduced-motion"), `${id} 應含減少動態保護`).toBe(true);
      // 不得夾帶腳本（<img> 本已停用 JS，但仍為原創資產把關）
      expect(s.svg.includes("<script"), `${id} 不應含 script`).toBe(false);
    }
  });
});
