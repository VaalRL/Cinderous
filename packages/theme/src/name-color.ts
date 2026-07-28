// 發言者名字色（ADR-0271）：由 pubkey 雜湊出**穩定**的每人專屬色。
//
// ## 為什麼不是「每次隨機」
//
// 顏色的價值在「這個顏色＝這個人」——每次渲染都換色等於雜訊，還會破壞 SSR/測試的決定性
// （重繪就跳色）。看起來像隨機、實際每人固定，才是 LINE/Slack/Discord 的做法。
//
// ## 為什麼不能直接用 avatarColor 的 HSL
//
// 頭像底色是 `hsl(h 70% 55%)` 系——當**文字色**用時，黃/青綠系在白底只有 ~2:1 對比，
// 遠低於 WCAG AA（4.5）。這裡改為「同一個 hue、亮度依主題與對比模式選安全值」：
// 每組 S/L 都掃過全 360 hue 驗證最差情況仍達標（`name-color.test.ts` 以迴圈鎖死）。
//
// hue 與 `avatarColor` 同一把雜湊 → 名字色與頭像色是同一個人 identity 的一致訊號。
import { contrastRatio } from "./tokens.js";
import type { Theme } from "./tokens.js";

/** 由種子（pubkey）取 0–359 的 hue。與桌面 `avatarColor` 同式，確保頭像/名字同色系。 */
export function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/**
 * 各主題×對比模式的安全飽和度/亮度（全 360 hue 的最差對比皆達標）。
 * 最差 hue：亮色＝60（黃）、深色＝240（藍）。實測值見測試。
 */
const SL: Record<"light" | "dark" | "lightHC" | "darkHC", { s: number; l: number }> = {
  light: { s: 70, l: 27 }, // vs #ffffff 最差 4.87（AA 4.5）
  dark: { s: 65, l: 72 }, // vs panel #1d2430 最差 5.04
  lightHC: { s: 75, l: 20 }, // vs #ffffff 最差 7.34（AAA 7）
  darkHC: { s: 70, l: 80 }, // vs panel #10151d 最差 8.30
};

/** HSL → `#rrggbb`（純函式，避免相依瀏覽器 color 解析）。 */
function hslHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const to = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/**
 * 發言者名字色：`#rrggbb`，每人固定、依主題與高對比模式自動選安全亮度。
 * 保證與該主題的訊息底色達 WCAG AA（高對比模式達 AAA）——測試以全 hue 迴圈驗證。
 */
export function nameColor(seed: string, theme: Theme, contrast = false): string {
  const key = theme === "dark" ? (contrast ? "darkHC" : "dark") : contrast ? "lightHC" : "light";
  const { s, l } = SL[key];
  return hslHex(hueOf(seed), s, l);
}

/** 各主題的名字色比對底（測試與呼叫端共用；即該主題訊息區底色）。 */
export const NAME_COLOR_BG: Record<"light" | "dark" | "lightHC" | "darkHC", string> = {
  light: "#ffffff",
  dark: "#1d2430",
  lightHC: "#ffffff",
  darkHC: "#10151d",
};

/** 供測試/除錯：某 seed 在某主題下的實際對比值。 */
export function nameColorContrast(seed: string, theme: Theme, contrast = false): number {
  const key = theme === "dark" ? (contrast ? "darkHC" : "dark") : contrast ? "lightHC" : "light";
  return contrastRatio(nameColor(seed, theme, contrast), NAME_COLOR_BG[key]);
}
