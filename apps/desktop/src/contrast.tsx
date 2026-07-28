// 高對比模式（ADR-0253，視障友善）：獨立軸、與亮/暗主題正交（data-contrast 疊在 data-theme 上）。
// 裝置層偏好（同主題/語言的定位，ADR-0167——無障礙是「用這台裝置的人」的需求，不隨身分）。
// 與主題不同：未手動設定時**尊重系統 `prefers-contrast: more`**——那是使用者在 OS 層宣告的
// 無障礙需求（非審美偏好），預設跟隨才是正確的無障礙行為（對照 ADR-0250 移除 prefers-color-scheme）。
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Contrast = "normal" | "high";

const STORAGE_KEY = "nb.contrast";

function initialContrast(): Contrast {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "normal" || saved === "high") return saved;
  } catch {
    /* localStorage 不可用時忽略 */
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-contrast: more)").matches) {
    return "high";
  }
  return "normal";
}

interface ContrastContextValue {
  contrast: Contrast;
  setContrast: (contrast: Contrast) => void;
  toggle: () => void;
}

const ContrastContext = createContext<ContrastContextValue | null>(null);

export function ContrastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [contrast, setContrastState] = useState<Contrast>(initialContrast);

  useEffect(() => {
    // 只在 high 時掛屬性：CSS 選擇器單純（[data-contrast="high"]），normal＝完全無痕。
    if (contrast === "high") document.documentElement.setAttribute("data-contrast", "high");
    else document.documentElement.removeAttribute("data-contrast");
  }, [contrast]);

  const setContrast = (next: Contrast): void => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略 */
    }
    setContrastState(next);
  };

  const value = useMemo<ContrastContextValue>(
    () => ({ contrast, setContrast, toggle: () => setContrast(contrast === "high" ? "normal" : "high") }),
    [contrast],
  );
  return <ContrastContext.Provider value={value}>{children}</ContrastContext.Provider>;
}

export function useContrast(): ContrastContextValue {
  const ctx = useContext(ContrastContext);
  if (!ctx) throw new Error("useContrast 必須在 ContrastProvider 內使用");
  return ctx;
}
