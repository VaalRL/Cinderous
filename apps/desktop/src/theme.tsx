import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "nb.theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage 不可用時忽略 */
  }
  // 首次啟動一律預設淺色（ADR-0250，收斂官網 ADR-0246 立場）：不再跟隨系統深色，
  // 讓「初次登入」在所有版本一致是淺色；深色改由使用者手動切換（本機記憶）。
  return "light";
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略 */
    }
    setThemeState(next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }),
    [theme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必須在 ThemeProvider 內使用");
  return ctx;
}

/**
 * 唯讀版：**不在 Provider 內時回 `"light"` 而非拋錯**（ADR-0271，同 `useContrastMode`）。
 * 給「只是想知道目前主題以挑顏色」的消費端；切換主題的入口仍走 `useTheme`。
 */
export function useThemeMode(): Theme {
  return useContext(ThemeContext)?.theme ?? "light";
}
