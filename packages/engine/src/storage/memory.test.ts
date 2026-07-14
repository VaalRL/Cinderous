import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";
import { MESSAGES_PER_CONVO } from "./types.js";

describe("MemoryStorage", () => {
  it("身分讀寫", () => {
    const s = new MemoryStorage();
    expect(s.loadIdentity()).toBeNull();
    s.saveIdentity({ nsec: "nsec1x", name: "Alice" });
    expect(s.loadIdentity()).toEqual({ nsec: "nsec1x", name: "Alice" });
  });

  it("聯絡人去重", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "A" });
    s.addContact({ pubkey: "aa", name: "A2" });
    s.addContact({ pubkey: "bb", name: "B" });
    expect(s.loadContacts().map((c) => c.pubkey)).toEqual(["aa", "bb"]);
  });

  it("訊息按聯絡人分流、以 id 去重", () => {
    const s = new MemoryStorage();
    s.appendMessage({ id: "m1", contact: "aa", outgoing: true, text: "hi", at: 1 });
    s.appendMessage({ id: "m1", contact: "aa", outgoing: true, text: "hi", at: 1 });
    s.appendMessage({ id: "m2", contact: "aa", outgoing: false, text: "yo", at: 2 });
    s.appendMessage({ id: "m3", contact: "bb", outgoing: true, text: "b", at: 3 });
    expect(s.loadMessages("aa").map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(s.loadMessages("bb").map((m) => m.id)).toEqual(["m3"]);
  });

  it("刪除聯絡人會一併清除其對話", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "A" });
    s.appendMessage({ id: "m1", contact: "aa", outgoing: true, text: "hi", at: 1 });
    s.removeContact("aa");
    expect(s.loadContacts()).toEqual([]);
    expect(s.loadMessages("aa")).toEqual([]);
  });

  it("刪除聯絡人會清理其訊息的孤兒 reactions/deleted（P1-5）", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "A" });
    s.appendMessage({ id: "m1", contact: "aa", outgoing: false, text: "hi", at: 1 });
    s.appendMessage({ id: "m2", contact: "bb", outgoing: false, text: "yo", at: 2 });
    s.addReaction({ id: "r1", messageId: "m1", emoji: "👍", mine: true });
    s.addReaction({ id: "r2", messageId: "m2", emoji: "❤", mine: false });
    s.markDeleted("m1");
    s.markDeleted("m2");
    s.removeContact("aa");
    // m1 的孤兒被清、m2（bb 的）保留
    expect(s.loadReactions().map((r) => r.messageId)).toEqual(["m2"]);
    expect(s.loadDeleted()).toEqual(["m2"]);
  });

  it("預設無上限（ADR-0094）：不逐出、全部保留", () => {
    const s = new MemoryStorage(); // 預設 0＝無上限
    for (let i = 0; i < MESSAGES_PER_CONVO + 50; i++) {
      s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    }
    expect(s.loadMessages("aa").length).toBe(MESSAGES_PER_CONVO + 50);
  });

  it("有限模式：超過設定上限即逐出最舊、保留最近（P0-1／ADR-0094）", () => {
    const s = new MemoryStorage(MESSAGES_PER_CONVO);
    for (let i = 0; i < MESSAGES_PER_CONVO + 5; i++) {
      s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    }
    const ids = s.loadMessages("aa").map((m) => m.id);
    expect(ids.length).toBe(MESSAGES_PER_CONVO);
    expect(ids[0]).toBe("m5"); // m0..m4 被逐出
    expect(ids[ids.length - 1]).toBe(`m${MESSAGES_PER_CONVO + 4}`);
  });

  it("setMaxPerConvo：調小上限即時逐出既有；調回 0 之後不再逐出", () => {
    const s = new MemoryStorage(); // 無上限
    for (let i = 0; i < 20; i++) s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    s.setMaxPerConvo(5); // 立即逐出到剩 5 最新
    expect(s.loadMessages("aa").map((m) => m.id)).toEqual(["m15", "m16", "m17", "m18", "m19"]);
    s.setMaxPerConvo(0); // 回無上限：不再逐出，之後可累積
    for (let i = 20; i < 30; i++) s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    expect(s.loadMessages("aa").length).toBe(15);
  });

  it("remapContact（ADR-0052）：搬移對話歷史、去重、按時間排序、移除舊聯絡人", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "old", name: "Alice" });
    s.appendMessage({ id: "m1", contact: "old", outgoing: false, text: "早", at: 1 });
    s.appendMessage({ id: "m2", contact: "old", outgoing: true, text: "安", at: 3 });
    s.appendMessage({ id: "m0", contact: "new", outgoing: true, text: "既有", at: 2 }); // new 對話已有一則
    s.remapContact("old", "new");
    expect(s.loadContacts().map((c) => c.pubkey)).toEqual([]); // 舊聯絡人移除（new 由名冊補上）
    expect(s.loadMessages("old")).toEqual([]);
    const moved = s.loadMessages("new");
    expect(moved.map((m) => m.id)).toEqual(["m1", "m0", "m2"]); // 併入並依 at 排序
    expect(moved.every((m) => m.contact === "new")).toBe(true); // contact 欄位改寫
  });

  it("remapContact（ADR-0052）：群組成員 from→to 去重", () => {
    const s = new MemoryStorage();
    s.saveGroup({ id: "g", name: "研發", admin: "admin", members: ["old", "new", "bob"] });
    s.remapContact("old", "new");
    expect(s.loadGroups().find((g) => g.id === "g")?.members).toEqual(["new", "bob"]); // old→new 併入、不重複
  });

  it("remapContact（ADR-0052）：群訊發送者標籤 from→to 改寫、他人不受影響", () => {
    const s = new MemoryStorage();
    s.saveGroup({ id: "g", name: "研發", admin: "admin", members: ["old", "bob"] });
    s.appendMessage({ id: "gm1", contact: "g", outgoing: false, text: "嗨", at: 1, sender: "old" });
    s.appendMessage({ id: "gm2", contact: "g", outgoing: false, text: "你好", at: 2, sender: "bob" });
    s.remapContact("old", "new");
    const msgs = s.loadMessages("g");
    expect(msgs.find((m) => m.id === "gm1")?.sender).toBe("new"); // old 的群訊改標新身分
    expect(msgs.find((m) => m.id === "gm2")?.sender).toBe("bob"); // 其他發送者不受影響
    expect(s.loadGroups().find((g) => g.id === "g")?.members).toEqual(["new", "bob"]); // 成員也 remap
  });

  it("封鎖：移出聯絡人、記入封鎖名單、可解除", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "A" });
    s.blockContact({ pubkey: "aa", name: "A" });
    expect(s.loadContacts()).toEqual([]);
    expect(s.loadBlocked().map((b) => b.pubkey)).toEqual(["aa"]);
    s.unblockContact("aa");
    expect(s.loadBlocked()).toEqual([]);
  });
});

