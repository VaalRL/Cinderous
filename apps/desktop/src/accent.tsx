// 自訂主題色（ADR-0064）。單一 `--accent` 覆寫即連動整個介面（因為 UI 已 token 化，
// 且 --titlebar 等由 --accent 以 color-mix 推導）。純本地儲存（localStorage），不上雲。
// 深色主題下自動提亮以維持對比。
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTheme } from "./theme.js";

const STORAGE_KEY = "nb.accent";
/** 深色主題提亮比例（比照原本暗色 accent 較亮的作法）。 */
const DARK_LIGHTEN = 0.22;

/** 把 hex 往白色混（提亮）；amount 0..1。非法輸入原樣回傳。 */
export function lightenHex(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * amount));
  return `#${((1 << 24) | (ch[0]! << 16) | (ch[1]! << 8) | ch[2]!).toString(16).slice(1)}`;
}

/** 依主題把自訂色調整為實際套用色（深色提亮，淺色原樣）。 */
export function accentForTheme(hex: string, theme: "light" | "dark"): string {
  return theme === "dark" ? lightenHex(hex, DARK_LIGHTEN) : hex;
}

function load(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

interface AccentContextValue {
  /** 使用者選的自訂色（null＝用內建預設）。 */
  accent: string | null;
  setAccent: (hex: string | null) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: ReactNode }): JSX.Element {
  const { theme } = useTheme();
  const [accent, setAccentState] = useState<string | null>(load);

  useEffect(() => {
    const root = document.documentElement;
    if (accent) root.style.setProperty("--accent", accentForTheme(accent, theme));
    else root.style.removeProperty("--accent"); // 回到樣式表內建 accent（亮/暗）
  }, [accent, theme]);

  const setAccent = (hex: string | null): void => {
    try {
      if (hex) localStorage.setItem(STORAGE_KEY, hex);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* localStorage 不可用時忽略 */
    }
    setAccentState(hex);
  };

  const value = useMemo<AccentContextValue>(() => ({ accent, setAccent }), [accent]);
  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error("useAccent 必須在 AccentProvider 內使用");
  return ctx;
}

/** MSN 懷舊預設色票（供設定頁快選）。 */
export const ACCENT_PRESETS: { key: string; hex: string }[] = [
  { key: "classic", hex: "#2f6cd6" },
  { key: "forest", hex: "#2f9e44" },
  { key: "grape", hex: "#7c4dff" },
  { key: "cherry", hex: "#e5498f" },
  { key: "lagoon", hex: "#0ea5b5" },
  { key: "ember", hex: "#e2632b" },
  { key: "slate", hex: "#556884" },
];
