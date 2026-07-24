import { describe, expect, it } from "vitest";
import {
  buildSnapshotContent,
  type CloudSnapshotContent,
  mergeSnapshotContent,
  parseSnapshotContent,
  SNAPSHOT_MESSAGE_CAP,
  SNAPSHOT_PLAINTEXT_BUDGET,
} from "./cloud-snapshot.js";
import { MemoryStorage } from "./memory.js";
import type { StoredMessage } from "./types.js";
import { type AssetTombstone, type CustomAsset, OR_SET_TOMBSTONE_RETENTION_MS } from "@cinderous/core";

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

  it("剝除廣播頭像（ADR-0154）：contacts/blocked 的 avatar 不進快照（180KB 預算保護）", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob", alias: "阿伯", avatar: "data:image/jpeg;base64,AAA=" });
    s.blockContact({ pubkey: "spam", name: "垃圾", avatar: "data:image/png;base64,BBB=" });
    const snap = buildSnapshotContent(s, "basic");
    expect(snap.contacts[0]).toMatchObject({ pubkey: "bob", alias: "阿伯" }); // 其餘欄位保留
    expect(snap.contacts[0]!.avatar).toBeUndefined();
    expect(snap.blocked[0]!.avatar).toBeUndefined();
    // 本機儲存不受影響（只剝快照那一份）
    expect(s.loadContacts()[0]!.avatar).toBe("data:image/jpeg;base64,AAA=");
  });

  it("完整模式訊息上限：只取最新 N 則", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    for (let i = 0; i < SNAPSHOT_MESSAGE_CAP + 50; i++) s.appendMessage(msg(`m${i}`, "bob", i));
    const full = buildSnapshotContent(s, "full");
    expect(full.messages).toHaveLength(SNAPSHOT_MESSAGE_CAP);
    expect(full.messages?.[0]?.id).toBe(`m${SNAPSHOT_MESSAGE_CAP + 49}`); // 最新在前
  });

  it("位元組預算（審查修正 #2）：長訊息不撐爆 relay 單顆上限——序列化長度受控、最新優先", () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    for (let i = 0; i < 300; i++) s.appendMessage(msg(`m${i}`, "bob", i, "長".repeat(1000))); // 每則約 3KB
    const full = buildSnapshotContent(s, "full");
    expect(JSON.stringify(full).length).toBeLessThanOrEqual(SNAPSHOT_PLAINTEXT_BUDGET);
    expect((full.messages?.length ?? 0)).toBeGreaterThan(0);
    expect((full.messages?.length ?? 0)).toBeLessThan(300); // 有被裁切
    expect(full.messages?.[0]?.id).toBe("m299"); // 最新的保留
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

describe("多設備 OR-Set 合併（ADR-0242 階段①：聯絡人/群組/封鎖刪除傳播）", () => {
  const basic = (over: Partial<CloudSnapshotContent>): CloudSnapshotContent => ({
    v: 1,
    at: 1,
    mode: "basic",
    contacts: [],
    groups: [],
    blocked: [],
    ...over,
  });

  it("聯絡人刪除傳播：另一台刪了（墓碑較新）→ 本機也移除，並保留墓碑續傳", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", at: 100 });
    // now 設小值 → 墓碑在保留窗內（合成時間戳；正式環境用真實 ms）。
    const { changed } = mergeSnapshotContent(dst, basic({ contactTombstones: [{ key: "bob", at: 200 }] }), { now: 300 });
    expect(changed).toBe(true);
    expect(dst.loadContacts().some((c) => c.pubkey === "bob")).toBe(false);
    expect(dst.loadCrdtTombstones("contacts").map((t) => t.key)).toContain("bob");
    // 冪等：同快照再合併無變更
    expect(
      mergeSnapshotContent(dst, basic({ contactTombstones: [{ key: "bob", at: 200 }] }), { now: 300 }).changed,
    ).toBe(false);
  });

  it("刪除復活：本機重加（at 較新）蓋過舊墓碑 → 保留、丟棄過時墓碑", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", at: 300 }); // 重加，比墓碑 200 新
    const { changed } = mergeSnapshotContent(dst, basic({ contactTombstones: [{ key: "bob", at: 200 }] }));
    expect(changed).toBe(false); // bob 存活、本無此墓碑
    expect(dst.loadContacts().some((c) => c.pubkey === "bob")).toBe(true);
    expect(dst.loadCrdtTombstones("contacts")).toEqual([]); // 復活 → 墓碑清掉
  });

  it("群組離群傳播：另一台離群（墓碑較新）→ 本機也移除", () => {
    const dst = new MemoryStorage();
    dst.saveGroup({ id: "g1", name: "群", admin: "me", members: ["me"], at: 100 });
    const { changed } = mergeSnapshotContent(dst, basic({ groupTombstones: [{ key: "g1", at: 200 }] }));
    expect(changed).toBe(true);
    expect(dst.loadGroups().some((g) => g.id === "g1")).toBe(false);
  });

  it("解封傳播（G-Set→OR-Set）：另一台解封（墓碑較新）→ 本機也解封", () => {
    const dst = new MemoryStorage();
    dst.blockContact({ pubkey: "eve", name: "Eve", at: 100 });
    expect(dst.loadBlocked().some((b) => b.pubkey === "eve")).toBe(true);
    const { changed } = mergeSnapshotContent(dst, basic({ blockTombstones: [{ key: "eve", at: 200 }] }));
    expect(changed).toBe(true);
    expect(dst.loadBlocked().some((b) => b.pubkey === "eve")).toBe(false);
  });

  it("封鎖傳播：對端封鎖（blocked 元素＋聯絡人墓碑）→ 本機加入封鎖、且該人不留在聯絡人", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "mallory", name: "M", at: 100 });
    const { changed } = mergeSnapshotContent(
      dst,
      basic({ blocked: [{ pubkey: "mallory", name: "M", at: 200 }], contactTombstones: [{ key: "mallory", at: 200 }] }),
    );
    expect(changed).toBe(true);
    expect(dst.loadBlocked().some((b) => b.pubkey === "mallory")).toBe(true);
    expect(dst.loadContacts().some((c) => c.pubkey === "mallory")).toBe(false);
  });

  it("舊快照（無墓碑欄位）→ 純補缺、絕不刪除本機資料（向後相容）", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", at: 100 });
    // 舊格式：只有 contacts/groups/blocked，沒有任何 tombstone 欄位
    const { changed } = mergeSnapshotContent(dst, basic({ contacts: [{ pubkey: "carol", name: "Carol" }] }));
    expect(changed).toBe(true);
    expect(dst.loadContacts().map((c) => c.pubkey).sort()).toEqual(["bob", "carol"]); // bob 不被刪
  });
});

