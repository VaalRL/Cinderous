// 企業版頁（ADR-0246）：SSR 斷言封閉節點／名冊／離職接管／資料主權皆有渲染，且雙語。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Enterprise } from "./Enterprise.js";

describe("Enterprise 企業版頁（ADR-0246）", () => {
  it("zh 涵蓋封閉節點、名冊入職、離職接管（無金鑰託管）、資料主權", () => {
    const zh = renderToStaticMarkup(<Enterprise c={useCopy("zh-Hant")} />);
    expect(zh).toContain('data-testid="enterprise"');
    expect(zh).toContain("allowlist");
    expect(zh).toContain("名冊");
    expect(zh).toContain("無金鑰託管");
    expect(zh).toContain("資料主權");
  });

  it("en 涵蓋 closed relay、roster、offboarding、data sovereignty", () => {
    const en = renderToStaticMarkup(<Enterprise c={useCopy("en")} />);
    expect(en).toContain("closed relay");
    expect(en).toContain("roster");
    expect(en).toContain("no key escrow");
    expect(en).toContain("Data sovereignty");
  });
});
