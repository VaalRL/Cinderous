import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";

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
});
