import { describe, expect, it } from "vitest";
import { calcPreview } from "./calc.js";

const val = (s: string) => calcPreview(s)?.result;

describe("對話算式預覽（ADR-0097）", () => {
  it("四則運算與優先序", () => {
    expect(val("1+1")).toBe("2");
    expect(val("2+3*4")).toBe("14"); // 先乘除
    expect(val("10-2-3")).toBe("5"); // 左結合
    expect(val("100/4/5")).toBe("5");
  });

  it("括號、一元負號、次方（右結合）", () => {
    expect(val("(2+3)*4")).toBe("20");
    expect(val("-3+5")).toBe("2");
    expect(val("-(2+3)")).toBe("-5");
    expect(val("2^10")).toBe("1024");
    expect(val("2^3^2")).toBe("512"); // 2^(3^2)，非 (2^3)^2=64
    expect(val("10%3")).toBe("1");
  });

  it("浮點毛邊抹除：0.1+0.2 顯示 0.3 而非 0.30000000000000004", () => {
    expect(val("0.1+0.2")).toBe("0.3");
    expect(val("1/3*3")).toBe("1");
  });

  it("全形輸入（繁中輸入法）：＋－×÷（）與全形數字皆可", () => {
    expect(val("１＋２")).toBe("3");
    expect(val("（２＋３）×４")).toBe("20");
    expect(val("10－4")).toBe("6");
    expect(val("9÷3")).toBe("3");
  });

  it("空白忽略", () => {
    expect(val(" 12 * 12 ")).toBe("144");
  });

  it("不是算式就回 null（不顯示預覽）", () => {
    expect(calcPreview("")).toBeNull();
    expect(calcPreview("42")).toBeNull(); // 純數字：沒有運算子
    expect(calcPreview("嗨")).toBeNull();
    expect(calcPreview("我 1+1 對嗎")).toBeNull(); // 只認整串，不抓子字串
    expect(calcPreview("1+")).toBeNull(); // 語法不完整
    expect(calcPreview("(1+2")).toBeNull(); // 括號未閉合
    expect(calcPreview("1++")).toBeNull();
  });

  it("除以零不顯示（結果非有限數）", () => {
    expect(calcPreview("1/0")).toBeNull();
    expect(calcPreview("5%0")).toBeNull();
  });

  it("日期/版號/電話不誤判為算式（誤判擾民比漏判更糟）", () => {
    expect(calcPreview("2024/01/02")).toBeNull();
    expect(calcPreview("1.2.3")).toBeNull();
    expect(calcPreview("2024-01-02")).toBeNull();
    expect(calcPreview("02-1234-5678")).toBeNull();
  });

  it("硬上限：過長輸入與過深巢狀不處理（防病態輸入）", () => {
    expect(calcPreview(`1+${"1+".repeat(40)}1`)).toBeNull(); // > 64 字元
    expect(calcPreview(`${"(".repeat(40)}1+1${")".repeat(40)}`)).toBeNull(); // 巢狀過深
  });

  it("回傳正規化算式與數值（供 UI 插入）", () => {
    const r = calcPreview("（１＋２）×３");
    expect(r).toEqual({ expr: "(1+2)*3", result: "9", value: 9 });
  });

  it("不執行任意程式碼：JS 片段一律不觸發（禁用 eval 的行為證明）", () => {
    expect(calcPreview("alert(1)")).toBeNull();
    expect(calcPreview("1+1;alert(1)")).toBeNull();
    expect(calcPreview("process.exit(1)")).toBeNull();
    expect(calcPreview("[].constructor")).toBeNull();
  });
});