describe("跨裝置同步設定（ADR-0242 階段③：每對話靜音等）", () => {
  const withPrefs = (syncedPrefs: CloudSnapshotContent["syncedPrefs"]): CloudSnapshotContent => ({
    v: 1,
    at: 1,
    mode: "basic",
    contacts: [],
    groups: [],
    blocked: [],
    ...(syncedPrefs ? { syncedPrefs } : {}),
  });

  it("build 帶入同步設定；merge 逐鍵 LWW（遠端較新的靜音套用）", () => {
    const src = new MemoryStorage();
    src.saveSyncedPrefs({ "mute:g1": { v: "1", at: 200 } });
    const snap = buildSnapshotContent(src, "basic");
    expect(snap.syncedPrefs).toEqual({ "mute:g1": { v: "1", at: 200 } });

    const dst = new MemoryStorage();
    dst.saveSyncedPrefs({ "mute:g1": { v: "", at: 100 } }); // 本機較舊（未靜音）
    const { changed } = mergeSnapshotContent(dst, snap);
    expect(changed).toBe(true);
    expect(dst.loadSyncedPrefs()["mute:g1"]).toEqual({ v: "1", at: 200 }); // 採用遠端較新（靜音）
  });

  it("本機較新 → 不被較舊的遠端覆蓋（冪等/收斂）", () => {
    const dst = new MemoryStorage();
    dst.saveSyncedPrefs({ "mute:g1": { v: "1", at: 300 } });
    const { changed } = mergeSnapshotContent(dst, withPrefs({ "mute:g1": { v: "", at: 100 } }));
    expect(changed).toBe(false);
    expect(dst.loadSyncedPrefs()["mute:g1"]?.v).toBe("1");
  });

  it("畸形同步設定項被過濾，不污染本機", () => {
    const dst = new MemoryStorage();
    mergeSnapshotContent(
      dst,
      withPrefs({ good: { v: "1", at: 5 }, bad: { v: 123, at: "x" } as unknown as { v: string; at: number } }),
    );
    expect(dst.loadSyncedPrefs()).toEqual({ good: { v: "1", at: 5 } });
  });
});

