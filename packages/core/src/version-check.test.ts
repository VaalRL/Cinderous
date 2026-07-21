import { describe, expect, it } from "vitest";
import { compareVersion, newerRelease } from "./version-check.js";

describe("compareVersion（ADR-0228）", () => {
  it("大小比較與相等", () => {
    expect(compareVersion("0.0.13", "0.0.12")).toBe(1);
    expect(compareVersion("0.0.12", "0.0.13")).toBe(-1);
    expect(compareVersion("0.0.13", "0.0.13")).toBe(0);
    expect(compareVersion("0.1.0", "0.0.99")).toBe(1);
    expect(compareVersion("1.0.0", "0.9.9")).toBe(1);
  });
  it("缺段補 0、非數字視為 0", () => {
    expect(compareVersion("1", "1.0.0")).toBe(0);
    expect(compareVersion("1.2", "1.2.0")).toBe(0);
    expect(compareVersion("x.y.z", "0.0.0")).toBe(0);
  });
});

describe("newerRelease（ADR-0228）", () => {
  it("有較新的已發布版本 → 回該版本", () => {
    expect(newerRelease([{ version: "0.0.14" }, { version: "0.0.13" }], "0.0.13")).toBe("0.0.14");
  });
  it("無較新 → null", () => {
    expect(newerRelease([{ version: "0.0.13" }, { version: "0.0.12" }], "0.0.13")).toBeNull();
  });
  it("未排序也取最大", () => {
    expect(newerRelease([{ version: "0.0.12" }, { version: "0.0.20" }, { version: "0.0.15" }], "0.0.13")).toBe("0.0.20");
  });
  it("released:false（hold 草稿）不算可更新", () => {
    expect(newerRelease([{ version: "0.0.14", released: false }, { version: "0.0.12" }], "0.0.13")).toBeNull();
    // 但同時有已發布較新版時仍回已發布者
    expect(
      newerRelease([{ version: "0.0.15", released: false }, { version: "0.0.14", released: true }], "0.0.13"),
    ).toBe("0.0.14");
  });
  it("空／格式不符 → null", () => {
    expect(newerRelease([], "0.0.13")).toBeNull();
    expect(newerRelease([{} as never], "0.0.13")).toBeNull();
  });
});
