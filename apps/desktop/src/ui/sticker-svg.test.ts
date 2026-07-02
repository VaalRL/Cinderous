import { describe, expect, it } from "vitest";
import { STICKER_PACKS } from "../stickers.js";
import { STICKER_SVG_MAX_BYTES, validateStickerSvg, wrapRasterAsSvg } from "./sticker-svg.js";

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
