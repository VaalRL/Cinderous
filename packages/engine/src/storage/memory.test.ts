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

  it("本地暱稱 setContactAlias（ADR-0148）：設定/清除、不動廣播名、trim", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "廣播小明" });
    s.setContactAlias("aa", "  我的暱稱 ");
    expect(s.loadContacts()[0]).toMatchObject({ name: "廣播小明", alias: "我的暱稱" }); // 廣播名不變
    // 廣播名更新（ADR-0061）不覆寫暱稱
    s.updateContactName("aa", "廣播改名了");
    expect(s.loadContacts()[0]).toMatchObject({ name: "廣播改名了", alias: "我的暱稱" });
    // 清除（空字串）→ 退回只有廣播名
    s.setContactAlias("aa", "");
    expect(s.loadContacts()[0]!.alias).toBeUndefined();
    expect(s.loadContacts()[0]!.name).toBe("廣播改名了");
    // undefined 亦視為清除；未知 pubkey 不炸
    s.setContactAlias("aa", "x");
    s.setContactAlias("aa", undefined);
    expect(s.loadContacts()[0]!.alias).toBeUndefined();
    s.setContactAlias("zzz", "無此人"); // no-op
  });

  it("依聯絡人通知音效 setContactNotifySound（ADR-0149）：設定/清除、trim、與暱稱互不干擾", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "小明" });
    s.setContactNotifySound("aa", "  bell ");
    expect(s.loadContacts()[0]).toMatchObject({ name: "小明", notifySound: "bell" });
    // 與本地暱稱（ADR-0148）各自獨立
    s.setContactAlias("aa", "阿伯");
    expect(s.loadContacts()[0]).toMatchObject({ alias: "阿伯", notifySound: "bell" });
    // 清除（空字串/undefined）→ 退回全域預設（欄位移除）；暱稱不動
    s.setContactNotifySound("aa", "");
    expect(s.loadContacts()[0]!.notifySound).toBeUndefined();
    expect(s.loadContacts()[0]!.alias).toBe("阿伯");
    s.setContactNotifySound("aa", "drop");
    s.setContactNotifySound("aa", undefined);
    expect(s.loadContacts()[0]!.notifySound).toBeUndefined();
    s.setContactNotifySound("zzz", "bell"); // 未知 pubkey no-op
  });

  it("廣播頭像 updateContactAvatar（ADR-0154）：設定/清除、請求區同步更新、與暱稱互不干擾", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "aa", name: "小明" });
    s.addRequest({ pubkey: "rr", name: "路人" });
    s.updateContactAvatar("aa", "data:image/jpeg;base64,AAA=");
    s.updateContactAvatar("rr", "data:image/png;base64,BBB=");
    expect(s.loadContacts()[0]!.avatar).toBe("data:image/jpeg;base64,AAA=");
    expect(s.loadRequests()[0]!.avatar).toBe("data:image/png;base64,BBB="); // 請求區也認得出臉（ADR-0121）
    s.setContactAlias("aa", "阿伯");
    expect(s.loadContacts()[0]).toMatchObject({ alias: "阿伯", avatar: "data:image/jpeg;base64,AAA=" });
    s.updateContactAvatar("aa", undefined); // 對方移除 → 欄位清掉
    expect(s.loadContacts()[0]!.avatar).toBeUndefined();
    expect(s.loadContacts()[0]!.alias).toBe("阿伯");
    s.updateContactAvatar("zzz", "data:image/png;base64,CCC="); // 未知 pubkey no-op
  });

  it("自己的廣播頭像 selfAvatar（ADR-0154）：null＝未設；'' ＝移除記號；隨快照進出", () => {
    const s = new MemoryStorage();
    expect(s.loadSelfAvatar()).toBeNull();
    s.saveSelfAvatar("data:image/jpeg;base64,AAA=");
    expect(s.loadSelfAvatar()).toBe("data:image/jpeg;base64,AAA=");
    const snap = s.exportSnapshot();
    expect(snap.selfAvatar).toBe("data:image/jpeg;base64,AAA=");
    s.saveSelfAvatar("");
    expect(s.loadSelfAvatar()).toBe(""); // 移除記號（持續廣播）
    s.importSnapshot(snap);
    expect(s.loadSelfAvatar()).toBe("data:image/jpeg;base64,AAA=");
    const { selfAvatar: _drop, ...legacy } = snap; // 舊快照無此欄位 → 視為未設
    s.importSnapshot(legacy);
    expect(s.loadSelfAvatar()).toBeNull();
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

  it("🔴 **保留上限在無封存時不刪除**（ADR-0126）——絕不讓「封存不可用」變成「訊息被刪」", () => {
    // 修正前：`cap()` 直接 splice 刪除。ADR-0126 後上限＝封存門檻，而**沒有封存就不裁切**
    //（此處 MemoryStorage 未 attachArchive）。這是 ADR-0111 的紅線在保留上限上的延伸。
    const s = new MemoryStorage(MESSAGES_PER_CONVO);
    for (let i = 0; i < MESSAGES_PER_CONVO + 5; i++) {
      s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    }
    // 一則都沒少——舊行為會刪掉最舊的 5 則。
    expect(s.loadMessages("aa").length).toBe(MESSAGES_PER_CONVO + 5);
    expect(s.loadMessages("aa")[0]!.id).toBe("m0");
  });

  it("setMaxPerConvo：無封存時調小上限也不刪；`retentionCap()` 回報設定值", () => {
    const s = new MemoryStorage();
    for (let i = 0; i < 20; i++) s.appendMessage({ id: `m${i}`, contact: "aa", outgoing: true, text: "x", at: i });
    s.setMaxPerConvo(5);
    expect(s.retentionCap()).toBe(5); // 供 ArchiveWriter 決定有效熱區
    expect(s.loadMessages("aa").length).toBe(20); // 無封存 → 不裁切（ADR-0126）
    s.setMaxPerConvo(0);
    expect(s.retentionCap()).toBe(0);
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

  // 註：封存搬移（trimOldest）的 id 索引一致性由 archive.test.ts 的 ADR-0126 區塊涵蓋
  //（那裡有 FakeArchive 可觸發真的裁切）。ADR-0126 後 MemoryStorage 本身不再有刪除路徑。
});

describe("到期的限時訊息從本機刪掉明文（ADR-0408）", () => {
  const T = 1_800_000_000_000;
  it("🔴 到期的原文與檔案 metadata 清掉、留下佔位；沒到期的不動；回傳動到的對話與下一則到期時刻", () => {
    const s = new MemoryStorage();
    s.appendMessage({ id: "e1", contact: "bob", outgoing: false, text: "密碼是 1234", at: T - 60_000, expiresAt: T - 1 });
    s.appendMessage({
      id: "e2", contact: "bob", outgoing: true, text: "", at: T - 50_000, expiresAt: T,
      file: { tid: "t1", name: "合約.pdf", size: 10, mime: "application/pdf", thumb: "data:image/png;base64,AA" },
    });
    s.appendMessage({ id: "l1", contact: "bob", outgoing: false, text: "週五見", at: T - 40_000, expiresAt: T + 60_000 });
    s.appendMessage({ id: "n1", contact: "carol", outgoing: false, text: "一般訊息", at: T - 30_000 });

    expect(s.scrubExpired(T)).toEqual({ convos: ["bob"], next: T + 60_000 });
    const bob = s.loadMessages("bob");
    expect(bob.find((m) => m.id === "e1")).toEqual({ id: "e1", contact: "bob", outgoing: false, text: "", at: T - 60_000, expiresAt: T - 1 });
    expect(bob.find((m) => m.id === "e2")?.file).toBeUndefined();
    expect(JSON.stringify(bob)).not.toContain("密碼是 1234");
    expect(JSON.stringify(bob)).not.toContain("合約.pdf");
    expect(bob.find((m) => m.id === "l1")?.text).toBe("週五見");
    expect(s.loadMessages("carol")[0]?.text).toBe("一般訊息");
    expect(s.findMessage("e1")?.text).toBe(""); // byId 也要換掉，不然還找得到原文
  });

  it("已經清過的不再算（重複掃描不會一直重寫）", () => {
    const s = new MemoryStorage();
    s.appendMessage({ id: "e1", contact: "bob", outgoing: false, text: "x", at: T - 1, expiresAt: T - 1 });
    expect(s.scrubExpired(T).convos).toEqual(["bob"]);
    expect(s.scrubExpired(T + 1)).toEqual({ convos: [] });
  });
});
