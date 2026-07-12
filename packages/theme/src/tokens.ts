// @cinder/theme — 跨前端設計 token 的單一真實來源（SSOT，ADR-0080）。
//
// 純函式、無 DOM、框架無關：桌面（React-DOM/CSS 變數）與行動端（react-native-web /
// 未來 RN StyleSheet）共吃同一份色彩定義與推導公式，避免兩邊各自硬編碼而漂移。
//
// 桌面版 `apps/desktop/src/ui/msn.css` 的 `:root` / `:root[data-theme="dark"]` 是視覺參考；
// 本檔以 TS 重現其「基底色票 + color-mix 推導」，並由 tokens.test.ts 對齊值把關（改一邊沒改
// 另一邊＝測試紅）。桌面的 `--accent`/`--accent2` 深色提亮邏輯亦以此處為準（accent.tsx 轉引）。

export type Theme = "light" | "dark";

/** 深色主題自訂色提亮比例（比照桌面暗色 accent 較亮的作法）。 */
export const DARK_LIGHTEN = 0.22;

/** 上線狀態語意色（與桌面 `.dot.online/away/busy/offline` 同源，msn.css L547–L550）。 */
export const STATUS_COLORS = {
  online: "#36c46b",
  away: "#f2b134",
  busy: "#e5484d",
  offline: "#b8c2d0",
} as const;

/** 解析 `#rrggbb` 為 [r,g,b]（0–255）；非法回傳 null。 */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(ch: [number, number, number]): string {
  return `#${((1 << 24) | (ch[0] << 16) | (ch[1] << 8) | ch[2]).toString(16).slice(1)}`;
}

/**
 * 在 sRGB 空間線性內插兩色（重現 CSS `color-mix(in srgb, a wA%, b)`）。
 * weightA 為第一色 a 的權重（0..1）；任一色非法則原樣回傳 a。
 */
export function mixSrgb(a: string, b: string, weightA: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const w = Math.min(1, Math.max(0, weightA));
  return toHex([
    Math.round(pa[0] * w + pb[0] * (1 - w)),
    Math.round(pa[1] * w + pb[1] * (1 - w)),
    Math.round(pa[2] * w + pb[2] * (1 - w)),
  ]);
}

/**
 * 把 hex 往白色混（提亮）；amount 夾限 0..1。非法輸入原樣回傳。
 * 直接以 `c + (255-c)*amount` 逐通道計算（延續 ADR-0064 桌面原式），對任意 amount 皆逐位元精確——
 * 不走 mixSrgb 轉譯，避免 `1-(1-amount)` 的浮點誤差在 .5 邊界丟失 1 色階。
 */
export function lightenHex(hex: string, amount: number): string {
  const p = parseHex(hex);
  if (!p) return hex;
  const a = Math.min(1, Math.max(0, amount));
  return toHex([
    Math.round(p[0] + (255 - p[0]) * a),
    Math.round(p[1] + (255 - p[1]) * a),
    Math.round(p[2] + (255 - p[2]) * a),
  ]);
}

/** 依主題把自訂色調整為實際套用色（深色提亮，淺色原樣）。 */
export function accentForTheme(hex: string, theme: Theme): string {
  return theme === "dark" ? lightenHex(hex, DARK_LIGHTEN) : hex;
}

/** 每主題的基底色票與 accent 推導設定（對照 msn.css）。 */
interface ThemeBase {
  defaultAccent: string;
  ink: string;
  muted: string;
  panel: string;
  surface2: string;
  border: string;
  hover: string;
  field: string;
  inName: string;
  codeBg: string;
  /** [底色, accent2 權重]：頂部漸層背景 --bg-a/b/c 由 accent2 與底色 color-mix 而得。 */
  bg: { a: [string, number]; b: [string, number]; c: [string, number] };
  /** 標題列漸層上下端（--titlebar）。 */
  titlebar: { top: [string, number]; bottom: [string, number] };
}

