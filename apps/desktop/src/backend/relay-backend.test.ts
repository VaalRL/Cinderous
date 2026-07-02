import { generateSecretKey, getPublicKey, wrapGroupMessage } from "@nostr-buddy/core";
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

  it("回應：Bob 對 Alice 的訊息按 emoji，Alice 收到 onReaction", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const aReactions: { mid: string; emoji: string; mine: boolean }[] = [];
    const bIncoming: ChatMessage[] = [];
    a.start({ ...noop, onReaction: (mid, emoji, mine) => aReactions.push({ mid, emoji, mine }) });
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    const mid = bIncoming[0]!.id;
    b.sendReaction(a.self.pubkey, mid, "👍");

    expect(aReactions).toContainEqual({ mid, emoji: "👍", mine: false });
    a.stop();
    b.stop();
  });

  it("群組（M9）：Alice 建群 + 送群訊，Bob 與 Carol 皆收到並帶 sender", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");

    const bGroups: string[] = [];
    const cGroups: string[] = [];
    const bMsgs: { pk: string; m: ChatMessage }[] = [];
    const cMsgs: { pk: string; m: ChatMessage }[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)), onMessage: (pk, m) => bMsgs.push({ pk, m }) });
    c.start({ ...noop, onGroups: (gs) => cGroups.push(...gs.map((g) => g.id)), onMessage: (pk, m) => cMsgs.push({ pk, m }) });

    a.createGroup("好友", [b.self.pubkey, c.self.pubkey]);
    // Bob、Carol 收到 group-create
    expect(bGroups.length).toBeGreaterThan(0);
    expect(cGroups.length).toBeGreaterThan(0);
    const gid = bGroups[0]!;

    a.sendGroupMessage(gid, "嗨大家");
    const bGot = bMsgs.find((x) => x.pk === gid && x.m.text === "嗨大家");
    const cGot = cMsgs.find((x) => x.pk === gid && x.m.text === "嗨大家");
    expect(bGot?.m.sender).toBe(a.self.pubkey);
    expect(cGot?.m.sender).toBe(a.self.pubkey);
    // Bob 端持久化群訊於 groupId 之下
    expect(storeB.loadMessages(gid).map((m) => m.text)).toContain("嗨大家");

    a.stop();
    b.stop();
    c.stop();
  });

  it("群組授權：非成員（含陌生人）的群訊被拒收（#3）", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bGroups: string[] = [];
    const bMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)), onMessage: (_pk, m) => bMsgs.push(m) });

    a.createGroup("私群", [b.self.pubkey]); // 成員僅 Alice、Bob
    const gid = bGroups[0]!;

    // 陌生人 Dave（非成員）自組同 id 群、對 Bob 扇出群訊
    const daveSk = generateSecretKey();
    const davePk = getPublicKey(daveSk);
    const fake = { id: gid, name: "x", admin: davePk, members: [davePk, b.self.pubkey] };
    const daveClient = net.connect("dave", { onEvent: () => {} });
    for (const evt of wrapGroupMessage("惡意群訊", daveSk, davePk, fake)) daveClient.publish(evt);

    // 合法成員 Alice 的群訊仍正常送達
    a.sendGroupMessage(gid, "正常");

    expect(bMsgs.some((m) => m.text === "正常")).toBe(true);
    expect(bMsgs.some((m) => m.text === "惡意群訊")).toBe(false); // Dave 非成員 → 被拒
    a.stop();
    b.stop();
  });

  it("群組授權：不在名單的 group-create 不會讓你入群（#1）", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bGroups: string[][] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(gs.map((g) => g.id)) });

    // Alice 建一個「不含 Bob」的群 → Bob 不應被加入
    const cSk = generateSecretKey();
    a.createGroup("沒有Bob", [getPublicKey(cSk)]);
    const joined = bGroups.flat();
    expect(joined.length).toBe(0);
    a.stop();
    b.stop();
  });

  it("收回：Alice 收回訊息，Bob 收到 onUnsend 並持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    const bUnsent: string[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m), onUnsend: (mid) => bUnsent.push(mid) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "誤傳");
    const mid = bIncoming[0]!.id;
    a.unsendMessage(b.self.pubkey, mid);

    expect(bUnsent).toContain(mid);
    expect(storeB.loadDeleted()).toContain(mid);
    a.stop();
    b.stop();
  });

  it("限時訊息：帶 ttl 送出，兩端訊息帶 expiresAt 且持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    const before = Date.now();
    a.sendMessage(b.self.pubkey, "閱後即焚", 60);

    // Bob 收到並帶到期時間（約 60 秒後）
    const got = bIncoming.find((m) => m.text === "閱後即焚");
    expect(got?.expiresAt).toBeDefined();
    expect(got!.expiresAt!).toBeGreaterThanOrEqual(before + 60_000 - 2_000);
    // Alice 端持久化亦帶 expiresAt
    expect(storeA.loadMessages(b.self.pubkey)[0]?.expiresAt).toBeDefined();
    a.stop();
    b.stop();
  });

  it("封鎖：被封鎖者的訊息不再送達，且進入封鎖名單", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const aIncoming: ChatMessage[] = [];
    const aBlocked: string[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m), onBlocked: (list) => (aBlocked.length = 0, aBlocked.push(...list.map((x) => x.pubkey))) });
    b.start(noop);

    a.blockContact(b.self.pubkey);
    b.sendMessage(a.self.pubkey, "你看得到嗎");

    expect(aIncoming.find((m) => m.text === "你看得到嗎")).toBeUndefined();
    expect(aBlocked).toContain(b.self.pubkey);
    expect(storeA.loadContacts().some((c) => c.pubkey === b.self.pubkey)).toBe(false);

    a.unblockContact(b.self.pubkey);
    expect(aBlocked).not.toContain(b.self.pubkey);
    a.stop();
    b.stop();
  });

  it("刪除聯絡人：清單移除、對話清空", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    expect(storeA.loadMessages(b.self.pubkey).length).toBe(1);

    a.removeContact(b.self.pubkey);
    expect(storeA.loadContacts().some((c) => c.pubkey === b.self.pubkey)).toBe(false);
    expect(storeA.loadMessages(b.self.pubkey)).toEqual([]);
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
