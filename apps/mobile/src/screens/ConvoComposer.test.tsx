// 行動端對話輸入列（ADR-0169 批次二）：限時訊息（閱後即焚）切換鈕**只在 1:1** 出現
// （群組扇出不帶 ttl）。互動（循環效期、送出帶 ttl）由引擎 TTL 契約把關；SSR 這裡驗
// **條件渲染**是否正確——避免群組誤顯示一個按了也沒用的燒毀鈕。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "Bob",
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
  messages: [],
};

describe("行動端限時訊息切換鈕（ADR-0169）", () => {
  it("1:1 對話 → 顯示燒毀切換鈕（burn-toggle）", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(html).toContain('data-testid="burn-toggle"');
  });

  it("群組對話 → 不顯示燒毀鈕（sendGroupMessage 不帶 ttl）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen
        {...base}
        name="專案群"
        groupMembers={["pk_me", "pk_bob"]}
        selfPubkey="pk_me"
        nameFor={(pk) => (pk === "pk_me" ? "我" : "Bob")}
      />,
    );
    expect(html).not.toContain('data-testid="burn-toggle"');
  });

  it("初始 ttl=0 → 不顯示作用中提示（burn-label）", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(html).not.toContain('data-testid="burn-label"');
  });
});

describe("行動端企業頭銜 chip（ADR-0170）", () => {
  it("1:1 對方帶頭銜 → 標頭顯示 chip 與頭銜文字", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} title="工程師" />);
    expect(html).toContain('data-testid="convo-title-chip"');
    expect(html).toContain("工程師");
  });

  it("未帶頭銜 → 無 chip", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(html).not.toContain('data-testid="convo-title-chip"');
  });

  it("群組不顯示頭銜 chip（頭銜是 1:1 對象語意）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen
        {...base}
        name="專案群"
        title="工程師"
        groupMembers={["pk_me", "pk_bob"]}
        selfPubkey="pk_me"
        nameFor={(pk) => (pk === "pk_me" ? "我" : "Bob")}
      />,
    );
    expect(html).not.toContain('data-testid="convo-title-chip"');
  });
});

describe("行動端對話輔助面板入口（ADR-0183）", () => {
  it("標頭恆有 📋 輔助面板鈕（媒體/對話串/便條）", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(html).toContain('data-testid="aux-btn"');
    // 面板內容在點開後才渲染（auxOpen 為互動狀態，SSR 不展開）——與成員/背景面板一致。
    expect(html).not.toContain('data-testid="aux-panel"');
  });
});

describe("行動端存入公司儲存槽鈕（ADR-0177）", () => {
  it("提供 onDepositSlot（企業成員）→ 顯示 🗄 存入鈕", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} onDepositSlot={() => {}} />);
    expect(html).toContain('data-testid="deposit-slot"');
  });

  it("未提供（非企業成員）→ 不顯示存入鈕", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(html).not.toContain('data-testid="deposit-slot"');
  });
});
