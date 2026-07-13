import { applyRosterRotations, generateSecretKey, getPublicKey, type NostrEvent, npubEncode, nsecEncode, signOrgRoster, wrapGroupControl, wrapGroupMessage } from "@cinder/core";
import { createInMemoryRelayNetwork } from "@cinder/relay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("NIP-42 AUTH（ADR-0057）：requireAuth 下兩端仍能對話（自動認證 + 認證後訂閱）", () => {
    const net = createInMemoryRelayNetwork({ requireAuth: true });
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "authed 嗨");

    // 認證透明完成：Bob 仍收到訊息、雙方持久化
    expect(bIncoming.map((m) => m.text)).toContain("authed 嗨");
    expect(storeB.loadMessages(a.self.pubkey).map((m) => m.text)).toEqual(["authed 嗨"]);
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

  it("群組成員管理（M9）：管理者加入新成員→其實例化群；移除成員→該成員退群", () => {
    const net = createInMemoryRelayNetwork();
    const storeC = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(storeC, (h) => net.connect("c", h), "Carol");
    const bGroups: string[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });
    c.start(noop);

    a.createGroup("小群", [b.self.pubkey]); // 僅 Alice、Bob
    const gid = bGroups[0]!;
    expect(storeC.loadGroups()).toEqual([]); // Carol 尚未在群

    // 加入 Carol → Carol 端實例化該群、成員含三人
    a.addGroupMember(gid, c.self.pubkey);
    const cg = storeC.loadGroups().find((g) => g.id === gid);
    expect(cg?.members).toContain(c.self.pubkey);
    expect(cg?.members).toContain(b.self.pubkey);

    // 移除 Carol → Carol 端退出該群
    a.removeGroupMember(gid, c.self.pubkey);
    expect(storeC.loadGroups().find((g) => g.id === gid)).toBeUndefined();

    a.stop();
    b.stop();
    c.stop();
  });

  it("群組成員管理：組織群（org）拒絕手動增/移成員（名冊權威，ADR-0049）", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    // 身分即為 orgAdmin；採用自己名冊的組織群（org:true）。
    store.saveIdentity({ nsec: nsecEncode(adminSk), name: "Admin" });
    const backend = new RelayChatBackend(store, (h) => net.connect("admin", h), "Admin", { orgAdminPubkey: admin });
    backend.start(noop);
    const other = getPublicKey(generateSecretKey());
    backend.publishRoster("Acme", [{ pubkey: admin, name: "Admin" }], undefined, [
      { id: "dept", name: "部門", members: [admin] },
    ]);
    expect(store.loadGroups().find((g) => g.id === "dept")?.org).toBe(true);

    // 手動加人/移人皆被拒（成員清單不變）。
    backend.addGroupMember("dept", other);
    expect(store.loadGroups().find((g) => g.id === "dept")?.members).not.toContain(other);
    backend.removeGroupMember("dept", admin);
    expect(store.loadGroups().find((g) => g.id === "dept")?.members).toContain(admin);
    backend.stop();
  });

  it("群組成員管理：非管理者呼叫 add 無效", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bGroups: string[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });
    a.createGroup("小群", [b.self.pubkey]);
    const gid = bGroups[0]!;
    const dave = getPublicKey(generateSecretKey());
    b.addGroupMember(gid, dave); // Bob 非管理者
    expect(storeB.loadGroups().find((g) => g.id === gid)?.members).not.toContain(dave);
    a.stop();
    b.stop();
  });

  it("對話串（ADR-0051）：Alice 對 Bob 的回覆帶 replyTo，Bob 收到並持久化", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bMsgs.push(m) });

    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "串回覆", undefined, undefined, "root-1");

    const got = bMsgs.find((m) => m.text === "串回覆");
    expect(got?.replyTo).toBe("root-1");
    expect(storeB.loadMessages(a.self.pubkey).find((m) => m.text === "串回覆")?.replyTo).toBe("root-1");
    a.stop();
    b.stop();
  });

  it("@提及（ADR-0050）：Alice 群訊提及 Bob，Bob 收到 mentionsMe，Carol 沒有", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");

    const bGroups: string[] = [];
    const bMsgs: ChatMessage[] = [];
    const cMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)), onMessage: (_pk, m) => bMsgs.push(m) });
    c.start({ ...noop, onMessage: (_pk, m) => cMsgs.push(m) });

    a.createGroup("好友", [b.self.pubkey, c.self.pubkey]);
    const gid = bGroups[0]!;
    a.sendGroupMessage(gid, "@Bob 看這個", [b.self.pubkey]);

    expect(bMsgs.find((m) => m.text === "@Bob 看這個")?.mentionsMe).toBe(true);
    expect(cMsgs.find((m) => m.text === "@Bob 看這個")?.mentionsMe).toBeUndefined();

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
    for (const evt of wrapGroupMessage("惡意群訊", daveSk, davePk, fake).events) daveClient.publish(evt);

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

  it("啟動回放：歷史以 onHistory 批次交付、回放期間不逐則 onMessage（P0-2）", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", h), "Bob");
    bob.start(noop);
    const a1 = new RelayChatBackend(store, (h) => net.connect("a1", h), "Alice");
    a1.start(noop);
    a1.addContact(bob.selfNpub);
    a1.sendMessage(bob.self.pubkey, "一");
    a1.sendMessage(bob.self.pubkey, "二");
    a1.stop();

    const history: { pk: string; ids: string[] }[] = [];
    const live: string[] = [];
    const a2 = new RelayChatBackend(store, (h) => net.connect("a2", h), "Alice");
    a2.start({
      ...noop,
      onHistory: (pk, msgs) => history.push({ pk, ids: msgs.map((m) => m.id) }),
      onMessage: (_pk, m) => live.push(m.id),
    });
    const conv = history.find((h) => h.pk === bob.self.pubkey);
    expect(conv?.ids.length).toBe(2); // 一次批次交付兩則
    expect(live).toEqual([]); // 回放不逐則 onMessage
    a2.stop();
    bob.stop();
  });

  it("工作身分自動採用管理者名冊、匯入通訊錄並撤銷離職者（ADR-0047）", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    const work = new RelayChatBackend(store, (h) => net.connect("work", h), "Worker", { orgAdminPubkey: admin });
    work.start(noop);
    const memberA = getPublicKey(generateSecretKey());
    const memberB = getPublicKey(generateSecretKey());

    net
      .connect("admin")
      .publish(signOrgRoster({ org: "Acme", members: [{ pubkey: memberA, name: "Alice" }, { pubkey: memberB, name: "Bob" }], updatedAt: 1000 }, adminSk));
    expect(store.loadContacts().map((c) => c.pubkey).sort()).toEqual([memberA, memberB].sort());

    // 較新名冊移除 Bob（離職）→ 撤銷聯絡人
    net.connect("admin2").publish(signOrgRoster({ org: "Acme", members: [{ pubkey: memberA, name: "Alice" }], updatedAt: 1001 }, adminSk));
    expect(store.loadContacts().map((c) => c.pubkey)).toEqual([memberA]);
    work.stop();
  });

  it("身分輪替（ADR-0052）：舊 npub→新 npub，歷史接續、通訊錄換人、觸發 onIdentityRotated", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    const rotations: { from: string; to: string; name: string }[] = [];
    const work = new RelayChatBackend(store, (h) => net.connect("work", h), "Worker", { orgAdminPubkey: admin });
    work.start({ ...noop, onIdentityRotated: (from, to, name) => rotations.push({ from, to, name }) });

    const aliceOld = getPublicKey(generateSecretKey());
    const aliceNew = getPublicKey(generateSecretKey());

    // v1：Alice 舊身分入通訊錄，並模擬既有對話歷史
    net.connect("admin").publish(signOrgRoster({ org: "Acme", members: [{ pubkey: aliceOld, name: "Alice" }], updatedAt: 1000 }, adminSk));
    expect(store.loadContacts().map((c) => c.pubkey)).toEqual([aliceOld]);
    store.appendMessage({ id: "m1", contact: aliceOld, outgoing: false, text: "早安", at: 1 });
    // 並模擬一個含 Alice 的群組與其群訊（驗證群成員與 sender 標籤一併 remap）
    store.saveGroup({ id: "grp", name: "研發", admin, members: [aliceOld, work.self.pubkey] });
    store.appendMessage({ id: "gm1", contact: "grp", outgoing: false, text: "群訊", at: 2, sender: aliceOld });

    // v2：Alice 輪替 aliceOld → aliceNew（舊標 supersededBy、新加入）
    net.connect("admin2").publish(
      signOrgRoster(
        {
          org: "Acme",
          members: [{ pubkey: aliceOld, name: "Alice", supersededBy: aliceNew }, { pubkey: aliceNew, name: "Alice" }],
          updatedAt: 1001,
        },
        adminSk,
      ),
    );

    expect(store.loadContacts().map((c) => c.pubkey)).toEqual([aliceNew]); // 通訊錄換成新 npub
    expect(store.loadMessages(aliceOld)).toEqual([]); // 舊對話已搬走
    expect(store.loadMessages(aliceNew).map((m) => m.id)).toEqual(["m1"]); // 歷史接續到新 npub
    expect(store.loadGroups().find((g) => g.id === "grp")?.members).toEqual([aliceNew, work.self.pubkey]); // 群成員 remap
    expect(store.loadMessages("grp").find((m) => m.id === "gm1")?.sender).toBe(aliceNew); // 群訊發送者標籤 remap
    expect(rotations).toEqual([{ from: aliceOld, to: aliceNew, name: "Alice" }]); // UI 通知
    work.stop();
  });

  it("佈建輪替（ADR-0052 #3）：管理者以 applyRosterRotations 發布、成員端接續、allowlist 只放行新 npub", () => {
    const net = createInMemoryRelayNetwork();
    const admin = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("admin", h), "Admin");
    admin.start(noop);

    const aliceOld = getPublicKey(generateSecretKey());
    const aliceNew = getPublicKey(generateSecretKey());

    // 成員端事先認得 Alice 舊身分（既有聯絡人＋歷史）——建構前先播種，建構子即載入。
    const memberStore = new MemoryStorage();
    memberStore.addContact({ pubkey: aliceOld, name: "Alice" });
    memberStore.appendMessage({ id: "m1", contact: aliceOld, outgoing: false, text: "hi", at: 1 });
    const rotations: { from: string; to: string }[] = [];
    const member = new RelayChatBackend(memberStore, (h) => net.connect("member", h), "Member", {
      orgAdminPubkey: admin.self.pubkey,
    });
    member.start({ ...noop, onIdentityRotated: (from, to) => rotations.push({ from, to }) });

    // 管理者用佈建輔助建立輪替名冊並發布；回傳 allowlist 只含新 npub。
    const rotated = applyRosterRotations([{ pubkey: aliceOld, name: "Alice" }], [{ from: aliceOld, to: aliceNew }]);
    const allow = admin.publishRoster("Acme", rotated);
    expect(allow).toContain(aliceNew);
    expect(allow).not.toContain(aliceOld); // 舊金鑰不再放行

    // 成員端接續：通訊錄換新、歷史搬移、觸發通知。
    expect(memberStore.loadContacts().map((c) => c.pubkey)).toEqual([aliceNew]);
    expect(memberStore.loadMessages(aliceNew).map((m) => m.id)).toEqual(["m1"]);
    expect(rotations).toEqual([{ from: aliceOld, to: aliceNew }]);
    admin.stop();
    member.stop();
  });

  it("addContact 擋加自己作用中身分（ADR-0055 self-guard）", () => {
    const net = createInMemoryRelayNetwork();
    const store = new MemoryStorage();
    const backend = new RelayChatBackend(store, (h) => net.connect("me", h), "Me");
    backend.start(noop);
    backend.addContact(npubEncode(backend.self.pubkey)); // 加自己
    expect(store.loadContacts()).toEqual([]); // 未新增自己
    backend.stop();
  });
  it("管理者佈建：publishRoster 發布名冊、成員自動採用、回傳 allowlist（ADR-0047 收尾）", () => {
    const net = createInMemoryRelayNetwork();
    const admin = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("admin", h), "Admin");
    admin.start(noop);
    const memberStore = new MemoryStorage();
    const member = new RelayChatBackend(memberStore, (h) => net.connect("member", h), "Member", {
      orgAdminPubkey: admin.self.pubkey,
    });
    member.start(noop);

    const alice = getPublicKey(generateSecretKey());
    const allow = admin.publishRoster("Acme", [{ pubkey: alice, name: "Alice" }]);
    expect(allow).toContain(alice); // 回傳供 relay allowlist 佈建的 pubkey
    expect(memberStore.loadContacts().map((c) => c.pubkey)).toContain(alice); // 成員自動採用
    admin.stop();
    member.stop();
  });
  it("組織群組（ADR-0049）：名冊帶群→成員自動入群；公告群非管理者發文被擋", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    const member = new RelayChatBackend(store, (h) => net.connect("member", h), "Member", { orgAdminPubkey: admin });
    member.start(noop);
    const memberPk = member.self.pubkey;

    net.connect("admin").publish(
      signOrgRoster(
        {
          org: "Acme",
          members: [{ pubkey: memberPk, name: "M" }],
          groups: [{ id: "notice", name: "公告", members: [admin, memberPk], announce: true }],
          updatedAt: 1000,
        },
        adminSk,
      ),
    );

    // 成員自動入公告群
    expect(store.loadGroups().map((g) => g.id)).toContain("notice");
    expect(store.loadGroups().find((g) => g.id === "notice")?.announce).toBe(true);
    // 成員（非管理者）對公告群發文被擋 → 不持久化
    member.sendGroupMessage("notice", "我不該能發");
    expect(store.loadMessages("notice")).toEqual([]);
    member.stop();
  });
  it("企業政策（ADR-0048）：採用帶 forceTurn 的名冊 → onPolicy 收到 forceTurn（驅動 WebRTC relay-only）", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    let got: { forceTurn?: boolean } | undefined;
    const member = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("m", h), "M", { orgAdminPubkey: admin });
    member.start({ ...noop, onPolicy: (p) => { got = p; } });

    net.connect("admin").publish(
      signOrgRoster(
        {
          org: "Acme",
          members: [{ pubkey: member.self.pubkey, name: "M" }],
          policy: { forceTurn: true },
          updatedAt: 1000,
        },
        adminSk,
      ),
    );

    expect(got?.forceTurn).toBe(true);
    member.stop();
  });

  it("組織群組（ADR-0049）：管理者自建臨時群不因採用自己的名冊而被誤刪", () => {
    const net = createInMemoryRelayNetwork();
    const adminSk = generateSecretKey();
    const admin = getPublicKey(adminSk);
    const store = new MemoryStorage();
    // 讓後端身分即為管理者（self === orgAdminPubkey），重現管理者自身情境。
    store.saveIdentity({ nsec: nsecEncode(adminSk), name: "Admin" });
    const backend = new RelayChatBackend(store, (h) => net.connect("admin", h), "Admin", { orgAdminPubkey: admin });
    backend.start(noop);

    // 管理者自建一個臨時群（非組織名冊分發）。
    backend.createGroup("午餐團", [getPublicKey(generateSecretKey())]);
    const adhocId = store.loadGroups().find((g) => g.name === "午餐團")?.id;
    expect(adhocId).toBeTruthy();

    // 發布只含組織群「dept」的名冊——本機立即對帳。
    backend.publishRoster("Acme", [{ pubkey: admin, name: "Admin" }], undefined, [
      { id: "dept", name: "部門", members: [admin] },
    ]);

    const ids = store.loadGroups().map((g) => g.id);
    expect(ids).toContain("dept"); // 組織群已在本機生效
    expect(ids).toContain(adhocId); // 臨時群未被誤刪
    backend.stop();
  });
});