describe("已讀水位（ADR-0108）", () => {
  it("預設為空；設定後可讀回", () => {
    const s = new MemoryStorage();
    expect(s.loadReadAt()).toEqual({});
    s.setReadAt("bob", 1000);
    expect(s.loadReadAt()).toEqual({ bob: 1000 });
  });

  it("**單調遞增**：倒退的水位一律忽略（否則已讀過的訊息會再冒出紅點）", () => {
    const s = new MemoryStorage();
    s.setReadAt("bob", 5000);
    s.setReadAt("bob", 3000); // 倒退 → 忽略
    expect(s.loadReadAt()["bob"]).toBe(5000);
    s.setReadAt("bob", 7000); // 前進 → 採用
    expect(s.loadReadAt()["bob"]).toBe(7000);
  });

  it("水位隨快照往返（配對搬家換機時帶得走已讀狀態）", () => {
    const a = new MemoryStorage();
    a.setReadAt("bob", 1234);
    a.setReadAt("group-1", 5678);
    const b = new MemoryStorage();
    b.importSnapshot(a.exportSnapshot());
    expect(b.loadReadAt()).toEqual({ bob: 1234, "group-1": 5678 });
  });

  it("匯入**舊快照**（沒有 readAt 欄位）不會炸，水位退回空", () => {
    const s = new MemoryStorage();
    s.setReadAt("bob", 999);
    const legacy = { ...s.exportSnapshot() };
    delete (legacy as { readAt?: unknown }).readAt; // 模擬 ADR-0108 之前存下的快照
    expect(() => s.importSnapshot(legacy)).not.toThrow();
    expect(s.loadReadAt()).toEqual({});
  });
});

describe("批次狀態/回條（ADR-0110）", () => {
  const msg = (id: string, outgoing: boolean, at: number) => ({ id, contact: "bob", outgoing, text: id, at });

  it("setMessageStatusBulk 只前進、回傳實際有變的 id", () => {
    const s = new MemoryStorage();
    s.appendMessage({ ...msg("a", true, 1), status: "sent" as const });
    s.appendMessage({ ...msg("b", true, 2), status: "read" as const }); // 已是 read → 不倒退
    s.appendMessage(msg("c", true, 3)); // 無狀態（sending）
    const changed = s.setMessageStatusBulk("bob", ["a", "b", "c", "不存在"], "read");
    expect(changed.sort()).toEqual(["a", "c"]);
    expect(s.loadMessages("bob").map((m) => m.status)).toEqual(["read", "read", "read"]);
  });

  it("setMessageReceiptBulk 逐成員累積，回傳有更新者的完整回條表", () => {
    const s = new MemoryStorage();
    s.appendMessage({ ...msg("a", true, 1), contact: "g1" });
    s.appendMessage({ ...msg("b", true, 2), contact: "g1" });
    const out = s.setMessageReceiptBulk("g1", ["a", "b"], "carol", "delivered");
    expect(out.get("a")).toEqual({ carol: "delivered" });
    // 同一則再升級為 read（只前進）
    const up = s.setMessageReceiptBulk("g1", ["a"], "carol", "read");
    expect(up.get("a")).toEqual({ carol: "read" });
    // 已是 read → 不再回報變更
    expect(s.setMessageReceiptBulk("g1", ["a"], "carol", "delivered").size).toBe(0);
  });

  it("逐出（保留上限）必須同步清掉 id 索引——否則會留下指向已逐出訊息的幽靈", () => {
    const s = new MemoryStorage(2);
    s.appendMessage(msg("a", false, 1));
    s.appendMessage(msg("b", false, 2));
    s.appendMessage(msg("c", false, 3)); // a 被逐出
    expect(s.loadMessages("bob").map((m) => m.id)).toEqual(["b", "c"]);
    // 索引若沒清，setMessageStatus("a") 會改到一個已不在 list 裡的物件（靜默無效）
    s.setMessageStatus("bob", "a", "read");
    expect(s.loadMessages("bob").some((m) => m.id === "a")).toBe(false);
    // 且被逐出的 id 可以重新加入（索引沒殘留就不會被誤判為重複）
    s.appendMessage(msg("a", false, 4));
    expect(s.loadMessages("bob").map((m) => m.id)).toEqual(["c", "a"]);
  });
});
