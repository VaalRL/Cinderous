import { describe, expect, it } from "vitest";
import { indentText } from "./composer-indent.js";

describe("Composer Tab 縮排", () => {
  it("無選取：游標處插入 2 空白、游標後移", () => {
    expect(indentText("ab", 1, 1, false)).toEqual({ text: "a  b", start: 3, end: 3 });
  });

  it("單行選取：以縮排取代選取", () => {
    expect(indentText("abcd", 1, 3, false)).toEqual({ text: "a  d", start: 3, end: 3 });
  });

  it("跨行選取：逐行縮排、空行跳過、選取範圍跟著平移", () => {
    const r = indentText("a\n\nb", 0, 4, false);
    expect(r.text).toBe("  a\n\n  b");
    expect(r.start).toBe(2);
    expect(r.end).toBe(8);
  });

  it("Shift+Tab：逐行退排（tab 或最多 2 空白），已無縮排的行不變", () => {
    const r = indentText("  a\n\tb\nc", 0, 8, true);
    expect(r.text).toBe("a\nb\nc");
  });

  it("Shift+Tab 單游標：退排目前行", () => {
    const r = indentText("  abc", 4, 4, true);
    expect(r.text).toBe("abc");
    expect(r.start).toBe(2);
  });
});
