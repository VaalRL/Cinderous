// 行動端的 jsdom 掛載小工具（ADR-0328）——比照桌面 `apps/desktop/src/test/jsdom-mount.ts`。
//
// 行動端所有既有 UI 測試都是 `renderToStaticMarkup`（SSR、node 環境）：**`useEffect` 從不執行、
// 事件從不觸發**。而 Phase P4 要守的那條不變式——「切身分後看不到上個身分的東西」——
// 恰恰住在互動與非同步落地裡，靜態渲染一個都碰不到。
//
// ⚠ 這也是 P4 至今沒做治本重構的理由（ROADMAP：「行動端測試只有靜態渲染、抓不到互動回歸，
// 風險過高」）。同一個弱點兩頭都佔：既讓重構不敢動，也讓這類 bug 平常不會被發現。
// 先補這層，循環才斷得掉。
//
// 用 `react-dom/client` 的 `createRoot` ＋ `react` 的 `act`（免 @testing-library；react-dom 本就在）。
// 使用端須在檔案頂端標 `// @vitest-environment jsdom`（逐檔切環境，不動既有 node-env SSR 測試）。

import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未穩定暴露 `localStorage` 全域——裝一個 Map-backed shim（同桌面那招）。
// 行動端的 profiles 登錄與各種偏好都走它，沒有就整個開機路徑起不來。
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

/** 清空 localStorage（每個測試之間互不污染；登錄檔與偏好都在裡面）。 */
export function clearStorage(): void {
  (globalThis as { localStorage: { clear(): void } }).localStorage.clear();
}

export interface Mounted {
  container: HTMLElement;
  rerender(next: ReactElement): void;
  unmount(): void;
}

/** 掛載一個元件到 jsdom，並在 `act` 中沖刷首次的 effect。 */
export function mount(element: ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    rerender(next: ReactElement): void {
      act(() => root.render(next));
    },
    unmount(): void {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 依 `testID` 取元素（react-native-web 會渲染成 `data-testid`）。 */
export function byTestId(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`找不到 testID=${id}（目前有：${ids(root).join(", ")}）`);
  return el;
}

/** 目前畫面上所有 testID（找不到元素時的錯誤訊息用，省去反覆猜）。 */
export function ids(root: HTMLElement): string[] {
  return [...root.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid") ?? "");
}

/** 點擊（RNW 的 Pressable 在 web 上吃 click）。 */
export function click(el: HTMLElement): void {
  act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/**
 * 在受控輸入框打字。
 *
 * React 會攔截 `value` setter 來追蹤變更，直接改 `el.value` 它看不到 ⇒ 必須用原型上的
 * 原生 setter 寫入，再送 `input` 事件。這是 React 受控元件在無 testing-library 時的標準作法。
 */
export function typeInto(el: HTMLElement, text: string): void {
  const input = el as HTMLInputElement;
  const proto = Object.getPrototypeOf(input) as object;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, text);
  act(() => void input.dispatchEvent(new Event("input", { bubbles: true })));
}

/** 沖刷微任務（等非同步落地，例如 `.then(setState)`）。 */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * 裝一個什麼都不做的 `WebSocket`（互動測試用）。
 *
 * 🔴 **不是為了方便，是為了讓測試封閉**：真的讓引擎去連 `wss://…` 會在 jsdom 裡發出真實的
 * DNS/連線嘗試，退避重試的計時器又會在測試（與 jsdom 環境）拆掉之後才回來
 * ⇒ `localStorage` 已消失、`ws` 丟 `ERR_INVALID_ARG_TYPE`，變成**與測試內容無關的未處理例外**，
 * 而且只在整包跑時才出現。測試不該碰網路。
 */
export function stubWebSocket(): void {
  class Dead {
    static readonly CONNECTING = 0;
    readonly readyState = 0;
    onopen: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    onmessage: unknown = null;
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = Dead;
}
