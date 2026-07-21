import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version.js";

// ADR-0227 P2：__APP_VERSION__ 由 vite `define` 注入（源自 root package.json SSOT）。
// 這條同時驗證 define 在 vitest 也生效（否則 __APP_VERSION__ 未定義會直接拋錯）。
describe("APP_VERSION（ADR-0227 P2）", () => {
  it("注入為非空的 x.y.z 版號字串", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
