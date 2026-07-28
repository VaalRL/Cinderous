// 企業版頁（ADR-0246）：SSR 斷言封閉節點／名冊／離職接管／資料主權皆有渲染，且雙語。
// 「與常見選擇的差異」段（ADR-0255）：類別比較表＋誠實限制段＋比較頁互連。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Enterprise } from "./Enterprise.js";

describe("Enterprise 企業版頁（ADR-0246）", () => {
  it("zh 涵蓋封閉節點、名冊入職、離職接管（無金鑰託管）、資料主權", () => {
    const zh = renderToStaticMarkup(<Enterprise c={useCopy("zh-Hant")} locale="zh-Hant" />);
    expect(zh).toContain('data-testid="enterprise"');
    expect(zh).toContain("allowlist");
    expect(zh).toContain("名冊");
    expect(zh).toContain("無金鑰託管");
    expect(zh).toContain("資料主權");
  });

  it("en 涵蓋 closed relay、roster、offboarding、data sovereignty", () => {
    const en = renderToStaticMarkup(<Enterprise c={useCopy("en")} locale="en" />);
    expect(en).toContain("closed relay");
    expect(en).toContain("roster");
    expect(en).toContain("no key escrow");
    expect(en).toContain("Data sovereignty");
  });
});

describe("與常見選擇的差異（ADR-0255）", () => {
  it("類別比較表：三類對手欄＋五列隱私主權軸＋我方欄突顯", () => {
    const zh = renderToStaticMarkup(<Enterprise c={useCopy("zh-Hant")} locale="zh-Hant" />);
    expect(zh).toContain('data-testid="ent-compare-table"');
    expect(zh).toContain("雲端協作套件");
    expect(zh).toContain("Mattermost");
    expect(zh).toContain("Element");
    expect(zh).toContain("cmp__us");
    expect((zh.match(/scope="row"/g) ?? []).length).toBe(5);
  });

  it("🔴 誠實限制段：明示合規匯出設計上做不到、SSO/SCIM 未提供（誠實過濾客戶）", () => {
    const zh = renderToStaticMarkup(<Enterprise c={useCopy("zh-Hant")} locale="zh-Hant" />);
    expect(zh).toContain('data-testid="ent-compare-note"');
    expect(zh).toContain("無法匯出成員訊息明文");
    expect(zh).toContain("SSO");
    const en = renderToStaticMarkup(<Enterprise c={useCopy("en")} locale="en" />);
    expect(en).toContain("no one — including the org owner and us"); // 零知識＝連企業主也不能
    expect(en).toContain("SCIM");
  });

  it("互連：企業頁有連往比較頁的 locale-aware 連結", () => {
    const zh = renderToStaticMarkup(<Enterprise c={useCopy("zh-Hant")} locale="zh-Hant" />);
    expect(zh).toContain('href="/Cinderous/zh-Hant/compare/"');
    const en = renderToStaticMarkup(<Enterprise c={useCopy("en")} locale="en" />);
    expect(en).toContain('href="/Cinderous/compare/"');
  });
});
