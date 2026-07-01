import { createInMemoryRelayNetwork } from "@nostr-buddy/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import { RelayChatBackend } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

describe("RelayChatBackend（真實後端 + 持久化）", () => {
  it("兩端經 relay 對話，收件端自動加入寄件人、雙方持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");

    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "嗨 Bob");

    // B 收到（真實 Gift Wrap 解密）
    expect(bIncoming.map((m) => m.text)).toContain("嗨 Bob");
    // A 端持久化 outgoing
    expect(storeA.loadMessages(b.self.pubkey).map((m) => m.text)).toEqual(["嗨 Bob"]);
    // B 自動加入 A 為聯絡人並持久化 incoming
    expect(storeB.loadContacts().map((c) => c.pubkey)).toContain(a.self.pubkey);
    expect(storeB.loadMessages(a.self.pubkey).map((m) => m.text)).toEqual(["嗨 Bob"]);

    a.stop();
    b.stop();
  });

  it("身分持久化：以同一儲存重建後端 → npub 不變、歷史保留", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const a1 = new RelayChatBackend(store, (h) => net.connect("a1", h), "Alice");
    const npub1 = a1.selfNpub;
    a1.start(noop);
    a1.addContact(new RelayChatBackend(new MemoryStorage(), (h) => net.connect("x", h), "X").selfNpub);
    a1.stop();

    const a2 = new RelayChatBackend(store, (h) => net.connect("a2", h), "Alice");
    expect(a2.selfNpub).toBe(npub1);
    expect(store.loadContacts().length).toBe(1);
    a2.stop();
  });
});
