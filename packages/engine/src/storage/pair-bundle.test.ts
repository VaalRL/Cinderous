import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";
import { applyPairBundle, buildPairBundle, parsePairBundle } from "./pair-bundle.js";

/** 佈置一個「用了一陣子」的來源儲存：身分、聯絡人（含 hint）、群組、訊息、回應、收回、封鎖。 */
function richStorage(): MemoryStorage {
  const s = new MemoryStorage();
  s.saveIdentity({ nsec: "nsec1source", name: "我" });
  s.addContact({ pubkey: "bob", name: "Bob", relayUrl: "wss://y" });
  s.addContact({ pubkey: "carol", name: "Carol" });
  s.saveGroup({ id: "g1", name: "讀書會", admin: "me", members: ["me", "bob"] });
  s.appendMessage({ id: "m1", contact: "bob", outgoing: true, text: "舊訊息", at: 100 });
  s.appendMessage({ id: "m2", contact: "bob", outgoing: false, text: "回覆", at: 200, replyTo: "m1" });
  s.appendMessage({ id: "m3", contact: "g1", outgoing: false, text: "群訊", at: 300, sender: "bob" });
  s.addReaction({ id: "r1", messageId: "m1", emoji: "👍", mine: false });
  s.markDeleted("m2");
  s.blockContact({ pubkey: "spam", name: "垃圾" });
  s.saveBootstrapList({ relays: ["wss://a"], updatedAt: 9 });
  return s;
}

describe("配對捆包（ADR-0072 D4a-2）", () => {
  it("全量往返：組包→驗包→套用到白紙儲存，狀態逐項還原（含快照帶不動的部分）", () => {
    const src = richStorage();
    const json = buildPairBundle(src, { relayUrl: "wss://home", cloudSync: "full" });
    const bundle = parsePairBundle(json)!;
    expect(bundle.relayUrl).toBe("wss://home");
    expect(bundle.cloudSync).toBe("full");

    const dst = new MemoryStorage();
    applyPairBundle(dst, bundle);
    expect(dst.loadIdentity()).toEqual({ nsec: "nsec1source", name: "我" });
    expect(dst.loadContacts().find((c) => c.pubkey === "bob")?.relayUrl).toBe("wss://y"); // hint 保留
    expect(dst.loadGroups()[0]?.name).toBe("讀書會");
    expect(dst.loadMessages("bob").map((m) => m.id)).toEqual(["m1", "m2"]); // 完整歷史、順序不變
    expect(dst.loadMessages("bob")[1]?.replyTo).toBe("m1"); // 串結構保留
    expect(dst.loadMessages("g1")[0]?.sender).toBe("bob");
    expect(dst.loadReactions()).toEqual([{ id: "r1", messageId: "m1", emoji: "👍", mine: false }]);
    expect(dst.loadDeleted()).toContain("m2"); // 收回標記（雲端快照帶不動的）
    expect(dst.loadBlocked().map((b) => b.pubkey)).toEqual(["spam"]);
    expect(dst.loadBootstrapList()?.relays).toEqual(["wss://a"]);
  });

  it("企業身分精華 org（ADR-0172）：往返保留；一般身分不帶；非法欄位淨化", () => {
    const src = richStorage();
    // 企業主＋管理者 pubkey → org 往返保留
    const ent = parsePairBundle(
      buildPairBundle(src, { relayUrl: "wss://home", org: { enterprise: true, orgOwner: true, adminPubkey: "admin_pk", orgJoinToken: "tok", orgEscrow: true } }),
    )!;
    expect(ent.org).toEqual({ enterprise: true, orgOwner: true, adminPubkey: "admin_pk", orgJoinToken: "tok", orgEscrow: true });
    // 一般身分（未傳 org）→ 捆包不帶 org（向後相容，舊機讀不到就是一般身分）
    expect(parsePairBundle(buildPairBundle(src, { relayUrl: "wss://home" }))!.org).toBeUndefined();
    // 全空/非法 org → 不帶（不留空物件、不信任非布林/非字串）
    expect(parsePairBundle(buildPairBundle(src, { relayUrl: "wss://home", org: {} }))!.org).toBeUndefined();
    const dirty = JSON.parse(buildPairBundle(src, { relayUrl: "wss://home" })) as { org?: unknown };
    dirty.org = { enterprise: "yes", adminPubkey: 42, bogus: true }; // 收到亂形狀
    expect(parsePairBundle(JSON.stringify(dirty))!.org).toBeUndefined(); // 淨化後全空→丟棄
  });

  it("parsePairBundle：缺身分/壞形狀/壞 JSON 回 null", () => {
    const ok = buildPairBundle(richStorage(), { relayUrl: "wss://home" });
    expect(parsePairBundle(ok)?.cloudSync).toBeUndefined();
    expect(parsePairBundle("not json")).toBeNull();
    expect(parsePairBundle(JSON.stringify({ v: 1, relayUrl: "wss://x" }))).toBeNull();
    const noIdentity = JSON.parse(ok) as { snapshot: { identity: unknown } };
    noIdentity.snapshot.identity = null;
    expect(parsePairBundle(JSON.stringify(noIdentity))).toBeNull(); // 沒身分＝不是可用的克隆包
  });
});

describe("配對捆包一定要有身分（ADR-0118）", () => {
  const identity = { nsec: "nsec1abc", name: "我" };

  it("**沒有 nsec → 當場拋錯**，不要靜默產出一個沒用的捆包", () => {
    const s = new MemoryStorage(); // 私鑰不在 AppStorage 裡（Tauri 走 OS 金鑰庫／行動端不持久化）
    expect(() => buildPairBundle(s, { relayUrl: "wss://x" })).toThrow(/身分/);
  });

  it("顯式傳入 identity → 捆包帶著 nsec（這正是修正前壞掉的地方）", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    const bundle = parsePairBundle(buildPairBundle(s, { relayUrl: "wss://x" }, identity))!;
    expect(bundle.snapshot.identity?.nsec).toBe("nsec1abc");
    expect(bundle.snapshot.contacts.map((c) => c.pubkey)).toEqual(["bob"]);
  });

  it("storage 裡有身分時仍照舊可用（不強迫呼叫端改）", () => {
    const s = new MemoryStorage();
    s.saveIdentity(identity);
    const bundle = parsePairBundle(buildPairBundle(s, { relayUrl: "wss://x" }))!;
    expect(bundle.snapshot.identity?.nsec).toBe("nsec1abc");
  });

  it("顯式 identity 覆寫 storage 裡的（金鑰庫才是權威）", () => {
    const s = new MemoryStorage();
    s.saveIdentity({ nsec: "nsec1old", name: "舊" });
    const bundle = parsePairBundle(buildPairBundle(s, { relayUrl: "wss://x" }, identity))!;
    expect(bundle.snapshot.identity?.nsec).toBe("nsec1abc");
  });
})
