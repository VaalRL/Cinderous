import { describe, expect, it } from "vitest";
import {
  accentForTheme,
  lightenHex,
  mixSrgb,
  resolveTheme,
  STATUS_COLORS,
} from "./tokens.js";

describe("@cinderous/theme 色彩推導（ADR-0080）", () => {
  it("mixSrgb：sRGB 線性內插、權重夾限、非法原樣", () => {
    expect(mixSrgb("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixSrgb("#2f6cd6", "#ffffff", 1)).toBe("#2f6cd6"); // 權重 1＝第一色
    expect(mixSrgb("#2f6cd6", "#ffffff", 0)).toBe("#ffffff"); // 權重 0＝第二色
    expect(mixSrgb("nope", "#ffffff", 0.5)).toBe("nope");
  });

  it("lightenHex／accentForTheme：延續 ADR-0064 契約", () => {
    expect(lightenHex("#000000", 0.5)).toBe("#808080");
    expect(lightenHex("#2f6cd6", 0)).toBe("#2f6cd6");
    expect(lightenHex("#ffffff", 0.5)).toBe("#ffffff");
    expect(lightenHex("nope", 0.3)).toBe("nope");
    expect(accentForTheme("#2f6cd6", "light")).toBe("#2f6cd6");
    expect(accentForTheme("#2f6cd6", "dark")).toBe("#5d8cdf"); // 深色提亮 0.22
  });

  it("lightenHex：任意 amount 逐位元精確（非只 0.22）＋夾限", () => {
    expect(lightenHex("#000000", 0.1)).toBe("#1a1a1a"); // round(255*0.1)=26=0x1a（原式；非 mixSrgb 的 0x19）
    expect(lightenHex("#000000", 2)).toBe("#ffffff"); // amount>1 夾限
    expect(lightenHex("#2f6cd6", -1)).toBe("#2f6cd6"); // amount<0 夾限＝不變
  });

  it("狀態語意色與桌面 .dot 同源（msn.css）", () => {
    expect(STATUS_COLORS).toEqual({
      online: "#36c46b",
      away: "#f2b134",
      busy: "#e5484d",
      offline: "#b8c2d0",
    });
  });
});

describe("resolveTheme 與桌面 msn.css 對齊（改一邊沒改另一邊＝紅）", () => {
  it("淺色預設：基底色票逐項對齊 :root", () => {
    const t = resolveTheme({ theme: "light" });
    expect(t.accent).toBe("#2f6cd6");
    expect(t.accent2).toBe("#2f6cd6"); // 副色未設＝跟隨主色
    expect(t.ink).toBe("#1b2b44");
    expect(t.muted).toBe("#6b7d99");
    expect(t.panel).toBe("#ffffff");
    expect(t.surface2).toBe("#eef4ff");
    expect(t.border).toBe("#cdddf2");
    expect(t.hover).toBe("#eaf2ff");
    expect(t.field).toBe("#ffffff");
    expect(t.inName).toBe("#b5398a");
    expect(t.codeBg).toBe("#eef2f9");
  });

  it("淺色預設：--bg-a/b/c 與 --titlebar 推導對齊", () => {
    const t = resolveTheme({ theme: "light" });
    expect(t.bgA).toBe("#acc4ef"); // color-mix(accent2 40%, #fff)
    expect(t.titlebarBottom).toBe("#2f6cd6"); // 純 accent2
  });

  it("深色預設：基底色票逐項對齊 :root[data-theme=dark]", () => {
    const t = resolveTheme({ theme: "dark" });
    expect(t.accent).toBe("#6ea8ff");
    expect(t.ink).toBe("#e6edf7");
    expect(t.muted).toBe("#93a1ba");
    expect(t.panel).toBe("#1d2430");
    expect(t.surface2).toBe("#232c3a");
    expect(t.border).toBe("#33405a");
    expect(t.hover).toBe("#2a3547");
    expect(t.field).toBe("#161c26");
    expect(t.inName).toBe("#e57ab8");
    expect(t.codeBg).toBe("#2a3344");
    expect(t.bgA).toBe("#253653"); // color-mix(accent2 22%, #101623)
  });

  it("自訂主色：深色提亮、副色未設時跟隨已提亮的主色", () => {
    const t = resolveTheme({ accent: "#2f6cd6", theme: "dark" });
    expect(t.accent).toBe("#5d8cdf");
    expect(t.accent2).toBe("#5d8cdf");
  });

  it("自訂副色：淺色下獨立驅動頂部漸層／標題列", () => {
    const t = resolveTheme({ accent: "#2f6cd6", accent2: "#e2632b", theme: "light" });
    expect(t.accent).toBe("#2f6cd6");
    expect(t.titlebarBottom).toBe("#e2632b"); // 標題列吃副色
    expect(t.bgA).not.toBe("#acc4ef"); // 頂部漸層改由副色推導
  });

  it("非法 hex 的 accent/accent2 視同未設，落回內建預設（SSOT 防呆，不汙染整組色）", () => {
    const t = resolveTheme({ accent: "bogus", accent2: "#zzz", theme: "light" });
    expect(t.accent).toBe("#2f6cd6"); // 落回預設，而非字面 "bogus"
    expect(t.accent2).toBe("#2f6cd6");
    expect(t.bgA).toBe("#acc4ef"); // 由預設推導、非 "bogus"
    expect(t.titlebarBottom).toBe("#2f6cd6");
  });
});
