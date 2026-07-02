/**
 * 語言下拉選單的鍵盤/開合純邏輯（無 DOM 依賴，方便單元測試）。
 * 依循 WAI-ARIA listbox 鍵盤模式：方向鍵移動高亮並環繞、Home/End 跳首尾、
 * Enter/Space 選取、Escape/Tab 關閉；選單關閉時方向鍵或 Enter 會展開。
 */
export interface MenuState {
  /** 選單是否展開。 */
  open: boolean;
  /** 目前高亮的選項索引（0-based）。 */
  active: number;
}

export interface MenuKeyResult {
  state: MenuState;
  /** 是否應提交高亮選項（Enter/Space 於展開狀態）。 */
  select: boolean;
}

/** 以環繞方式計算移動後的索引。 */
function wrap(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (index + delta + count) % count;
}

/**
 * 處理一次 keydown，回傳新狀態與是否要選取。
 * 不認得的按鍵回傳原狀態、select=false，呼叫端據此決定是否 preventDefault。
 */
export function menuKeydown(state: MenuState, key: string, count: number): MenuKeyResult {
  const keep: MenuKeyResult = { state, select: false };

  if (!state.open) {
    switch (key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ":
        return { state: { open: true, active: state.active }, select: false };
      default:
        return keep;
    }
  }

  switch (key) {
    case "ArrowDown":
      return { state: { open: true, active: wrap(state.active, 1, count) }, select: false };
    case "ArrowUp":
      return { state: { open: true, active: wrap(state.active, -1, count) }, select: false };
    case "Home":
      return { state: { open: true, active: 0 }, select: false };
    case "End":
      return { state: { open: true, active: Math.max(0, count - 1) }, select: false };
    case "Enter":
    case " ":
      return { state: { open: false, active: state.active }, select: true };
    case "Escape":
    case "Tab":
      return { state: { open: false, active: state.active }, select: false };
    default:
      return keep;
  }
}
