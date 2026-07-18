// 行動端內嵌回覆（ADR-0136）：回覆＝帶 NIP-10 reply e-tag 的普通訊息（core thread.ts、後端已備）。
// 手機用**內嵌引用**（Signal/LINE 風），非桌面的討論串面板——同一個 replyTo 欄位、平台各自呈現。
// 送出/長按選單需互動（行動端純 SSR），這裡驗 SSR 可斷言的**引用預覽**渲染。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@cinderous/engine";
import { ConversationScreen } from "./ConversationScreen.js";

const base = {
  name: "Bob",
  onSend: () => {},
  onBack: () => {},
  locale: "zh-Hant" as const,
  nameFor: (pk: string) => (pk === "pk_me" ? "我" : "Bob"),
  groupMembers: ["pk_me", "pk_bob"],
  selfPubkey: "pk_me",
};

const root: ChatMessage = { id: "r1", outgoing: false, sender: "pk_bob", text: "晚上要開會嗎", at: 1 };
const reply: ChatMessage = { id: "m2", outgoing: true, text: "好啊", at: 2, replyTo: "r1" };

describe("行動端內嵌回覆引用（ADR-0136）", () => {
  it("回覆訊息 → 顯示被回覆訊息的引用（含摘要）", () => {
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[root, reply]} />);
    expect(html).toContain('data-testid="reply-quote-m2"');
    expect(html).toContain("晚上要開會嗎"); // 引用了根訊息的內容
  });

  it("引用的根訊息不在熱區（找不到）→ 不顯示引用，不當掉", () => {
    const orphan: ChatMessage = { id: "m3", outgoing: true, text: "回一則舊訊息", at: 3, replyTo: "gone-root" };
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[orphan]} />);
    expect(html).not.toContain('data-testid="reply-quote-m3"');
  });

  it("引用一則已收回的訊息 → 引用顯示「已收回」而非原文", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[root, reply]} unsent={new Set(["r1"])} />,
    );
    expect(html).toContain('data-testid="reply-quote-m2"');
    expect(html).not.toContain("晚上要開會嗎"); // 被收回 → 引用不得洩漏原文
  });

  it("引用一則檔案訊息 → 引用顯示檔名", () => {
    const fileRoot: ChatMessage = {
      id: "f1",
      outgoing: false,
      sender: "pk_bob",
      text: "",
      at: 1,
      file: { id: "x", name: "報告.pdf", mime: "application/pdf", size: 10, sent: 10, incoming: true },
    };
    const r: ChatMessage = { id: "m4", outgoing: true, text: "收到", at: 2, replyTo: "f1" };
    const html = renderToStaticMarkup(<ConversationScreen {...base} messages={[fileRoot, r]} />);
    expect(html).toContain('data-testid="reply-quote-m4"');
    expect(html).toContain("報告.pdf");
  });

  it("回覆訊息本身被收回 → 不顯示引用（收回後不留殘影）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[root, reply]} unsent={new Set(["m2"])} />,
    );
    expect(html).not.toContain('data-testid="reply-quote-m2"');
  });
});
