import { describe, expect, it } from "vitest";
import { applyEmoticons } from "./emoticons.js";

describe("表情短碼轉換", () => {
  it("常見短碼轉為 emoji", () => {
    expect(applyEmoticons(":)")).toBe("🙂");
    expect(applyEmoticons(":D")).toBe("😄");
    expect(applyEmoticons(";)")).toBe("😉");
    expect(applyEmoticons(":(")).toBe("🙁");
    expect(applyEmoticons("<3")).toBe("❤️");
    expect(applyEmoticons("(y)")).toBe("👍");
  });

  it("帶連字號變體與 :'( 皆可轉換", () => {
    expect(applyEmoticons(":-)")).toBe("🙂");
    expect(applyEmoticons(":-D")).toBe("😄");
    expect(applyEmoticons(":'(")).toBe("😢");
  });

  it("句中的短碼也會轉換、其他文字保留", () => {
    expect(applyEmoticons("下班囉 :) 明天見")).toBe("下班囉 🙂 明天見");
  });

  it("多個短碼一次處理", () => {
    expect(applyEmoticons(":) <3 :D")).toBe("🙂 ❤️ 😄");
  });

  it("純文字不受影響", () => {
    expect(applyEmoticons("hello world")).toBe("hello world");
  });

  it("較長變體不會被較短的破壞（:-) 不變成 🙂-)）", () => {
    expect(applyEmoticons(":-)")).toBe("🙂");
    expect(applyEmoticons(":-(")).toBe("🙁");
  });
});
