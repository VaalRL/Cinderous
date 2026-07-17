// 桌面佈局（ADR-0079）：經典浮動視窗 ↔ 新三欄整合，一鍵切換、本地儲存。
// 兩種佈局共用同一套狀態與內容元件，只換外殼；預設 classic（不驚嚇現有使用者）。
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { scopedGet, scopedSet } from "./identity-scoped.js";

export type Layout = "classic" | "modern";

// ADR-0167：佈局改為身分層覆寫、回退裝置層（`nb.<pubkey>.layout` → `nb.layout`）。
const SUFFIX = "layout";

function initialLayout(): Layout {
  const saved = scopedGet(SUFFIX);
  if (saved === "classic" || saved === "modern") return saved;
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
    scopedSet(SUFFIX, next);
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
