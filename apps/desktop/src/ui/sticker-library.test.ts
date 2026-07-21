import { contentHash } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import { formatCustomSticker, parseCustomSticker } from "@cinderous/core";
import {
  addSticker,
  addTombstone,
  findByShortcode,
  LIBRARY_MAX,
  removeSticker,
  setShortcode,
  type CustomSticker,
} from "./sticker-library.js";
import { STICKER_LABEL_MAX } from "@cinderous/core";

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

  it("預設 kind 為 sticker", () => {
    const r = addSticker([], "a", SVG_A);
    expect(r.ok && r.sticker.kind).toBe("sticker");
  });
});

describe("統一資產：emoji 短碼（ADR-0220）", () => {
  it("帶短碼加入：kind 為 both、可依短碼查得", () => {
    const r = addSticker([], "派對", SVG_A, { shortcode: "party" });
    if (!r.ok) throw new Error("unexpected");
    expect(r.sticker.kind).toBe("both");
    expect(r.sticker.shortcode).toBe("party");
    expect(findByShortcode(r.list, "party")).toBe(r.sticker);
    expect(findByShortcode(r.list, "nope")).toBeUndefined();
  });

  it("不合法短碼被拒", () => {
    expect(addSticker([], "x", SVG_A, { shortcode: "has space" })).toEqual({ ok: false, reason: "bad-shortcode" });
  });

  it("短碼被別的資產佔用時被拒", () => {
    const first = addSticker([], "a", SVG_A, { shortcode: "party" });
    if (!first.ok) throw new Error("unexpected");
    expect(addSticker(first.list, "b", SVG_B, { shortcode: "party" })).toEqual({
      ok: false,
      reason: "shortcode-taken",
    });
  });

  it("setShortcode：指派給既有資產（kind→both）、唯一性檢查", () => {
    const base = addSticker([], "圓", SVG_A);
    if (!base.ok) throw new Error("unexpected");
    const r = setShortcode(base.list, base.sticker.id, "circle");
    if (!r.ok) throw new Error("unexpected");
    expect(r.sticker.shortcode).toBe("circle");
    expect(r.sticker.kind).toBe("both");
    expect(setShortcode(r.list, "no-such-id", "x")).toEqual({ ok: false, reason: "not-found" });
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

describe("ADR-0221 審查修正", () => {
  it("M2：短碼建立時正規化小寫、查詢大小寫不敏感", () => {
    const r = addSticker([], "派對", SVG_A, { shortcode: "Party" });
    if (!r.ok) throw new Error("unexpected");
    expect(r.sticker.shortcode).toBe("party"); // 存為小寫
    expect(findByShortcode(r.list, "PARTY")?.id).toBe(r.sticker.id); // 查詢不分大小寫
  });

  it("M1：addSticker 標記 mine（自建受 LRU 保護）", () => {
    const r = addSticker([], "圓", SVG_A);
    expect(r.ok && r.sticker.mine).toBe(true);
  });
});

describe("ADR-0222 raster 資產", () => {
  const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
  it("addSticker 收 raster（合法 GIF data URI）並帶 format", () => {
    const r = addSticker([], "跳舞", gif, { shortcode: "dance", format: "raster" });
    if (!r.ok) throw new Error("unexpected");
    expect(r.sticker.format).toBe("raster");
    expect(r.sticker.svg).toBe(gif);
  });
  it("raster 宣稱但非圖 data URI 被拒", () => {
    expect(addSticker([], "x", "<svg></svg>", { format: "raster" })).toEqual({ ok: false, reason: "bad-image" });
  });
});

describe("ADR-0224 at 標記與墓碑", () => {
  it("addSticker 帶 now → 資產有 at；無 now → 無 at（相容）", () => {
    expect(addSticker([], "圓", SVG_A, { now: 1234 }).ok && addSticker([], "圓", SVG_A, { now: 1234 }).ok).toBe(true);
    const withAt = addSticker([], "圓", SVG_A, { now: 1234 });
    expect(withAt.ok && withAt.sticker.at).toBe(1234);
    const noAt = addSticker([], "圓", SVG_A);
    expect(noAt.ok && noAt.sticker.at).toBeUndefined();
  });

  it("setShortcode 帶 now → 刷新 at", () => {
    const base = addSticker([], "圓", SVG_A, { now: 1 });
    if (!base.ok) throw new Error("unexpected");
    const r = setShortcode(base.list, base.sticker.id, "smile", 999);
    expect(r.ok && r.sticker.at).toBe(999);
  });

  it("addTombstone：新增置前、新到舊排序", () => {
    expect(addTombstone([{ id: "old", at: 1 }], "new", 5)).toEqual([
      { id: "new", at: 5 },
      { id: "old", at: 1 },
    ]);
  });

  it("addTombstone：同 id 更新為較新 at（去重）", () => {
    expect(addTombstone([{ id: "x", at: 1 }], "x", 9)).toEqual([{ id: "x", at: 9 }]);
  });

  it("addTombstone：超過上限裁切、保留最新", () => {
    let t: { id: string; at: number }[] = [];
    for (let i = 0; i < 200; i++) t = addTombstone(t, `id${i}`, i);
    expect(t.length).toBeLessThanOrEqual(128);
    expect(t[0]?.at).toBe(199); // 最新在前
  });
});
