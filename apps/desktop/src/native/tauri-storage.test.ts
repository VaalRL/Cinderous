import { describe, expect, it } from "vitest";
import type { StorageSnapshot } from "@cinder/engine";
import { type StoreIo, TauriStorage } from "./tauri-storage.js";

/**
 * 記憶體 fake IO：模擬 Rust 的加密落地。
 * `store` 是舊格式整包（以 namespace 為鍵）；`parts` 是分部位（ADR-0110，`ns|part` 為鍵）。
 */
function fakeIo(): {
  io: StoreIo;
  store: Map<string, string>;
  parts: Map<string, string>;
  saveCount: () => number;
  partWrites: () => string[];
} {
  const store = new Map<string, string>();
  const parts = new Map<string, string>();
  const written: string[] = [];
  let saves = 0;
  const io: StoreIo = {
    load: async (ns) => store.get(ns) ?? null,
    save: async (ns, json) => {
      store.set(ns, json);
      saves += 1;
    },
    loadParts: async (ns) => {
      const out: Record<string, string> = {};
      for (const [k, v] of parts) {
        const [keyNs, part] = k.split("|");
        if (keyNs === ns && part) out[part] = v;
      }
      return out;
    },
    savePart: async (ns, part, json) => {
      parts.set(`${ns}|${part}`, json);
      written.push(part);
    },
    removePart: async (ns, part) => {
      parts.delete(`${ns}|${part}`);
    },
  };
  return { io, store, parts, saveCount: () => saves, partWrites: () => written };
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

describe("分部位持久化（ADR-0110）", () => {
  const msg = (id: string, contact: string) => ({ id, contact, outgoing: false, text: id, at: 1 });

  it("**只重寫變動的部位**——改一個對話不會把其他對話全部重新序列化＋加密＋寫檔", async () => {
    const { io, partWrites } = fakeIo();
    const s = new TauriStorage("ns", io);
    await s.hydrate();
    s.appendMessage(msg("a1", "alice"));
    s.appendMessage(msg("b1", "bob"));
    await s.flush();

    const before = partWrites().length;
    s.appendMessage(msg("a2", "alice")); // 只動 alice
    await s.flush();
    const written = partWrites().slice(before);
    expect(written).toEqual(["msgs.alice"]); // 不含 msgs.bob、不含 meta
  });

  it("meta 與訊息分開：改聯絡人不會重寫任何對話", async () => {
    const { io, partWrites } = fakeIo();
    const s = new TauriStorage("ns", io);
    await s.hydrate();
    s.appendMessage(msg("a1", "alice"));
    await s.flush();

    const before = partWrites().length;
    s.addContact({ pubkey: "carol", name: "Carol" });
    await s.flush();
    expect(partWrites().slice(before)).toEqual(["meta"]);
  });

  it("重新開機：從部位還原完整狀態", async () => {
    const { io } = fakeIo();
    const a = new TauriStorage("ns", io);
    await a.hydrate();
    a.addContact({ pubkey: "bob", name: "Bob" });
    a.appendMessage(msg("m1", "bob"));
    a.setReadAt("bob", 42);
    await a.flush();

    const b = new TauriStorage("ns", io);
    await b.hydrate();
    expect(b.loadContacts().map((c) => c.pubkey)).toEqual(["bob"]);
    expect(b.loadMessages("bob").map((m) => m.id)).toEqual(["m1"]);
    expect(b.loadReadAt()["bob"]).toBe(42);
  });

  it("**舊格式遷移**：只有整包快照時仍讀得到，並就地拆成部位（不能因換格式而丟資料）", async () => {
    const { io, store, parts } = fakeIo();
    store.set(
      "ns",
      JSON.stringify({
        identity: { nsec: "n", name: "me" },
        contacts: [{ pubkey: "bob", name: "Bob" }],
        blocked: [],
        messages: { bob: [msg("old1", "bob")] },
        reactions: [],
        deleted: [],
        groups: [],
        bootstrapList: null,
      }),
    );
    const s = new TauriStorage("ns", io);
    await s.hydrate();
    expect(s.loadMessages("bob").map((m) => m.id)).toEqual(["old1"]);
    expect(parts.has("ns|meta")).toBe(true);
    expect(parts.has("ns|msgs.bob")).toBe(true);
  });

  it("移除對話 → 刪掉它的部位檔（不留孤兒密文）", async () => {
    const { io, parts } = fakeIo();
    const s = new TauriStorage("ns", io);
    await s.hydrate();
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.appendMessage(msg("m1", "bob"));
    await s.flush();
    expect(parts.has("ns|msgs.bob")).toBe(true);

    s.removeContact("bob");
    await s.flush();
    expect(parts.has("ns|msgs.bob")).toBe(false);
  });
});
