// 行動端 @提及（ADR-0133）：送出側的建議/解析全用 @cinderous/core 的純函式（已在
// packages/core/src/mention-suggest.test.ts、mention.test.ts 驗過）。這裡驗**行動端新加的可視行為**：
// 收到「提及你」的訊息要凸顯（徽章＋主色邊條）；沒被提及的不凸顯。SSR 即可斷言。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@cinderous/engine";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "專案群",
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
  nameFor: (pk: string) => (pk === "pk_me" ? "我" : "Bob"),
  groupMembers: ["pk_me", "pk_bob"],
  selfPubkey: "pk_me",
};

const mentioned: ChatMessage = { id: "m1", outgoing: false, sender: "pk_bob", text: "@我 來看一下", at: 1, mentionsMe: true };
const plain: ChatMessage = { id: "m2", outgoing: false, sender: "pk_bob", text: "午安", at: 1 };

describe("行動端 @提及凸顯（ADR-0133）", () => {
  it("被提及的訊息 → 顯示「@提及你」徽章", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[mentioned]} />);
    expect(html).toContain('data-testid="mention-badge-m1"');
  });

  it("沒被提及的訊息 → 沒有徽章", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[plain]} />);
    expect(html).not.toContain("mention-badge-");
  });

  it("已收回的提及訊息 → 不再凸顯（收回後不得留任何殘影）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[mentioned]} unsent={new Set(["m1"])} />,
    );
    expect(html).not.toContain("mention-badge-m1");
  });

  it("提供 mentionCandidates 不影響初始渲染（草稿空 → 尚無建議列）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[plain]} mentionCandidates={[{ pubkey: "pk_bob", name: "Bob" }]} />,
    );
    expect(html).not.toContain('data-testid="mention-pk_bob"');
  });
});
