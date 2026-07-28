// 浮動視窗管理 hook（ADR-0216）：於 App 呼叫一次，`get(id, index)` 回傳該窗的絕對定位
// 樣式與拖曳/縮放/置頂把手。單一 hook 管理全部窗（避免 map 內呼叫 hook）；幾何純邏輯在
// floating-window.ts（已測），此處負責狀態、DOM 量測、事件與 localStorage 持久化。
import { useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { cssZoomFactor } from "../ui-scale.js";
import { clampRect } from "./floating-window.js";

const LS_PREFIX = "nb.win.";
const MIN_W = 300;
const MIN_H = 320;
const STEP = 28;
const CYCLE = 6;
const DEFAULT_SIZE = { w: 380, h: 460 };

interface WinState {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}
type WinMap = Record<string, WinState>;

function readWin(id: string): WinState | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<WinState>;
    if ([p.x, p.y, p.w, p.h].every((n) => typeof n === "number")) {
      return { x: p.x!, y: p.y!, w: p.w!, h: p.h!, z: typeof p.z === "number" ? p.z : 1 };
    }
  } catch {
    /* 毀損/不可用 */
  }
  return null;
}
function writeWin(id: string, s: WinState): void {
  try {
    localStorage.setItem(LS_PREFIX + id, JSON.stringify(s));
  } catch {
    /* 配額/不可用 */
  }
}
function loadAll(): WinMap {
  const out: WinMap = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        const s = readWin(k.slice(LS_PREFIX.length));
        if (s) out[k.slice(LS_PREFIX.length)] = s;
      }
    }
  } catch {
    /* 不可用 */
  }
  return out;
}

function defaultFor(index: number, size?: { w: number; h: number }): WinState {
  const off = ((((index % CYCLE) + CYCLE) % CYCLE) * STEP);
  const s = size ?? DEFAULT_SIZE;
  return { x: off, y: off, w: s.w, h: s.h, z: 1 };
}

export interface FloatingWindow {
  style: CSSProperties;
  onRootMouseDown: () => void;
  onTitleMouseDown: (e: ReactMouseEvent) => void;
  onResizeMouseDown: (e: ReactMouseEvent) => void;
}

export interface FloatingApi {
  /** 取某窗的浮動樣式與把手；`index` 供首開層疊預設位、`defaultSize` 供尺寸遷移。 */
  get: (id: string, index: number, defaultSize?: { w: number; h: number }) => FloatingWindow;
}

/** 管理經典佈局右側所有浮動對話窗（ADR-0216）。 */
export function useFloatingWindows(): FloatingApi {
  const [wins, setWins] = useState<WinMap>(() => loadAll());
  const ref = useRef(wins);
  ref.current = wins;

  const stateOf = (id: string, index: number, size?: { w: number; h: number }): WinState =>
    ref.current[id] ?? defaultFor(index, size);
  const maxZ = (): number => Object.values(ref.current).reduce((m, s) => Math.max(m, s.z), 0);

  const apply = (id: string, next: WinState): void => {
    ref.current = { ...ref.current, [id]: next };
    setWins(ref.current);
  };

  const startDrag =
    (id: string, index: number, size: { w: number; h: number } | undefined, mode: "move" | "resize") =>
    (e: ReactMouseEvent): void => {
      if (mode === "move" && (e.target as HTMLElement).closest("button, [role=button], input, select")) return;
      const el = (e.currentTarget as HTMLElement).closest("[data-floatwin]") as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      const parent = el.offsetParent as HTMLElement | null;
      const bounds = parent
        ? { w: parent.clientWidth, h: parent.clientHeight }
        : { w: window.innerWidth, h: window.innerHeight };
      const base = stateOf(id, index, size);
      const startX = e.clientX;
      const startY = e.clientY;
      // UI 尺寸（ADR-0253）：瀏覽器版 CSS zoom 下滑鼠座標是 viewport px、版面是縮放後 px，
      // 位移需除以縮放係數才能 1:1 跟手（Tauri 原生縮放係數恆為 1）。
      const zoom = cssZoomFactor();
      apply(id, { ...base, z: maxZ() + 1 }); // 拖曳即置頂
      const onMove = (ev: MouseEvent): void => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        const raw =
          mode === "move"
            ? { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h }
            : { x: base.x, y: base.y, w: Math.max(MIN_W, base.w + dx), h: Math.max(MIN_H, base.h + dy) };
        const c = clampRect(raw, bounds);
        apply(id, { ...ref.current[id]!, x: c.x, y: c.y, w: c.w, h: c.h });
      };
      const onUp = (): void => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const cur = ref.current[id];
        if (cur) writeWin(id, cur); // 放開才落盤（避免逐 px 寫入）
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

  const get = (id: string, index: number, size?: { w: number; h: number }): FloatingWindow => {
    const st = stateOf(id, index, size);
    return {
      style: { position: "absolute", left: st.x, top: st.y, width: st.w, height: st.h, zIndex: st.z },
      onRootMouseDown: () => {
        if (st.z >= maxZ()) return;
        const next = { ...stateOf(id, index, size), z: maxZ() + 1 };
        apply(id, next);
        writeWin(id, next);
      },
      onTitleMouseDown: startDrag(id, index, size, "move"),
      onResizeMouseDown: startDrag(id, index, size, "resize"),
    };
  };

  return { get };
}