describe("送達/已讀回條（ADR-0058）", () => {
  const pair = () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    return { storeA, a, b };
  };

  it("Tier1+2：送出 → sent → delivered（同步網路一次到位）", () => {
    const { storeA, a, b } = pair();
    const statuses: string[] = [];
    a.start({ ...noop, onMessageStatus: (_c, _id, s) => statuses.push(s) });
    b.start(noop);
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    expect(storeA.loadMessages(b.self.pubkey)[0]?.status).toBe("delivered");
    expect(statuses).toContain("sent");
    expect(statuses).toContain("delivered");
    a.stop();
    b.stop();
  });

  it("Tier3：雙方開啟已讀 → markRead 後升為 read", () => {
    const { storeA, a, b } = pair();
    a.start(noop);
    b.start(noop);
    a.setReadReceipts?.(true);
    b.setReadReceipts?.(true);
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    b.markRead?.(a.self.pubkey);
    expect(storeA.loadMessages(b.self.pubkey)[0]?.status).toBe("read");
    a.stop();
    b.stop();
  });

  it("Tier3 互惠：a 關閉已讀 → 對方 markRead 不會升為 read（停在 delivered）", () => {
    const { storeA, a, b } = pair();
    a.start(noop);
    b.start(noop);
    b.setReadReceipts?.(true); // 只有 b 開；a 預設關
    a.addContact(b.selfNpub);
    a.sendMessage(b.self.pubkey, "hi");
    b.markRead?.(a.self.pubkey);
    expect(storeA.loadMessages(b.self.pubkey)[0]?.status).toBe("delivered");
    a.stop();
    b.stop();
  });
});

