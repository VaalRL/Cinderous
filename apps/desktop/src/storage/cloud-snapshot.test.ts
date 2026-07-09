import { describe, expect, it } from "vitest";
import {
  buildSnapshotContent,
  mergeSnapshotContent,
  parseSnapshotContent,
  SNAPSHOT_MESSAGE_CAP,
} from "./cloud-snapshot.js";
import { MemoryStorage } from "./memory.js";
import type { StoredMessage } from "./types.js";

const msg = (id: string, contact: string, at: number, text = id): StoredMessage => ({
  id,
  contact,
  outgoing: false,
  text,
  at,
});

describe("快照內容組裝（ADR-0071 三檔模式）", () => {
  it("基本＝聯絡人/群組/封鎖、無訊息；完整＝＋近期訊息（跨對話取最新、有上限）", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.saveGroup({ id: "g1", name: "群", admin: "me", members: ["me", "bob"] });
    s.blockContact({ pubkey: "spam", name: "垃圾" });
    s.appendMessage(msg("m1", "bob", 100));
    s.appendMessage(msg("m2", "g1", 200));

    const basic = buildSnapshotContent(s, "basic", { now: 999 });
    expect(basic.at).toBe(999);
    expect(basic.contacts.map((c) => c.pubkey)).toEqual(["bob"]);
    expect(basic.groups.map((g) => g.id)).toEqual(["g1"]);
    expect(basic.blocked.map((b) => b.pubkey)).toEqual(["spam"]);
    expect(basic.messages).toBeUndefined();

    const full = buildSnapshotContent(s, "full");
    expect(full.messages?.map((m) => m.id)).toEqual(["m2", "m1"]); // 新到舊
  });

  it("完整模式訊息上限：只取最新 N 則", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    for (let i = 0; i < SNAPSHOT_MESSAGE_CAP + 50; i++) s.appendMessage(msg(`m${i}`, "bob", i));
    const full = buildSnapshotContent(s, "full");
    expect(full.messages).toHaveLength(SNAPSHOT_MESSAGE_CAP);
    expect(full.messages?.[0]?.id).toBe(`m${SNAPSHOT_MESSAGE_CAP + 49}`); // 最新在前
  });
});

describe("快照合併（交換律、補缺不覆蓋）", () => {
  it("空機還原：聯絡人/群組/封鎖/訊息全數補回，訊息由舊到新", () => {
    const src = new MemoryStorage();
    src.addContact({ pubkey: "bob", name: "Bob", relayUrl: "wss://y" });
    src.saveGroup({ id: "g1", name: "群", admin: "me", members: ["me", "bob"] });
    src.blockContact({ pubkey: "spam", name: "垃圾" });
    src.appendMessage(msg("m2", "bob", 200));
    src.appendMessage(msg("m1", "bob", 100));
    const content = buildSnapshotContent(src, "full");

    const dst = new MemoryStorage();
    const { changed, convos } = mergeSnapshotContent(dst, content);
    expect(changed).toBe(true);
    expect(convos).toEqual(["bob"]);
    expect(dst.loadContacts().find((c) => c.pubkey === "bob")?.relayUrl).toBe("wss://y");
    expect(dst.loadGroups().map((g) => g.id)).toEqual(["g1"]);
    expect(dst.loadBlocked().map((b) => b.pubkey)).toEqual(["spam"]);
    expect(dst.loadMessages("bob").map((m) => m.id)).toEqual(["m1", "m2"]); // 由舊到新
    // 冪等：再合併一次無變更
    expect(mergeSnapshotContent(dst, content).changed).toBe(false);
  });

  it("補缺不覆蓋：本機既有聯絡人名稱/群組不被快照改動；封鎖者不得入列聯絡人", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "活資料名" });
    dst.saveGroup({ id: "g1", name: "本機群名", admin: "me", members: ["me"] });
    dst.blockContact({ pubkey: "eve", name: "已封鎖" });

    const { changed } = mergeSnapshotContent(dst, {
      v: 1,
      at: 1,
      mode: "basic",
      contacts: [
        { pubkey: "bob", name: "快照舊名" },
        { pubkey: "eve", name: "捲土重來" },
      ],
      groups: [{ id: "g1", name: "快照群名", admin: "me", members: ["me", "x"] }],
      blocked: [],
    });
    expect(changed).toBe(false);
    expect(dst.loadContacts().find((c) => c.pubkey === "bob")?.name).toBe("活資料名");
    expect(dst.loadContacts().some((c) => c.pubkey === "eve")).toBe(false);
    expect(dst.loadGroups()[0]?.name).toBe("本機群名");
  });

  it("parseSnapshotContent：合法通過、壞 JSON/版本/缺欄位回 null", () => {
    const src = new MemoryStorage();
    const ok = JSON.stringify(buildSnapshotContent(src, "basic"));
    expect(parseSnapshotContent(ok)?.v).toBe(1);
    expect(parseSnapshotContent("not json")).toBeNull();
    expect(parseSnapshotContent(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseSnapshotContent(JSON.stringify({ v: 1, mode: "basic" }))).toBeNull();
  });
});
