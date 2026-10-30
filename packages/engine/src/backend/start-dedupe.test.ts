// 重開不重複交付（ADR-0404 §2 揭露）：已存的訊息必須在**訂閱掛上之前**就進去重集合。
//
// 訂閱一掛上，中繼就可能立刻把收件匣推過來（記憶體網路是同步送達，跟 `hydrateFileIndex` 同一個理由）。
// 去重集合若還沒建好，同一則就會再走一次 `onMessage`——CLI 的 agent 會對同一則訊息再處理一次。
import { generateSecretKey, nsecEncode } from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe("重開不重複交付", () => {
  it("🔴 同一份儲存重開：中繼補推的舊訊息不再進 onMessage（只走 onHistory）", async () => {
    const net = createInMemoryRelayNetwork({ store: new MessageStore() });
    const alice = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("alice", h), "Alice", {});
    alice.start(noop);
    const bobStore = new MemoryStorage();
    bobStore.saveIdentity({ nsec: nsecEncode(generateSecretKey()), name: "Bob" });

    const bob1 = new RelayChatBackend(bobStore, (h) => net.connect("bob1", h), "Bob", {});
    const first: ChatMessage[] = [];
    bob1.start({ ...noop, onMessage: (_c, m) => first.push(m) });
    bob1.addContact(alice.selfNpub);
    alice.addContact(bob1.selfNpub);
    alice.sendMessage(bob1.self.pubkey, "嗨");
    await settle();
    expect(first.map((m) => m.text)).toEqual(["嗨"]);
    bob1.stop();

    const bob2 = new RelayChatBackend(bobStore, (h) => net.connect("bob2", h), "Bob", {});
    const again: ChatMessage[] = [];
    const history: ChatMessage[] = [];
    bob2.start({ ...noop, onMessage: (_c, m) => again.push(m), onHistory: (_c, ms) => history.push(...ms) });
    await settle();
    expect(again).toEqual([]);
    expect(history.map((m) => m.text)).toEqual(["嗨"]);
    bob2.stop();
    alice.stop();
  });
});
