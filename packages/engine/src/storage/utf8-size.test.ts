// UTF-8 位元組長度（審查發現：多處把 `String.length` 當成位元組數）。
//
// `String.length` 是 **UTF-16 code unit** 數，而我們送出去的一律是 UTF-8
// （`new TextEncoder().encode(...)`）。中文一個字＝1 個 UTF-16 unit 但 **3 個 UTF-8 bytes**
// ⇒ 以 `.length` 當位元組會**低估到三分之一**，而中文正是本專案的主要語系。
import { describe, expect, it } from "vitest";
import { utf8ByteLength } from "./utf8-size.js";

/** 對照組：真的編碼一次。用於驗證免配置的計算與它一致。 */
const actual = (s: string) => new TextEncoder().encode(s).byteLength;

describe("utf8ByteLength", () => {
  it("ASCII：1 byte", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("abc")).toBe(actual("abc"));
  });

  it("🔴 中文：3 bytes——這正是 `.length` 錯得最多的地方", () => {
    const s = "中文";
    expect(s.length).toBe(2); // UTF-16 unit
    expect(utf8ByteLength(s)).toBe(6); // 實際位元組
    expect(utf8ByteLength(s)).toBe(actual(s));
  });

  it("2-byte 區間（拉丁補充、希臘等）", () => {
    for (const s of ["é", "ñ", "α", "ж"]) expect(utf8ByteLength(s)).toBe(actual(s));
  });

  it("🔴 代理對（emoji）：4 bytes，且不得重複計算兩個 unit", () => {
    const s = "🔥";
    expect(s.length).toBe(2); // 一個代理對＝兩個 UTF-16 unit
    expect(utf8ByteLength(s)).toBe(4);
    expect(utf8ByteLength(s)).toBe(actual(s));
  });

  it("混合字串與空字串", () => {
    for (const s of ["", "a中🔥é", "訊息 message 123 🎉", JSON.stringify({ a: "中文", b: [1, 2] })]) {
      expect(utf8ByteLength(s)).toBe(actual(s));
    }
  });

  it("孤立代理（毀損字串）不得算錯或拋錯", () => {
    // 這種字串在真實資料裡不該出現，但預算計算不能因為一個壞字元就爆。
    expect(() => utf8ByteLength("\ud800")).not.toThrow();
    expect(utf8ByteLength("\ud800")).toBeGreaterThan(0);
  });
});
