import type { MessageArchive, StoredMessage } from "@cinderous/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationScreen } from "./ConversationScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";

/** 空封存替身（SSR 渲染不跑 effect，故只驗靜態結構；分頁邏輯在 engine 已測）。 */
const emptyArchive: MessageArchive = {
  append: () => Promise.resolve(),
  chunkCount: () => Promise.resolve(0),
  loadChunk: () => Promise.resolve([] as StoredMessage[]),
  remove: () => Promise.resolve(),
};

describe("行動端歷史紀錄（ADR-0111）", () => {
  it("渲染標題與對話名（en）", () => {
    const html = renderToStaticMarkup(
      <HistoryScreen name="Bob" convo="bob" archive={emptyArchive} selfLabel="Me" onBack={() => {}} locale="en" />,
    );
    expect(html).toContain("History"); // translate(en, history_title)
    expect(html).toContain("Bob");
  });

  it("對話畫面：**有封存才顯示** 🗄 入口", () => {
    const base = { name: "Bob", messages: [], onSend: () => {}, onBack: () => {}, locale: "en" as const };
    const without = renderToStaticMarkup(<ConversationScreen {...base} />);
    expect(without).not.toContain("🗄");

    const withHistory = renderToStaticMarkup(<ConversationScreen {...base} onHistory={() => {}} />);
    expect(withHistory).toContain("🗄");
  });
});

describe("行動端訊息操作：回應／收回（NIP-25 / NIP-09）", () => {
  const base = { name: "Bob", onSend: () => {}, onBack: () => {}, locale: "en" as const };
  const msg = (id: string, outgoing: boolean) => ({ id, outgoing, text: `文字-${id}`, at: 1 });

  it("**已收回的訊息絕不顯示原文**——收回的意義就在這裡", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("m1", true)]} unsent={new Set(["m1"])} />,
    );
    expect(html).not.toContain("文字-m1");
    expect(html).toContain("(unsent)"); // translate(en, msg_unsent)
  });

  it("已收回的訊息不顯示狀態圖示（沒有東西可回報）", () => {
    const withStatus = [{ ...msg("m1", true), status: "read" as const }];
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={withStatus} unsent={new Set(["m1"])} />,
    );
    expect(html).not.toContain("文字-m1");
  });

  it("渲染收到的 emoji 回應", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("m1", false)]} reactions={{ m1: ["👍", "🎉"] }} />,
    );
    expect(html).toContain("👍");
    expect(html).toContain("🎉");
  });

  it("已收回的訊息不顯示其回應（訊息都沒了）", () => {
    const html = renderToStaticMarkup(
      <ConversationScreen {...base} messages={[msg("m1", true)]} reactions={{ m1: ["👍"] }} unsent={new Set(["m1"])} />,
    );
    expect(html).not.toContain("👍");
  });
});
