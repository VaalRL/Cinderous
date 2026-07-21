import { generateSecretKey } from "@cinderous/core";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "./local.js";

/** 最小 localStorage 替身（含 `length`/`key(i)`，供 LocalStorage 掃描對話鍵）。 */
const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return backing.size;
    },
    key: (i: number) => [...backing.keys()][i] ?? null,
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

const msg = (id: string, at: number, outgoing = false) => ({ id, contact: "bob", outgoing, text: id, at });

describe("LocalStorage（ADR-0110：狀態常駐記憶體 + 逐鍵寫回）", () => {
  it("寫入落地 localStorage，且新實例（＝重新開機）讀得回來", () => {
    const a = new LocalStorage("ns");
    a.addContact({ pubkey: "bob", name: "Bob" });
    a.appendMessage(msg("m1", 100));
    a.setReadAt("bob", 100);

    const b = new LocalStorage("ns"); // 重新開機
    expect(b.loadContacts().map((c) => c.pubkey)).toEqual(["bob"]);
    expect(b.loadMessages("bob").map((m) => m.id)).toEqual(["m1"]);
    expect(b.loadReadAt()["bob"]).toBe(100);
  });

  it("開機時掃描既有的對話鍵——即使聯絡人清單為空也不會漏讀訊息", () => {
    backing.set("nb.ns.msgs.bob", JSON.stringify([msg("m1", 1), msg("m2", 2)]));
    const s = new LocalStorage("ns");
    expect(s.loadMessages("bob").map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("去重：同 id 重複 append 不會產生第二則", () => {
    const s = new LocalStorage("ns");
    s.appendMessage(msg("m1", 1));
    s.appendMessage(msg("m1", 1));
    expect(s.loadMessages("bob")).toHaveLength(1);
  });

  it("批次已讀水位：一次改完，且結果落地", () => {
    const s = new LocalStorage("ns");
    s.appendMessage({ ...msg("a", 1, true), status: "sent" as const });
    s.appendMessage({ ...msg("b", 2, true), status: "sent" as const });
    expect(s.setMessageStatusBulk("bob", ["a", "b"], "read").sort()).toEqual(["a", "b"]);
    expect(new LocalStorage("ns").loadMessages("bob").map((m) => m.status)).toEqual(["read", "read"]);
  });

  it("保留上限：**無封存時不刪除**，重載後訊息仍在（ADR-0126）", () => {
    const s = new LocalStorage("ns");
    s.appendMessage(msg("a", 1));
    s.appendMessage(msg("b", 2));
    s.appendMessage(msg("c", 3));
    s.setMaxPerConvo(2); // 這個 store 沒 attachArchive → 不裁切（絕不讓封存不可用變成刪除）
    // 修正前：會刪到剩 b,c 並落地。ADR-0126：保留上限＝封存門檻，沒有封存就一則都不刪。
    expect(new LocalStorage("ns").loadMessages("bob").map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("移除聯絡人：連同其訊息鍵一起清掉（不留孤兒）", () => {
    const s = new LocalStorage("ns");
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.appendMessage(msg("m1", 1));
    s.addReaction({ id: "r1", messageId: "m1", emoji: "👍", mine: true });
    s.removeContact("bob");
    expect(backing.has("nb.ns.msgs.bob")).toBe(false);
    expect(new LocalStorage("ns").loadReactions()).toEqual([]); // 孤兒 reaction 一併清除
  });

  it("命名空間隔離：不同身分互不看見對方的訊息（ADR-0045）", () => {
    const a = new LocalStorage("alice");
    a.appendMessage(msg("m1", 1));
    expect(new LocalStorage("carol").loadMessages("bob")).toEqual([]);
  });
});

describe("LocalStorage 靜態加密（ADR-0112）", () => {
  const sk = generateSecretKey();
  const secret = (id: string) => ({ id, contact: "bob", outgoing: false, text: "極機密內容", at: 1 });

  it("**磁碟上是密文**：訊息內容不以明文出現在 localStorage", () => {
    const s = new LocalStorage("ns", 0, sk);
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.appendMessage(secret("m1"));

    const raw = backing.get("nb.ns.msgs.bob")!;
    expect(raw).not.toContain("極機密內容");
    expect(raw.startsWith("c1:")).toBe(true);
    // 聯絡人也一樣（社交圖譜同樣是敏感資料）
    expect(backing.get("nb.ns.contacts")!).not.toContain("Bob");
  });

  it("同一把 nsec 重載 → 讀得回來", () => {
    const s = new LocalStorage("ns", 0, sk);
    s.appendMessage(secret("m1"));
    expect(new LocalStorage("ns", 0, sk).loadMessages("bob").map((m) => m.text)).toEqual(["極機密內容"]);
  });

  it("**換一把 nsec → 解不開**（磁碟被複製走也沒用）", () => {
    const s = new LocalStorage("ns", 0, sk);
    s.appendMessage(secret("m1"));
    const other = new LocalStorage("ns", 0, generateSecretKey());
    expect(other.loadMessages("bob")).toEqual([]); // 解不開＝讀不到，而不是拿到亂碼
  });

  it("**舊的明文資料仍讀得出來**，且下次寫入自動轉成密文（升級不能毀資料）", () => {
    // 模擬 ADR-0112 之前存下的明文
    backing.set("nb.ns.msgs.bob", JSON.stringify([secret("old")]));
    const s = new LocalStorage("ns", 0, sk);
    expect(s.loadMessages("bob").map((m) => m.id)).toEqual(["old"]); // 舊明文讀得到

    s.appendMessage(secret("new")); // 任一次寫入 → 整個對話轉密文
    expect(backing.get("nb.ns.msgs.bob")!.startsWith("c1:")).toBe(true);
    expect(new LocalStorage("ns", 0, sk).loadMessages("bob").map((m) => m.id)).toEqual(["old", "new"]);
  });

  it("自訂資產庫（ADR-0220）：磁碟上是密文、同鑰重載讀得回", () => {
    const s = new LocalStorage("ns", 0, sk);
    s.saveCustomAssets([{ id: "h1", label: "派對", svg: "<svg>x</svg>", kind: "emoji", shortcode: "party" }]);
    const raw = backing.get("nb.ns.customAssets")!;
    expect(raw).not.toContain("party"); // 短碼不以明文出現
    expect(raw.startsWith("c1:")).toBe(true);
    expect(new LocalStorage("ns", 0, sk).loadCustomAssets().map((a) => a.shortcode)).toEqual(["party"]);
  });

  it("blob 快取（ADR-0223）：磁碟密文、同鑰重載讀得回", () => {
    const s = new LocalStorage("ns", 0, sk);
    const blob = { hash: "abc123", data: "data:image/gif;base64,ZZZSECRET" };
    s.saveAssetBlobs([blob]);
    const raw = backing.get("nb.ns.assetBlobs")!;
    expect(raw).not.toContain("ZZZSECRET"); // blob 位元組不以明文出現
    expect(raw.startsWith("c1:")).toBe(true);
    expect(new LocalStorage("ns", 0, sk).loadAssetBlobs()).toEqual([blob]);
  });

  it("資產墓碑（ADR-0224）：磁碟密文、同鑰重載讀得回", () => {
    const s = new LocalStorage("ns", 0, sk);
    s.saveAssetTombstones([{ id: "deadbeef", at: 12345 }]);
    const raw = backing.get("nb.ns.assetTombstones")!;
    expect(raw).not.toContain("deadbeef"); // 墓碑 id 不以明文出現
    expect(raw.startsWith("c1:")).toBe(true);
    expect(new LocalStorage("ns", 0, sk).loadAssetTombstones()).toEqual([{ id: "deadbeef", at: 12345 }]);
  });

  it("不給 nsec → 沿用明文（相容既有呼叫，不強制破壞）", () => {
    const s = new LocalStorage("ns");
    s.appendMessage(secret("m1"));
    expect(backing.get("nb.ns.msgs.bob")!.startsWith("c1:")).toBe(false);
  });
});