describe("群組快照廣播（ADR-0068）", () => {
  it("nsec 換機後：管理員重啟開機廣播，成員新裝置自動重建群組", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice");
    const b1 = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b1", h), "Bob");
    a1.start(noop);
    b1.start(noop);
    a1.addContact(b1.selfNpub);
    a1.createGroup("讀書會", [b1.self.pubkey]);
    const gid = storeA.loadGroups()[0]!.id;
    a1.stop();
    b1.stop();

    // Bob 換機：全新儲存、同一把 nsec——群組不會自己長回來
    const storeB2 = new MemoryStorage();
    storeB2.saveIdentity({ nsec: b1.selfNsec, name: "Bob" });
    const b2 = new RelayChatBackend(storeB2, (h) => net.connect("b2", h), "Bob");
    b2.start(noop);
    expect(b2.self.pubkey).toBe(b1.self.pubkey);
    expect(storeB2.loadGroups()).toEqual([]);

    // 管理員重啟 → 開機快照廣播 → Bob 新裝置重建群組（名稱/成員/admin 正確）
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice");
    a2.start(noop);
    const restored = storeB2.loadGroups().find((g) => g.id === gid);
    expect(restored?.name).toBe("讀書會");
    expect(restored?.admin).toBe(a2.self.pubkey);
    expect(restored?.members).toContain(b2.self.pubkey);
    a2.stop();
    b2.stop();
  });

  it("假快照防護：前成員偽造快照不得改動既有群組（admin/名稱/成員不變）", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");
    a.start(noop);
    b.start(noop);
    c.start(noop);
    a.addContact(b.selfNpub);
    a.addContact(c.selfNpub);
    a.createGroup("好友", [b.self.pubkey, c.self.pubkey]);
    const gid = storeB.loadGroups()[0]!.id;

    // Carol（知道群組 id 的成員）偽造快照：自立為 admin、踢掉 Alice
    const carolSk = (c as unknown as { sk: Uint8Array }).sk;
    const forged = wrapGroupControl(
      { type: "group-snapshot", id: gid, name: "被劫持", admin: c.self.pubkey, members: [c.self.pubkey, b.self.pubkey] },
      carolSk,
      [b.self.pubkey],
    );
    net.connect("forger", {}).publish(forged[0]!);

    const g = storeB.loadGroups().find((x) => x.id === gid)!;
    expect(g.admin).toBe(a.self.pubkey);
    expect(g.name).toBe("好友");
    expect(g.members).toContain(a.self.pubkey);
    a.stop();
    b.stop();
    c.stop();
  });
});

