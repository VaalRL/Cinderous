import { describe, expect, it, vi } from "vitest";
import { BrowserChatBackend } from "./browser-backend.js";
import type { ChatMessage, Contact } from "./types.js";

describe("BrowserChatBackend", () => {
  it("好友上線、夜貓子離線；送訊息會收到自動回覆", async () => {
    const backend = new BrowserChatBackend("我");
    let contacts: Contact[] = [];
    const incoming: ChatMessage[] = [];
    const outgoing: ChatMessage[] = [];
    backend.start({
      onContacts: (c) => {
        contacts = c;
      },
      onMessage: (_pk, m) => (m.outgoing ? outgoing : incoming).push(m),
      onTyping: () => {},
      onNudge: () => {},
    });

    const buddy = contacts.find((c) => c.name === "小幫手");
    expect(buddy?.status).toBe("online");
    expect(contacts.find((c) => c.name === "夜貓子")?.status).toBe("offline");

    backend.sendMessage(buddy!.pubkey, "hi");
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.outgoing).toBe(true);

    await vi.waitFor(() => expect(incoming.length).toBeGreaterThan(0), { timeout: 3000 });
    backend.stop();
  });
});
