import { describe, expect, it } from "vitest";
import { makeQr, qrSvg } from "./qr.js";

const NPUB = "npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sjpv92";

describe("QR 產生（M9 加好友）", () => {
  it("矩陣為正方、非空、且對相同輸入穩定", () => {
    const a = makeQr(NPUB);
    expect(a.count).toBeGreaterThan(20); // npub 約需版本 3+
    let dark = 0;
    for (let r = 0; r < a.count; r++) for (let c = 0; c < a.count; c++) if (a.isDark(r, c)) dark++;
    expect(dark).toBeGreaterThan(0);
    const b = makeQr(NPUB);
    expect(b.count).toBe(a.count);
    // 決定性：同輸入同輸出
    for (let r = 0; r < a.count; r++)
      for (let c = 0; c < a.count; c++) expect(b.isDark(r, c)).toBe(a.isDark(r, c));
  });

  it("三個定位圖案（角落 7×7）齊全", () => {
    const { count, isDark } = makeQr(NPUB);
    const finderTopLeft = isDark(0, 0) && isDark(6, 6) && isDark(0, 6) && isDark(6, 0) && !isDark(1, 1);
    const finderTopRight = isDark(0, count - 1) && isDark(6, count - 7);
    const finderBotLeft = isDark(count - 1, 0) && isDark(count - 7, 6);
    expect(finderTopLeft).toBe(true);
    expect(finderTopRight).toBe(true);
    expect(finderBotLeft).toBe(true);
  });

  it("qrSvg 產出合法 SVG 且含暗點 path", () => {
    const svg = qrSvg(NPUB);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).toContain('fill="#000000"');
  });

  it("較長輸入需要較大（或相等）版本", () => {
    const small = makeQr("npub1short");
    const big = makeQr(NPUB + NPUB);
    expect(big.count).toBeGreaterThanOrEqual(small.count);
  });
});