describe("加密雲端快照（ADR-0071）", () => {
  it("換機還原：舊機開啟完整模式重啟發佈快照，新裝置自動合併聯絡人/群組/訊息", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a1.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });
    a1.addContact(b.selfNpub);
    a1.sendMessage(b.self.pubkey, "重要對話");
    a1.createGroup("讀書會", [b.self.pubkey]);
    a1.stop();

    // Alice 的新裝置（白紙）先上線訂閱自己的快照（接收合併恆開、不需設定）
    const storeA3 = new MemoryStorage();
    storeA3.saveIdentity({ nsec: a1.selfNsec, name: "Alice" });
    const a3 = new RelayChatBackend(storeA3, (h) => net.connect("a3", h), "Alice");
    const a3History: Record<string, ChatMessage[]> = {};
    let a3Mode: string | undefined;
    a3.start({ ...noop, onHistory: (pk, msgs) => (a3History[pk] = msgs), onCloudSyncMode: (m) => (a3Mode = m) });
    expect(storeA3.loadContacts()).toHaveLength(0);

    // 舊機開啟雲端快照（完整）重啟 → 開機發佈 → 新裝置即時合併
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice", {
      cloudSync: { mode: "full", deviceId: "desk" },
    });
    a2.start(noop);

    expect(storeA3.loadContacts().map((c) => c.pubkey)).toContain(b.self.pubkey);
    expect(storeA3.loadGroups().map((g) => g.name)).toContain("讀書會");
    expect(storeA3.loadMessages(b.self.pubkey).map((m) => m.text)).toContain("重要對話");
    expect(a3History[b.self.pubkey]?.map((m) => m.text)).toContain("重要對話"); // UI 歷史重放
    expect(a3Mode).toBe("full"); // 模式隨快照傳播（審查修正 #1：App 端於未設定時採用）
    a2.stop();
    a3.stop();
    b.stop();
  });

  it("關閉狀態對帳（審查修正 #6）：曾發佈快照、關閉後下次開機補發 purge", () => {
    const kv = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => kv.get(k) ?? null,
      setItem: (k: string, v: string) => void kv.set(k, v),
      removeItem: (k: string) => void kv.delete(k),
    };
    try {
      kv.set("nb.deviceId", "dev"); // 對帳與發佈使用同一裝置 id
      const net = createInMemoryRelayNetwork();
      const storeA = new MemoryStorage();
      const spied: NostrEvent[] = [];
      const spy = net.connect("spy", { onEvent: (_s, e) => spied.push(e) });
      spy.subscribe("s", [{ kinds: [30078] } as never]);

      const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice", {
        cloudSync: { mode: "basic", deviceId: "dev" },
      });
      a1.start(noop);
      a1.stop();
      expect(spied.filter((e) => e.content !== "")).toHaveLength(1); // 開機發佈（節流已記錄）

      // 使用者切關（假設 purge 因競態沒送出）→ 下次開機對帳補發
      const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice");
      a2.start(noop);
      a2.stop();
      expect(spied.some((e) => e.content === "")).toBe(true); // purge 補發
      expect([...kv.keys()].some((k) => k.startsWith("nb.snapPub."))).toBe(false); // 節流記錄清除
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });

  it("基本模式不含訊息；快照事件對第三者只是密文", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a1 = new RelayChatBackend(storeA, (h) => net.connect("a1", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a1.start(noop);
    b.start(noop);
    a1.addContact(b.selfNpub);
    a1.sendMessage(b.self.pubkey, "祕密內容");
    a1.stop();

    // 側錄快照事件（開放模式無 AUTH——密文本身就是防線）
    const spied: NostrEvent[] = [];
    const spy = net.connect("spy", { onEvent: (_s, e) => spied.push(e) });
    spy.subscribe("s", [{ kinds: [30078] } as never]);

    const storeA3 = new MemoryStorage();
    storeA3.saveIdentity({ nsec: a1.selfNsec, name: "Alice" });
    const a3 = new RelayChatBackend(storeA3, (h) => net.connect("a3", h), "Alice");
    a3.start(noop);
    const a2 = new RelayChatBackend(storeA, (h) => net.connect("a2", h), "Alice", {
      cloudSync: { mode: "basic", deviceId: "desk" },
    });
    a2.start(noop);

    // 基本模式：聯絡人回來了、訊息沒有
    expect(storeA3.loadContacts().map((c) => c.pubkey)).toContain(b.self.pubkey);
    expect(storeA3.loadMessages(b.self.pubkey)).toHaveLength(0);
    // 第三者只見密文
    expect(spied.length).toBeGreaterThan(0);
    expect(JSON.stringify(spied)).not.toContain("祕密內容");
    expect(JSON.stringify(spied)).not.toContain(b.self.pubkey.slice(0, 16));
    a2.stop();
    a3.stop();
    b.stop();
  });
});

