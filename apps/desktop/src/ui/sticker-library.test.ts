import { contentHash } from "@nostr-buddy/core";
import { describe, expect, it } from "vitest";
import { formatCustomSticker, parseCustomSticker } from "../stickers.js";
import { addSticker, LIBRARY_MAX, removeSticker, type CustomSticker } from "./sticker-library.js";
import { STICKER_LABEL_MAX } from "./sticker-svg.js";

const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
const SVG_B = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';

describe("自製貼圖庫（ADR-0032）", () => {
  it("加入：id 為內容雜湊、置於最前", () => {
    const r = addSticker([], "圓圓", SVG_A);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sticker.id).toBe(contentHash(SVG_A));
      expect(r.list[0]).toBe(r.sticker);
    }
  });

  it("同內容去重：再次加入回傳既有貼圖、清單不變", () => {
    const first = addSticker([], "a", SVG_A);
    if (!first.ok) throw new Error("unexpected");
    const again = addSticker(first.list, "改名也一樣", SVG_A);
    expect(again.ok && again.list).toBe(first.list);
  });

  it("不合法 SVG 被拒收並附原因", () => {
    const r = addSticker([], "bad", "<svg><script>x</script></svg>");
    expect(r).toEqual({ ok: false, reason: "script" });
  });

  it("超過庫上限被拒", () => {
    let list: CustomSticker[] = [];
    for (let i = 0; i < LIBRARY_MAX; i++) {
      const r = addSticker(list, `s${i}`, `<svg><text>${i}</text></svg>`);
      if (!r.ok) throw new Error("unexpected");
      list = r.list;
    }
    expect(addSticker(list, "溢出", SVG_B)).toEqual({ ok: false, reason: "library-full" });
  });

  it("移除貼圖", () => {
    const r = addSticker([], "a", SVG_A);
    if (!r.ok) throw new Error("unexpected");
    expect(removeSticker(r.list, r.sticker.id)).toEqual([]);
  });

  it("空白標籤回退預設", () => {
    const r = addSticker([], "  ", SVG_A);
    expect(r.ok && r.sticker.label).toBe("貼圖");
  });
});

describe("自製貼圖線格式（v2）", () => {
  it("format/parse round-trip", () => {
    const content = formatCustomSticker({ label: "圓圓", svg: SVG_A });
    expect(content.startsWith("nb-sticker:v2:")).toBe(true);
    expect(parseCustomSticker(content)).toEqual({ label: "圓圓", svg: SVG_A });
  });

  it("非 v2 或壞 JSON 回傳 null", () => {
    expect(parseCustomSticker("嗨")).toBeNull();
    expect(parseCustomSticker("nb-sticker:v1:buddy/cat")).toBeNull();
    expect(parseCustomSticker("nb-sticker:v2:{oops")).toBeNull();
    expect(parseCustomSticker('nb-sticker:v2:{"label":1,"svg":"x"}')).toBeNull();
  });

  it("v2 內容大小落在 NIP-44 明文上限內（32KB SVG + JSON 額外負擔）", () => {
    const svg = `<svg>${"a".repeat(32 * 1024 - 11)}</svg>`;
    const content = formatCustomSticker({ label: "大", svg });
    expect(new TextEncoder().encode(content).length).toBeLessThan(65535);
  });
});

describe("標籤容量限制（ADR-0042）", () => {
  it("addSticker 夾住過長標籤至上限", () => {
    const r = addSticker([], "超長".repeat(50), SVG_A);
    expect(r.ok && r.sticker.label.length).toBe(STICKER_LABEL_MAX);
  });

  it("parseCustomSticker 收端夾住對端手工塞的超長標籤", () => {
    const evil = `nb-sticker:v2:${JSON.stringify({ label: "x".repeat(5000), svg: SVG_A })}`;
    const p = parseCustomSticker(evil);
    expect(p?.label.length).toBe(STICKER_LABEL_MAX);
    expect(p?.svg).toBe(SVG_A);
  });
});
