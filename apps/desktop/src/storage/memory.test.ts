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

  it("每對話訊息上限：超過即逐出最舊、保留最近（P0-1）", () => {
    const s = new MemoryStorage();
    for (let i = 0; i < MESSAGES_PER_CONVO + 5; i++) {
      s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    }
    const ids = s.loadMessages("aa").map((m) => m.id);
    expect(ids.length).toBe(MESSAGES_PER_CONVO);
    expect(ids[0]).toBe("m5"); // m0..m4 被逐出
    expect(ids[ids.length - 1]).toBe(`m${MESSAGES_PER_CONVO + 4}`);
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
