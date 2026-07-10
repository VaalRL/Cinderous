// 桌面佈局（ADR-0079）：經典浮動視窗 ↔ 新三欄整合，一鍵切換、本地儲存。
// 兩種佈局共用同一套狀態與內容元件，只換外殼；預設 classic（不驚嚇現有使用者）。
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Layout = "classic" | "modern";

const STORAGE_KEY = "nb.layout";

function initialLayout(): Layout {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "classic" || saved === "modern") return saved;
  } catch {
    /* localStorage 不可用時忽略 */
  }
  return "classic";
}

interface LayoutContextValue {
  layout: Layout;
  setLayout: (layout: Layout) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }): JSX.Element {
  const [layout, setLayoutState] = useState<Layout>(initialLayout);
  const setLayout = (next: Layout): void => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略 */
    }
    setLayoutState(next);
  };
  const value = useMemo<LayoutContextValue>(() => ({ layout, setLayout }), [layout]);
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout 必須在 LayoutProvider 內使用");
  return ctx;
}
