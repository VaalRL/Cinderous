import type { Contact } from "@cinderous/engine";
import { describe, expect, it } from "vitest";
import { createDemoChat } from "./chat.js";

describe("行動端消費 @cinderous/engine（ADR-0074 K2 跨前端重用實證）", () => {
  it("BrowserChatBackend 由 mobile 套件驅動：start 後同步收到聯絡人事件", () => {
    const chat = createDemoChat("Mobile 我");
    const contacts: Contact[] = [];
    chat.start({
      onContacts: (cs) => contacts.splice(0, contacts.length, ...cs),
      onMessage: () => {},
      onTyping: () => {},
      onNudge: () => {},
    });
    expect(contacts.length).toBeGreaterThan(0); // 引擎模擬的好友（證明引擎可跨前端運作）
    expect(chat.self.name).toBe("Mobile 我");
    chat.stop();
  });
});
