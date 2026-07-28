// 清單搜尋共用邏輯（ADR-0256 階段 4）：自桌面 deck-sidebar 上移，桌面兩佈局＋行動端共用。
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./types.js";
import { nameOrMessagesMatch } from "./search-util.js";

const convos: Record<string, ChatMessage[]> = {
  bb: [{ id: "1", outgoing: false, text: "晚餐約週五", at: 1 } as ChatMessage],
};

describe("nameOrMessagesMatch（ADR-0256）", () => {
  it("名稱命中（大小寫不敏感）", () => {
    expect(nameOrMessagesMatch("Amy", "bb", "amy", convos)).toBe(true);
    expect(nameOrMessagesMatch("Amy", "bb", "AMY", {})).toBe(true);
  });
  it("訊息內容命中", () => {
    expect(nameOrMessagesMatch("Amy", "bb", "週五", convos)).toBe(true);
    expect(nameOrMessagesMatch("Amy", "cc", "週五", convos)).toBe(false); // 別的對話不算
  });
  it("空查詢＝全中；查無＝false", () => {
    expect(nameOrMessagesMatch("Amy", "bb", "  ", convos)).toBe(true);
    expect(nameOrMessagesMatch("Amy", "bb", "早餐", convos)).toBe(false);
  });
});
