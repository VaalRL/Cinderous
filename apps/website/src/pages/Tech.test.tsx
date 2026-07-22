// 技術原理頁：威脅防護介紹卡（ADR-0231 P4）——主打純本地比對、URL 不外送、可自訂可關。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Tech } from "./Tech.js";

describe("Tech 威脅防護介紹（ADR-0231 P4）", () => {
  it("zh/en 都有介紹卡並強調純本地與不送 URL", () => {
    const zh = renderToStaticMarkup(<Tech c={useCopy("zh-Hant")} />);
    expect(zh).toContain('data-testid="tech-threat"');
    expect(zh).toContain("純本地");
    expect(zh).toContain("URLhaus");
    const en = renderToStaticMarkup(<Tech c={useCopy("en")} />);
    expect(en).toContain("never sent to any server");
  });
});
