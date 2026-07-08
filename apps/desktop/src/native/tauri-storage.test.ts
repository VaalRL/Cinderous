import { describe, expect, it } from "vitest";
import type { StorageSnapshot } from "../storage/types.js";
import { type StoreIo, TauriStorage } from "./tauri-storage.js";

/** 記憶體 fake IO：模擬 Rust 加密 blob 的 load/save（以 namespace 為鍵）。 */
function fakeIo(): { io: StoreIo; store: Map<string, string>; saveCount: () => number } {
  const store = new Map<string, string>();
  let saves = 0;
  const io: StoreIo = {
    load: async (ns) => store.get(ns) ?? null,
    save: async (ns, json) => {
      store.set(ns, json);
      saves += 1;
    },
  };
  return { io, store, saveCount: () => saves };
}

describe("TauriStorage 加密儲存基質（B2，ADR-0054）", () => {
  it("hydrate 從既有快照載入既有狀態", async () => {
    const { io, store } = fakeIo();
    const snap: StorageSnapshot = {
      identity: { nsec: "n", name: "me" },
      contacts: [{ pubkey: "a", name: "Alice" }],
      blocked: [],
      messages: { a: [{ id: "m1", contact: "a", outgoing: false, text: "hi", at: 1 }] },
      reactions: [],
      deleted: [],
      groups: [],
      bootstrapList: null,
    };
    store.set("ns1", JSON.stringify(snap));

    const s = new TauriStorage("ns1", io);
    await s.hydrate();
    expect(s.loadIdentity()).toEqual({ nsec: "n", name: "me" });
    expect(s.loadContacts().map((c) => c.pubkey)).toEqual(["a"]);
    expect(s.loadMessages("a").map((m) => m.id)).toEqual(["m1"]);
  });

  it("寫入 → flush → 加密持久化，可由新實例 hydrate 還原", async () => {
    const { io } = fakeIo();
    const s = new TauriStorage("ns2", io);
    await s.hydrate(); // 空

    s.saveIdentity({ nsec: "n2", name: "Bob" });
    s.addContact({ pubkey: "b", name: "Bob 好友" });
    s.appendMessage({ id: "m1", contact: "b", outgoing: true, text: "yo", at: 1 });
    s.saveGroup({ id: "g", name: "研發", admin: "admin", members: ["b"] });
    await s.flush();

    // 另一實例同 namespace hydrate，應完整還原
    const s2 = new TauriStorage("ns2", io);
    await s2.hydrate();
    expect(s2.loadIdentity()).toEqual({ nsec: "n2", name: "Bob" });
    expect(s2.loadContacts().map((c) => c.pubkey)).toEqual(["b"]);
    expect(s2.loadMessages("b").map((m) => m.id)).toEqual(["m1"]);
    expect(s2.loadGroups().map((g) => g.id)).toEqual(["g"]);
  });

  it("純讀取 + 無待寫時 flush 不觸發 save", async () => {
    const { io, saveCount } = fakeIo();
    const s = new TauriStorage("ns3", io);
    await s.hydrate();
    s.loadContacts();
    s.loadGroups();
    await s.flush();
    expect(saveCount()).toBe(0);
  });
});