describe("顯示名稱個人檔（ADR-0061，加密廣播）", () => {
  it("單向加好友即互換個人檔：雙方顯示對方自選暱稱（非 npub）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub); // 只有 A 主動加 B
    // B 自動加入 A 並學到「Alice」、回送個人檔 → A 也學到「Bob」
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.name).toBe("Alice");
    expect(storeA.loadContacts().find((c) => c.pubkey === b.self.pubkey)?.name).toBe("Bob");
    a.stop();
    b.stop();
  });
});

describe("群組送達/已讀分級（ADR-0095）", () => {
  it("小群（≤10）：成員收到群訊後回送達回條，發訊者記錄「誰送達」（每成員回條表）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("c", h), "Carol");
    const bGroups: string[] = [];
    const aReceipts: { messageId: string; receipts: Record<string, string> }[] = [];
    a.start({ ...noop, onMessageReceipts: (_g, messageId, receipts) => aReceipts.push({ messageId, receipts }) });
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });
    c.start(noop);

    a.createGroup("小群", [b.self.pubkey, c.self.pubkey]); // 3 人＝名單制
    const gid = bGroups[0]!;
    a.sendGroupMessage(gid, "嗨大家");

    // Bob、Carol 各自回一則送達回條 → Alice 端記錄兩位成員都已送達。
    const stored = storeA.loadMessages(gid).find((m) => m.outgoing);
    expect(stored?.receipts?.[b.self.pubkey]).toBe("delivered");
    expect(stored?.receipts?.[c.self.pubkey]).toBe("delivered");
    expect(aReceipts.length).toBeGreaterThan(0); // UI 有收到更新

    a.stop();
    b.stop();
    c.stop();
  });

  it("群訊 id 跨成員一致：收件端存的 id＝發訊者存的 id（回條才對得回來）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bGroups: string[] = [];
    a.start(noop);
    b.start({ ...noop, onGroups: (gs) => bGroups.push(...gs.map((g) => g.id)) });

    a.createGroup("兩人群", [b.self.pubkey]);
    const gid = bGroups[0]!;
    a.sendGroupMessage(gid, "同一則");

    const aId = storeA.loadMessages(gid).find((m) => m.outgoing)?.id;
    const bId = storeB.loadMessages(gid).find((m) => !m.outgoing)?.id;
    expect(aId).toBeDefined();
    expect(bId).toBe(aId); // 內層 rumor id（ADR-0095）

    a.stop();
    b.stop();
  });

  it("大群（>10）：完全不記——成員不回送達回條，發訊者沒有任何每成員回條", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    // 11 人群（含自己）→ mode = off
    const members: RelayChatBackend[] = [];
    for (let i = 0; i < 10; i++) {
      members.push(new RelayChatBackend(new MemoryStorage(), (h) => net.connect(`m${i}`, h), `M${i}`));
    }
    const firstGroups: string[] = [];
    a.start(noop);
    members.forEach((m, i) =>
      m.start(i === 0 ? { ...noop, onGroups: (gs) => firstGroups.push(...gs.map((g) => g.id)) } : noop),
    );

    a.createGroup("大群", members.map((m) => m.self.pubkey));
    const gid = firstGroups[0]!;
    a.sendGroupMessage(gid, "公告");

    const stored = storeA.loadMessages(gid).find((m) => m.outgoing);
    expect(stored?.text).toBe("公告"); // 訊息本身照常送達
    expect(stored?.receipts).toBeUndefined(); // 但完全不記回條（連送達都不送）

    a.stop();
    members.forEach((m) => m.stop());
  });
});

