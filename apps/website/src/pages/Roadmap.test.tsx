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

  it("🔴 比較表得說「已實作」，但**永遠不得打勾**（ADR-0306 D2.2 的對等式界線）", () => {
    // ~~原斷言：cp_r9a 必須是「開發中」、比較表不得出現「實驗性」~~
    // → 規則已由「不得宣稱」改為「不得以**對等形式**宣稱」（D2.2）：
    //   誠實說「已實作（實驗性）」是可以的；不可以的是那個 ✓——
    //   在這張與 Signal 並列的表裡，✓ 的意思就是「同級」。
    const c = useCopy("zh-Hant");
    expect(c.cp_r9a).toContain("已實作");
    expect(c.cp_r9a).not.toContain("✓");
  });
});
