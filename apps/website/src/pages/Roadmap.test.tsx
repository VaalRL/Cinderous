// 藍圖頁的前向保密狀態（ADR-0306 D2）：可以**陳述事實**，不得**當賣點宣稱**。
//
// 這組測試鎖的是 ADR-0306 §3 的那條線——「官網功能表打勾＋小字」是遮羞布，
// 「藍圖頁的事實陳述」才是誠實。兩者的差別在**位置**與**措辭**，不在有沒有揭露。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCopy } from "../copy.js";
import { Compare } from "./Compare.js";
import { Roadmap } from "./Roadmap.js";

const zh = () => renderToStaticMarkup(<Roadmap c={useCopy("zh-Hant")} />);
const en = () => renderToStaticMarkup(<Roadmap c={useCopy("en")} />);

describe("藍圖頁：前向保密的事實陳述（ADR-0306 D2）", () => {
  it("有這一格，且 zh/en 都有", () => {
    expect(zh()).toContain('data-testid="roadmap-fs"');
    expect(en()).toContain('data-testid="roadmap-fs"');
  });

  it("🔴 必須寫明「未經外部審計」——這是這一格存在的理由", () => {
    expect(zh()).toContain("外部");
    expect(zh()).toContain("審計");
    expect(en().toLowerCase()).toContain("audit");
  });

  it("🔴 必須寫明可以在設定中提前啟用（否則使用者不知道它在哪）", () => {
    expect(zh()).toContain("設定");
    expect(en().toLowerCase()).toContain("settings");
  });

  it("🔴 不得用打勾／已完成之類的成就記號（那是賣點措辭，不是事實陳述）", () => {
    const out = zh();
    // 取出這一格的內容再檢查，避免誤判頁面其他區塊。
    const cell = out.slice(out.indexOf('data-testid="roadmap-fs"'));
    const box = cell.slice(0, cell.indexOf("</div>"));
    expect(box).not.toContain("✓");
    expect(box).not.toContain("✅");
  });

  it("🔴 比較表那格不得因此鬆動（ADR-0245 硬閘仍在，ADR-0306 D2 更嚴格）", () => {
    // 藍圖頁誠實陳述 ≠ 可以在比較表宣稱。兩者是不同的表面。
    const c = useCopy("zh-Hant");
    expect(c.cp_r9a).toBe("開發中");
    expect(renderToStaticMarkup(<Compare c={c} locale="zh-Hant" />)).not.toContain("實驗性");
  });
});