describe("檔案投遞與另存（ADR-0093）", () => {
  // 最小 RTCPeerConnection 樁：讓 sendFile 的 P2P 建連不拋錯。本測試只驗**中繼 metadata** 流程，
  // 不驗實際 P2P 位元組傳輸（node 無真實 WebRTC）——故收件端會停在「metadata-only／在另一台裝置」。
  class FakeDataChannel {
    readyState = "connecting";
    binaryType = "";
    onmessage: unknown = null;
    onopen: unknown = null;
    onerror: unknown = null;
    send(): void {}
    close(): void {}
  }
  class FakePeerConnection {
    onicecandidate: unknown = null;
    onconnectionstatechange: unknown = null;
    ondatachannel: unknown = null;
    connectionState = "new";
    createDataChannel(): FakeDataChannel {
      return new FakeDataChannel();
    }
    async createOffer(): Promise<{ type: string; sdp: string }> {
      return { type: "offer", sdp: "" };
    }
    async createAnswer(): Promise<{ type: string; sdp: string }> {
      return { type: "answer", sdp: "" };
    }
    async setLocalDescription(): Promise<void> {}
    async setRemoteDescription(): Promise<void> {}
    async addIceCandidate(): Promise<void> {}
    close(): void {}
  }
  beforeEach(() => vi.stubGlobal("RTCPeerConnection", FakePeerConnection));
  afterEach(() => vi.unstubAllGlobals());

  it("送檔另發加密 metadata 訊息：對方裝置知道有檔案（G1），雙方持久化 file metadata（無位元組）", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const aMsgs: ChatMessage[] = [];
    const bMsgs: ChatMessage[] = [];
    const bBytes: { messageId: string; name: string }[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aMsgs.push(m) });
    b.start({
      ...noop,
      onMessage: (_pk, m) => bMsgs.push(m),
      onFileBytes: (_pk, id, f) => bBytes.push({ messageId: id, name: f.name }),
    });

    a.addContact(b.selfNpub);
    const tid = a.sendFile(b.self.pubkey, { name: "report.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3, 4]) });

    // 送出端：emit + 持久化 outgoing 檔案訊息（file.id=tid、無文字）。
    const aFile = aMsgs.find((m) => m.file);
    expect(aFile?.file).toMatchObject({ id: tid, name: "report.pdf", size: 4, incoming: false });
    expect(aFile?.text).toBe("");
    const aStored = storeA.loadMessages(b.self.pubkey).find((m) => m.file);
    expect(aStored?.file).toMatchObject({ tid, name: "report.pdf", size: 4, mime: "application/pdf" });

    // 收件端：B 收到加密 metadata → 知道有檔案（G1）；P2P 位元組未達 → sent=0（在另一台裝置）。
    const bFile = bMsgs.find((m) => m.file);
    expect(bFile?.file).toMatchObject({ name: "report.pdf", size: 4, incoming: true, sent: 0 });
    const bStored = storeB.loadMessages(a.self.pubkey).find((m) => m.file);
    expect(bStored?.file).toMatchObject({ tid, name: "report.pdf", size: 4 });
    expect(bStored?.file?.savedPath).toBeUndefined();
    expect(bBytes).toHaveLength(0); // 位元組未經 P2P 到達，onFileBytes 不觸發
    // 中繼看不到檔名（metadata 在加密內層）——比照一般訊息，此處僅確認 B 端解密後才有。
    a.stop();
    b.stop();
  });

  it("送出端原檔路徑（ADR-0103）：原生選檔帶入 savedPath → 自己送出的圖片重載後也讀得回原圖", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);

    a.sendFile(
      b.self.pubkey,
      { name: "cat.png", mime: "image/png", bytes: new Uint8Array([1, 2]) },
      { thumb: "data:image/jpeg;base64,AAAA", savedPath: "D:/圖片/cat.png" },
    );

    const sent = storeA.loadMessages(b.self.pubkey).find((m) => m.outgoing && m.file);
    expect(sent?.file?.savedPath).toBe("D:/圖片/cat.png"); // 過去送出端永遠沒有路徑
    expect(sent?.file?.thumb).toBe("data:image/jpeg;base64,AAAA");
    a.stop();
    b.stop();
  });

  it("瀏覽器路徑（無 savedPath）：仍正常送出，只是沒有原檔路徑", () => {
    const net = createInMemoryRelayNetwork();
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    a.sendFile(b.self.pubkey, { name: "x.bin", mime: "application/octet-stream", bytes: new Uint8Array([9]) });
    const sent = storeA.loadMessages(b.self.pubkey).find((m) => m.outgoing && m.file);
    expect(sent?.file?.name).toBe("x.bin");
    expect(sent?.file?.savedPath).toBeUndefined();
    a.stop();
    b.stop();
  });

  it("setFileSavedPath：回填收檔路徑並持久化（重載後仍見路徑）", () => {
    const net = createInMemoryRelayNetwork();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
    const bMsgs: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bMsgs.push(m) });

    a.addContact(b.selfNpub);
    a.sendFile(b.self.pubkey, { name: "photo.jpg", mime: "image/jpeg", bytes: new Uint8Array([9, 9]) });
    const bFile = bMsgs.find((m) => m.file);
    expect(bFile).toBeDefined();

    b.setFileSavedPath(a.self.pubkey, bFile!.id, "/home/bob/photo.jpg");
    expect(storeB.loadMessages(a.self.pubkey).find((m) => m.file)?.file?.savedPath).toBe("/home/bob/photo.jpg");
    a.stop();
    b.stop();
  });
});
