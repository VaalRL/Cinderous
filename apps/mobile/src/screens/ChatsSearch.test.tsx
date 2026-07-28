// 聊天清單搜尋（ADR-0256 階段 4）：搜尋框存在＋比對邏輯與桌面共用（引擎 search-util，該處已測）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatListEntry } from "../chat-list.js";
import { ChatsListScreen } from "./ChatsListScreen.js";

const entries: ChatListEntry[] = [
  { id: "p1", name: "Amy", isGroup: false, status: "online", lastText: "晚餐約週五", lastAt: 1000, lastOutgoing: false, unread: 0 },
];

describe("聊天清單搜尋（ADR-0256 階段 4）", () => {
  it("清單頂端有搜尋框（名稱＋訊息內容，與桌面同一套引擎比對）", () => {
    const html = renderToStaticMarkup(<ChatsListScreen entries={entries} onOpen={() => {}} now={2000} locale="zh-Hant" />);
    expect(html).toContain('data-testid="chats-search"');
    expect(html).toContain("搜尋（名稱或訊息）");
    expect(html).toContain("Amy"); // 空查詢＝全列
  });
});
