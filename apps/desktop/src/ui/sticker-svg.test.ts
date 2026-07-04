import { describe, expect, it } from "vitest";
import { STICKER_PACKS, svgToDataUri } from "../stickers.js";
import { STICKER_SVG_MAX_BYTES, validateStickerSvg, withReducedMotionGuard, wrapRasterAsSvg } from "./sticker-svg.js";

const ok = (svg: string) => validateStickerSvg(svg);

describe("自製貼圖 SVG 驗證（拒收制，ADR-0032）", () => {
  it("簡單合法 SVG 通過", () => {
    expect(ok('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')).toEqual({ ok: true });
  });

  it("所有內建貼圖（含動態包）皆通過 → fork 可行", () => {
    for (const [pack, items] of Object.entries(STICKER_PACKS)) {
      for (const [id, s] of Object.entries(items)) {
        expect(ok(s.svg), `${pack}/${id}`).toEqual({ ok: true });
      }
    }
  });

  it("raster 包裝（data:image/*）通過", () => {
    const svg = wrapRasterAsSvg("data:image/webp;base64,AAAA");
    expect(ok(svg)).toEqual({ ok: true });
  });

  it("非 SVG 內容被拒", () => {
    expect(ok("hello").ok).toBe(false);
    expect(ok("<div>x</div>").ok).toBe(false);
    expect(ok("<svg>no closing").ok).toBe(false);
  });

  it("超過大小上限被拒", () => {
    const big = `<svg>${"x".repeat(STICKER_SVG_MAX_BYTES)}</svg>`;
    expect(ok(big)).toEqual({ ok: false, reason: "too-large" });
  });

  it("script / 事件屬性 / javascript: 被拒", () => {
    expect(ok('<svg><script>alert(1)</script></svg>').ok).toBe(false);
    expect(ok('<svg onload="alert(1)"><circle r="1"/></svg>').ok).toBe(false);
    expect(ok('<svg><a href="javascript:alert(1)">x</a></svg>').ok).toBe(false);
  });

  it("foreignObject / iframe 被拒", () => {
    expect(ok("<svg><foreignObject><div/></foreignObject></svg>").ok).toBe(false);
    expect(ok('<svg><iframe src="x"/></svg>').ok).toBe(false);
  });

  it("外部參照被拒（http / 協定相對 / url()）", () => {
    expect(ok('<svg><image href="https://evil.example/x.png"/></svg>').ok).toBe(false);
    expect(ok('<svg><image href="//evil.example/x.png"/></svg>').ok).toBe(false);
    expect(ok('<svg><style>.a{fill:url(https://evil.example)}</style></svg>').ok).toBe(false);
  });

  it("data: 僅允許 image/*", () => {
    expect(ok('<svg><image href="data:image/png;base64,AA"/></svg>').ok).toBe(true);
    expect(ok('<svg><image href="data:text/html,<script>"/></svg>').ok).toBe(false);
  });
});

describe("reduced-motion 無障礙護欄（ADR-0043）", () => {
  it("為動態自製 SVG 注入 reduced-motion 停用規則於 <svg> 之後", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes a{}</style><circle r="5"/></svg>';
    const guarded = withReducedMotionGuard(svg);
    expect(guarded).toContain("@media(prefers-reduced-motion:reduce)");
    expect(guarded).toContain("animation:none!important");
    expect(guarded.indexOf("prefers-reduced-motion")).toBeGreaterThan(guarded.indexOf("<svg"));
    expect(guarded).toContain("<circle r=\"5\"/>"); // 原內容保留
  });

  it("已自帶 reduced-motion（內建 anim()）者不重複注入", () => {
    for (const s of Object.values(STICKER_PACKS.motion ?? {})) {
      const before = (s.svg.match(/prefers-reduced-motion/gi) ?? []).length;
      const after = (withReducedMotionGuard(s.svg).match(/prefers-reduced-motion/gi) ?? []).length;
      expect(after).toBe(before); // 不新增
    }
  });

  it("非 SVG 內容原樣返回（不硬塞）", () => {
    expect(withReducedMotionGuard("not-svg")).toBe("not-svg");
  });

  it("svgToDataUri 一律套用護欄", () => {
    const uri = svgToDataUri('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>');
    expect(decodeURIComponent(uri)).toContain("prefers-reduced-motion");
  });
});