describe("墓碑時間 GC（ADR-0242 後續④）", () => {
  const base = (over: Partial<CloudSnapshotContent>): CloudSnapshotContent => ({
    v: 1,
    at: 1,
    mode: "basic",
    contacts: [],
    groups: [],
    blocked: [],
    ...over,
  });

  it("窗內：刪除套用且墓碑保留（未 GC，續傳給尚未同步的裝置）", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", at: 100 });
    mergeSnapshotContent(dst, base({ contactTombstones: [{ key: "bob", at: 200 }] }), { now: 500 });
    expect(dst.loadContacts().some((c) => c.pubkey === "bob")).toBe(false);
    expect(dst.loadCrdtTombstones("contacts").map((t) => t.key)).toContain("bob"); // 窗內保留
  });

  it("超窗：早於保留窗的墓碑被回收（收斂快照大小）", () => {
    const dst = new MemoryStorage();
    dst.saveCrdtTombstones("contacts", [{ key: "ancient", at: 1000 }]);
    const now = 1000 + OR_SET_TOMBSTONE_RETENTION_MS + 1; // 超過保留窗
    const { changed } = mergeSnapshotContent(dst, base({}), { now });
    expect(changed).toBe(true);
    expect(dst.loadCrdtTombstones("contacts")).toEqual([]); // 古老墓碑 GC 掉
  });

  it("build：超窗墓碑不放進快照", () => {
    const s = new MemoryStorage();
    s.saveCrdtTombstones("blocked", [
      { key: "fresh", at: 10_000 },
      { key: "ancient", at: 1000 },
    ]);
    const now = 1000 + OR_SET_TOMBSTONE_RETENTION_MS + 1; // 門檻＝1001：ancient(1000) 超窗、fresh(10000) 窗內
    const snap = buildSnapshotContent(s, "basic", { now });
    expect(snap.blockTombstones?.map((t) => t.key)).toEqual(["fresh"]); // ancient 超窗被剔除
  });
});

describe("多設備欄位 per-field LWW（ADR-0242 階段②：暱稱/音效）", () => {
  const basic = (contacts: CloudSnapshotContent["contacts"]): CloudSnapshotContent => ({
    v: 1,
    at: 1,
    mode: "basic",
    contacts,
    groups: [],
    blocked: [],
  });
  const bob = (dst: MemoryStorage) => dst.loadContacts().find((c) => c.pubkey === "bob");

  it("遠端較新的暱稱 → 傳到本機既有聯絡人（修欄位編輯不傳播）", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", alias: "本機暱稱", fieldsAt: { alias: 100 }, at: 1 });
    const { changed } = mergeSnapshotContent(
      dst,
      basic([{ pubkey: "bob", name: "Bob", alias: "改過的暱稱", fieldsAt: { alias: 200 }, at: 1 }]),
    );
    expect(changed).toBe(true);
    expect(bob(dst)?.alias).toBe("改過的暱稱");
  });

  it("遠端較新的『清除』→ 本機暱稱也清掉（清除也是一次編輯）", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", alias: "待清除", fieldsAt: { alias: 100 }, at: 1 });
    mergeSnapshotContent(dst, basic([{ pubkey: "bob", name: "Bob", fieldsAt: { alias: 200 }, at: 1 }]));
    expect(bob(dst)?.alias).toBeUndefined();
  });

  it("本機較新 → 不被較舊的遠端覆蓋", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", alias: "本機新", fieldsAt: { alias: 200 }, at: 1 });
    const { changed } = mergeSnapshotContent(
      dst,
      basic([{ pubkey: "bob", name: "Bob", alias: "遠端舊", fieldsAt: { alias: 100 }, at: 1 }]),
    );
    expect(changed).toBe(false);
    expect(bob(dst)?.alias).toBe("本機新");
  });

  it("並發改不同欄位（一台改暱稱、另一台改音效）→ 兩者皆保留", () => {
    const dst = new MemoryStorage();
    dst.addContact({ pubkey: "bob", name: "Bob", alias: "A暱稱", fieldsAt: { alias: 200 }, at: 1 });
    mergeSnapshotContent(
      dst,
      basic([{ pubkey: "bob", name: "Bob", notifySound: "chime2", fieldsAt: { notifySound: 200 }, at: 1 }]),
    );
    expect(bob(dst)?.alias).toBe("A暱稱"); // 本機暱稱未被覆蓋
    expect(bob(dst)?.notifySound).toBe("chime2"); // 遠端音效被套用
  });
});