const LIGHT: ThemeBase = {
  defaultAccent: "#2f6cd6",
  ink: "#1b2b44",
  muted: "#6b7d99",
  panel: "#ffffff",
  surface2: "#eef4ff",
  border: "#cdddf2",
  hover: "#eaf2ff",
  field: "#ffffff",
  inName: "#b5398a",
  codeBg: "#eef2f9",
  bg: { a: ["#ffffff", 0.4], b: ["#ffffff", 0.62], c: ["#ffffff", 0.74] },
  titlebar: { top: ["#ffffff", 0.68], bottom: ["#ffffff", 1] }, // bottom 權重 1＝純 accent2
};

const DARK: ThemeBase = {
  defaultAccent: "#6ea8ff",
  ink: "#e6edf7",
  muted: "#93a1ba",
  panel: "#1d2430",
  surface2: "#232c3a",
  border: "#33405a",
  hover: "#2a3547",
  field: "#161c26",
  inName: "#e57ab8",
  codeBg: "#2a3344",
  bg: { a: ["#101623", 0.22], b: ["#0d131f", 0.14], c: ["#0a0f18", 0.09] },
  titlebar: { top: ["#101a2e", 0.52], bottom: ["#0b1424", 0.36] },
};

const BASE: Record<Theme, ThemeBase> = { light: LIGHT, dark: DARK };

export interface ThemeInput {
  /** 主色 hex；null／未設＝用內建預設。 */
  accent?: string | null;
  /** 副色 hex；null／未設＝跟隨主色（同桌面 --accent2: var(--accent)）。 */
  accent2?: string | null;
  theme: Theme;
}

/** 解析後的具體色值（皆為 `#rrggbb`），供 RN StyleSheet 或注入 CSS 變數。 */
export interface ThemeTokens {
  accent: string;
  accent2: string;
  ink: string;
  muted: string;
  panel: string;
  surface2: string;
  border: string;
  hover: string;
  field: string;
  inName: string;
  codeBg: string;
  bgA: string;
  bgB: string;
  bgC: string;
  titlebarTop: string;
  titlebarBottom: string;
}

/**
 * 由（主色、副色、主題）解析出整組具體 token。與桌面等價：
 * 未設主色＝內建預設（不再提亮）；設了自訂主色＝深色提亮；副色未設＝跟隨主色。
 */
export function resolveTheme(input: ThemeInput): ThemeTokens {
  const cfg = BASE[input.theme];
  // 非法 hex（非 #rrggbb）視同未設，落回內建預設——避免無效值無聲汙染整組 token（SSOT 自帶防呆）。
  const validAccent = input.accent && parseHex(input.accent) ? input.accent : null;
  const validAccent2 = input.accent2 && parseHex(input.accent2) ? input.accent2 : null;
  const accent = validAccent ? accentForTheme(validAccent, input.theme) : cfg.defaultAccent;
  const accent2 = validAccent2 ? accentForTheme(validAccent2, input.theme) : accent;
  return {
    accent,
    accent2,
    ink: cfg.ink,
    muted: cfg.muted,
    panel: cfg.panel,
    surface2: cfg.surface2,
    border: cfg.border,
    hover: cfg.hover,
    field: cfg.field,
    inName: cfg.inName,
    codeBg: cfg.codeBg,
    bgA: mixSrgb(accent2, cfg.bg.a[0], cfg.bg.a[1]),
    bgB: mixSrgb(accent2, cfg.bg.b[0], cfg.bg.b[1]),
    bgC: mixSrgb(accent2, cfg.bg.c[0], cfg.bg.c[1]),
    titlebarTop: mixSrgb(accent2, cfg.titlebar.top[0], cfg.titlebar.top[1]),
    titlebarBottom: mixSrgb(accent2, cfg.titlebar.bottom[0], cfg.titlebar.bottom[1]),
  };
}
