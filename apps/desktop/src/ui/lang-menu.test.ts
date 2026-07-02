import { describe, expect, it } from "vitest";
import { menuKeydown, type MenuState } from "./lang-menu.js";

const COUNT = 2; // zh-Hant, en
const closed: MenuState = { open: false, active: 0 };
const open0: MenuState = { open: true, active: 0 };
const open1: MenuState = { open: true, active: 1 };

describe("語言選單鍵盤邏輯", () => {
  it("關閉時：方向鍵 / Enter / Space 會展開，保留高亮", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      const r = menuKeydown({ open: false, active: 1 }, key, COUNT);
      expect(r.state).toEqual({ open: true, active: 1 });
      expect(r.select).toBe(false);
    }
  });

  it("關閉時：不相關按鍵不改變狀態、不選取", () => {
    const r = menuKeydown(closed, "a", COUNT);
    expect(r.state).toBe(closed);
    expect(r.select).toBe(false);
  });

  it("展開時：ArrowDown / ArrowUp 環繞移動", () => {
    expect(menuKeydown(open0, "ArrowDown", COUNT).state).toEqual(open1);
    expect(menuKeydown(open1, "ArrowDown", COUNT).state).toEqual(open0); // 環繞回頭
    expect(menuKeydown(open0, "ArrowUp", COUNT).state).toEqual(open1); // 環繞到尾
  });

  it("展開時：Home / End 跳首尾", () => {
    expect(menuKeydown(open1, "Home", COUNT).state).toEqual(open0);
    expect(menuKeydown(open0, "End", COUNT).state).toEqual(open1);
  });

  it("展開時：Enter / Space 收合並回報選取", () => {
    for (const key of ["Enter", " "]) {
      const r = menuKeydown(open1, key, COUNT);
      expect(r.select).toBe(true);
      expect(r.state.open).toBe(false);
      expect(r.state.active).toBe(1); // 提交當前高亮
    }
  });

  it("展開時：Escape / Tab 收合但不選取", () => {
    for (const key of ["Escape", "Tab"]) {
      const r = menuKeydown(open1, key, COUNT);
      expect(r.select).toBe(false);
      expect(r.state.open).toBe(false);
    }
  });

  it("count 為 0 時環繞不會除以零、索引停在 0", () => {
    expect(menuKeydown({ open: true, active: 0 }, "ArrowDown", 0).state.active).toBe(0);
  });
});