describe("跨裝置資產同步（ADR-0224）", () => {
  const asset = (id: string, extra: Partial<CustomAsset> = {}): CustomAsset => ({
    id,
    label: id,
    svg: `<svg>${id}</svg>`,
    kind: "emoji",
    ...extra,
  });

  it("build 帶入自訂資產庫與墓碑；大 raster 只帶 ref（svg 空）", () => {
    const s = new MemoryStorage();
    s.saveCustomAssets([
      asset("a1", { shortcode: "smile", at: 10 }),
      { id: "h64", label: "跳舞", svg: "", kind: "emoji", shortcode: "dance", format: "raster", ref: "h64", at: 20 },
    ]);
    s.saveAssetTombstones([{ id: "gone", at: 5 }]);
    const snap = buildSnapshotContent(s, "basic");
    expect(snap.customAssets?.map((a) => a.id).sort()).toEqual(["a1", "h64"]);
    expect(snap.customAssets?.find((a) => a.id === "h64")?.svg).toBe("");
    expect(snap.customAssets?.find((a) => a.id === "h64")?.ref).toBe("h64");
    expect(snap.assetTombstones).toEqual([{ id: "gone", at: 5 }]);
  });

  it("merge 補缺聯集（LWW）：對端庫進本機", () => {
    const src = new MemoryStorage();
    src.saveCustomAssets([asset("a1", { at: 1 }), asset("a2", { at: 2 })]);
    const dst = new MemoryStorage();
    dst.saveCustomAssets([asset("a1", { at: 1 })]);
    const { changed } = mergeSnapshotContent(dst, buildSnapshotContent(src, "basic"));
    expect(changed).toBe(true);
    expect(
      dst
        .loadCustomAssets()
        .map((a) => a.id)
        .sort(),
    ).toEqual(["a1", "a2"]);
  });

  it("墓碑刪除傳播：對端較新墓碑 → 本機資產移除、墓碑留存", () => {
    const src = new MemoryStorage();
    src.saveAssetTombstones([{ id: "a1", at: 100 }]);
    const dst = new MemoryStorage();
    dst.saveCustomAssets([asset("a1", { at: 50 })]);
    const { changed } = mergeSnapshotContent(dst, buildSnapshotContent(src, "basic"));
    expect(changed).toBe(true);
    expect(dst.loadCustomAssets().some((a) => a.id === "a1")).toBe(false);
    expect(dst.loadAssetTombstones().map((t) => t.id)).toEqual(["a1"]);
  });

  it("重匯復活：本機墓碑舊、對端資產新 → 資產回來、墓碑清除", () => {
    const src = new MemoryStorage();
    src.saveCustomAssets([asset("a1", { at: 100 })]);
    const dst = new MemoryStorage();
    dst.saveAssetTombstones([{ id: "a1", at: 50 }]);
    mergeSnapshotContent(dst, buildSnapshotContent(src, "basic"));
    expect(dst.loadCustomAssets().some((a) => a.id === "a1")).toBe(true);
    expect(dst.loadAssetTombstones()).toEqual([]);
  });

  it("mine／shortcode 保留、順序不誤報：相同集合再合併 changed=false", () => {
    const src = new MemoryStorage();
    src.saveCustomAssets([asset("a1", { at: 1 }), asset("a2", { at: 2 })]);
    const dst = new MemoryStorage();
    dst.saveCustomAssets([asset("a1", { mine: true, shortcode: "mine1", at: 1 }), asset("a2", { at: 2 })]);
    const { changed } = mergeSnapshotContent(dst, buildSnapshotContent(src, "basic"));
    expect(changed).toBe(false);
    expect(dst.loadCustomAssets().find((a) => a.id === "a1")?.mine).toBe(true);
    expect(dst.loadCustomAssets().find((a) => a.id === "a1")?.shortcode).toBe("mine1");
  });

  it("畸形 customAssets/tombstones 被過濾、不污染本機庫（審查修正）", () => {
    const dst = new MemoryStorage();
    const content = {
      v: 1 as const,
      at: 1,
      mode: "basic" as const,
      contacts: [],
      groups: [],
      blocked: [],
      customAssets: [null, { foo: 1 }, 123, asset("good", { at: 5 })] as unknown as CustomAsset[],
      assetTombstones: [{ id: "t", at: 9 }, null, { bad: true }] as unknown as AssetTombstone[],
    };
    mergeSnapshotContent(dst, content);
    expect(dst.loadCustomAssets().map((a) => a.id)).toEqual(["good"]);
    expect(dst.loadAssetTombstones().map((t) => t.id)).toEqual(["t"]);
  });

  it("build→parse→merge round-trip 保留庫與墓碑", () => {
    const src = new MemoryStorage();
    src.saveCustomAssets([asset("a1", { at: 1 })]);
    src.saveAssetTombstones([{ id: "dead", at: 9 }]);
    const parsed = parseSnapshotContent(JSON.stringify(buildSnapshotContent(src, "basic")));
    expect(parsed).not.toBeNull();
    const dst = new MemoryStorage();
    if (parsed) mergeSnapshotContent(dst, parsed);
    expect(dst.loadCustomAssets().map((a) => a.id)).toEqual(["a1"]);
    expect(dst.loadAssetTombstones().map((t) => t.id)).toEqual(["dead"]);
  });

  it("parseSnapshotContent：customAssets／assetTombstones 非陣列 → null", () => {
    const bad1 = { v: 1, mode: "basic", contacts: [], groups: [], blocked: [], customAssets: "x" };
    const bad2 = { v: 1, mode: "basic", contacts: [], groups: [], blocked: [], assetTombstones: 3 };
    expect(parseSnapshotContent(JSON.stringify(bad1))).toBeNull();
    expect(parseSnapshotContent(JSON.stringify(bad2))).toBeNull();
  });
});
