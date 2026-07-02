import { describe, expect, it } from "vitest";
import { addRecent, isFavorite, refEquals, toggleFavorite, type StickerRef } from "./sticker-prefs.js";

const cat: StickerRef = { pack: "buddy", id: "cat" };
const star: StickerRef = { pack: "buddy", id: "star" };
const laugh: StickerRef = { pack: "mood", id: "laugh" };

describe("貼圖偏好純邏輯", () => {
  it("refEquals 比對 pack 與 id", () => {
    expect(refEquals(cat, { pack: "buddy", id: "cat" })).toBe(true);
    expect(refEquals(cat, star)).toBe(false);
    expect(refEquals(cat, { pack: "mood", id: "cat" })).toBe(false);
  });

  it("addRecent 移到最前並去重", () => {
    let list: StickerRef[] = [];
    list = addRecent(list, cat);
    list = addRecent(list, star);
    list = addRecent(list, cat); // 再次使用 cat → 移回最前、不重複
    expect(list).toEqual([cat, star]);
  });

  it("addRecent 超過上限會截斷（保留最新）", () => {
    let list: StickerRef[] = [];
    for (let i = 0; i < 5; i++) list = addRecent(list, { pack: "p", id: `s${i}` }, 3);
    expect(list.map((r) => r.id)).toEqual(["s4", "s3", "s2"]);
  });

  it("toggleFavorite 加入與移除", () => {
    let favs: StickerRef[] = [];
    favs = toggleFavorite(favs, laugh);
    expect(isFavorite(favs, laugh)).toBe(true);
    favs = toggleFavorite(favs, laugh);
    expect(isFavorite(favs, laugh)).toBe(false);
  });

  it("toggleFavorite 加入時置於最前，不影響其他項", () => {
    const favs = toggleFavorite([cat], star);
    expect(favs).toEqual([star, cat]);
  });
});
