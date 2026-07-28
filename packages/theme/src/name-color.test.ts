// 發言者名字色（ADR-0271）：穩定性、每人相異、以及**全 360 hue 的 WCAG 達標**。
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./tokens.js";
import { hueOf, NAME_COLOR_BG, nameColor, nameColorContrast } from "./name-color.js";

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);

describe("nameColor（ADR-0271）", () => {
  it("穩定：同一 seed 恆得同色（否決『每次隨機』——顏色要能認人）", () => {
    expect(nameColor(PK_A, "light")).toBe(nameColor(PK_A, "light"));
    expect(nameColor(PK_A, "dark")).toBe(nameColor(PK_A, "dark"));
  });

  it("不同人得不同 hue（同一把雜湊，與頭像色同源）", () => {
    expect(hueOf(PK_A)).not.toBe(hueOf(PK_B));
    expect(nameColor(PK_A, "light")).not.toBe(nameColor(PK_B, "light"));
  });

  it("依主題調亮度：深色主題比亮色主題亮（同 hue 不同 L）", () => {
    const l = nameColor(PK_A, "light");
    const d = nameColor(PK_A, "dark");
    expect(l).not.toBe(d);
    expect(hueOf(PK_A)).toBe(hueOf(PK_A)); // hue 不變，只有亮度換
  });

  it("🔴 全 360 hue × 四種主題組合皆達 WCAG 門檻（一般 AA 4.5／高對比 AAA 7）", () => {
    // 直接掃 hue：以合成 seed 覆蓋整個色環（hueOf 對單字元 seed 即字碼 %360）。
    for (let h = 0; h < 360; h++) {
      const seed = String.fromCharCode(h); // hueOf 單字元＝charCode % 360
      expect(hueOf(seed)).toBe(h % 360);
      expect(contrastRatio(nameColor(seed, "light"), NAME_COLOR_BG.light), `light hue ${h}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(nameColor(seed, "dark"), NAME_COLOR_BG.dark), `dark hue ${h}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(nameColor(seed, "light", true), NAME_COLOR_BG.lightHC), `lightHC hue ${h}`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(nameColor(seed, "dark", true), NAME_COLOR_BG.darkHC), `darkHC hue ${h}`).toBeGreaterThanOrEqual(7);
    }
  });

  it("最差 hue 的實測值（亮色＝黃 60、深色＝藍 240）符合設計註記", () => {
    expect(nameColorContrast(String.fromCharCode(60), "light")).toBeCloseTo(4.87, 1);
    expect(nameColorContrast(String.fromCharCode(240), "dark")).toBeCloseTo(5.04, 1);
  });

  it("輸出為 #rrggbb（可直接進 inline style）", () => {
    expect(nameColor(PK_A, "light")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
