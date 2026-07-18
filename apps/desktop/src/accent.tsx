// 自訂主題色（ADR-0064）。單一 `--accent` 覆寫即連動整個介面（因為 UI 已 token 化，
// 且 --titlebar 等由 --accent 以 color-mix 推導）。純本地儲存（localStorage），不上雲。
// 深色主題下自動提亮以維持對比。
//
// 色彩推導（lightenHex/accentForTheme）已抽至 `@cinderous/theme` 作為跨前端 SSOT（ADR-0080）；
// 此處只轉引，桌面與行動端共用同一份提亮邏輯。CSS 端的 --bg-a/b/c/--titlebar 仍由 msn.css 的
// color-mix 於瀏覽器即時推導，其值與 `@cinderous/theme` 以測試對齊。
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { accentForTheme } from "@cinderous/theme";
import { useTheme } from "./theme.js";
import { scopedGet, scopedRemove, scopedSet } from "./identity-scoped.js";

// 轉引 SSOT，供設定頁與測試沿用既有 import 路徑。
export { accentForTheme, lightenHex } from "@cinderous/theme";

// ADR-0167：主色改為身分層覆寫、回退裝置層（`nb.<pubkey>.accent` → `nb.accent`）。
const SUFFIX = "accent";
/** 副色（次要主題色，ADR-0078）：驅動標題列＋頂部漸層；未設＝沿用主色。 */
const SUFFIX2 = "accent2";

function loadHex(suffix: string): string | null {
  const v = scopedGet(suffix);
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
}

interface AccentContextValue {
  /** 主色（null＝用內建預設）。 */
  accent: string | null;
  setAccent: (hex: string | null) => void;
  /** 副色（null＝跟隨主色）；驅動標題列＋頂部漸層（ADR-0078）。 */
  accent2: string | null;
  setAccent2: (hex: string | null) => void;
}

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: ReactNode }): JSX.Element {
  const { theme } = useTheme();
  const [accent, setAccentState] = useState<string | null>(() => loadHex(SUFFIX));
  const [accent2, setAccent2State] = useState<string | null>(() => loadHex(SUFFIX2));

  useEffect(() => {
    const root = document.documentElement;
    if (accent) root.style.setProperty("--accent", accentForTheme(accent, theme));
    else root.style.removeProperty("--accent"); // 回到樣式表內建 accent（亮/暗）
  }, [accent, theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent2) root.style.setProperty("--accent2", accentForTheme(accent2, theme));
    else root.style.removeProperty("--accent2"); // 回退樣式表 --accent2: var(--accent)（跟隨主色）
  }, [accent2, theme]);

  const setAccent = (hex: string | null): void => {
    if (hex) scopedSet(SUFFIX, hex);
    else scopedRemove(SUFFIX);
    setAccentState(hex);
  };

  const setAccent2 = (hex: string | null): void => {
    if (hex) scopedSet(SUFFIX2, hex);
    else scopedRemove(SUFFIX2);
    setAccent2State(hex);
  };

  const value = useMemo<AccentContextValue>(
    () => ({ accent, setAccent, accent2, setAccent2 }),
    [accent, accent2],
  );
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
