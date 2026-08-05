import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";
import { applyPairBundle, buildPairBundle, exportFullSnapshot, isLargeBundle, LARGE_BUNDLE_BYTES, type PairBundle, parsePairBundle } from "./pair-bundle.js";
import { utf8ByteLength } from "./utf8-size.js";

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
  it("🔴 `failures`／`pending` 不隨捆包搬到新機（ADR-0316／0325）——那是來源裝置的東西", () => {
    const src = new MemoryStorage();
    src.saveIdentity({ nsec: "nsec1x", name: "我" });
    src.saveFsState({
      enabled: true,
      keys: [],
      contactEks: {},
      failures: { notFs: 3, maybeEkLoss: 2 },
      pending: [{ id: "aa", at: 1, json: '{"content":"來源裝置解不開的東西"}' }],
    });
    const json = buildPairBundle(src, { relayUrl: "wss://home" });
    expect(json).not.toContain("來源裝置解不開的東西");

    const dst = new MemoryStorage();
    applyPairBundle(dst, parsePairBundle(json)!);
    expect(dst.loadFsState().pending).toBeUndefined();
    expect(dst.loadFsState().failures).toBeUndefined();
  });


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

describe("配對捆包帶 FS 金鑰（審查發現：不帶＝新裝置永遠解不開加密到 EK 的訊息）", () => {
  const fsState = {
    enabled: true,
    keys: [{ nsec: "ek-nsec-1", pk: "ek-pk-1", at: 1000 }],
    contactEks: { bob: "bob-ek" },
    pinned: { bob: true },
    unsupported: { carol: "ratchet-v1" },
  };

  it("🔴 匯出必須帶上 FS 金鑰——不帶的後果是靜默丟訊息，不是少個功能", () => {
    // 沒有 EK 私鑰時，openWrapWithEks 的候選只剩 IK，而加密到 EK 的 wrap 用 IK 解不開
    // ⇒ relay-backend 的 `catch { return; }` 靜默丟棄 ⇒ 訊息在舊機看得到、新機永遠看不到。
    const src = new MemoryStorage();
    src.saveIdentity({ nsec: "nsec1", name: "我" });
    src.saveFsState(fsState);
    const snap = exportFullSnapshot(src);
    expect(snap.fs?.keys).toEqual(fsState.keys);
    expect(snap.fs?.contactEks).toEqual(fsState.contactEks);
  });

  it("🔴 但**不得**帶 `enabled`——啟用送出端是新裝置上的新安全決定（ADR-0306 D1）", () => {
    const src = new MemoryStorage();
    src.saveIdentity({ nsec: "nsec1", name: "我" });
    src.saveFsState(fsState);
    expect(exportFullSnapshot(src).fs?.enabled).toBe(false);
  });

  it("釘選與不支援記錄一併帶——否則新機啟用後降級偵測是瞎的", () => {
    const src = new MemoryStorage();
    src.saveIdentity({ nsec: "nsec1", name: "我" });
    src.saveFsState(fsState);
    const snap = exportFullSnapshot(src);
    expect(snap.fs?.pinned).toEqual({ bob: true });
    expect(snap.fs?.unsupported).toEqual({ carol: "ratchet-v1" });
  });

  it("匯入端落地：新機拿得到金鑰，但 FS 仍是關的", () => {
    const src = new MemoryStorage();
    src.saveIdentity({ nsec: "nsec1", name: "我" });
    src.saveFsState(fsState);
    const dst = new MemoryStorage();
    applyPairBundle(dst, JSON.parse(buildPairBundle(src, { relayUrl: "wss://r" })) as PairBundle);
    const out = dst.loadFsState();
    expect(out.keys).toEqual(fsState.keys);
    expect(out.enabled).toBe(false);
  });

  it("舊捆包沒有 fs 欄位 → 匯入不得炸（向後相容）", () => {
    const dst = new MemoryStorage();
    const legacy = {
      v: 1 as const,
      relayUrl: "wss://r",
      snapshot: {
        identity: { nsec: "nsec1", name: "我" },
        contacts: [], blocked: [], messages: {}, reactions: [], deleted: [], groups: [],
      },
    };
    expect(() => applyPairBundle(dst, legacy as unknown as PairBundle)).not.toThrow();
    expect(dst.loadFsState().keys).toEqual([]);
  });
});

describe("配對捆包的大小（ADR-0072／0305 §7：不做續傳，改為誠實提示）", () => {
  /** 造出 n 則有代表性的文字訊息（含 id／時間／方向等實際欄位）。 */
  const withMessages = (n: number): MemoryStorage => {
    const s = new MemoryStorage();
    s.saveIdentity({ nsec: "nsec1abc", name: "我" });
    s.addContact({ pubkey: "bob", name: "Bob", relayUrl: "wss://relay.example.com" });
    for (let i = 0; i < n; i++) {
      s.appendMessage({
        id: `msg-${i}-${"a".repeat(24)}`,
        contact: "bob",
        outgoing: i % 2 === 0,
        text: "這是一則長度接近日常平均的訊息，中文大約二十到四十個字之間。",
        at: 1_700_000_000_000 + i * 1000,
      });
    }
    return s;
  };

  /** 🔴 一律以 **UTF-8 位元組**量測——用 `String.length` 的話，對中文會低估到三分之一，
   *  而傳輸實際送的是 UTF-8（`pairing.ts` 的 `TextEncoder`）。當初就是這裡跟門檻錯在同一處，
   *  兩個錯誤互相掩護，測試才會過。 */
  const bundleBytes = (n: number) => utf8ByteLength(buildPairBundle(withMessages(n), { relayUrl: "wss://r" }));

  it("量測：每則訊息的捆包成本（供 LARGE_BUNDLE_BYTES 門檻取值依據）", () => {
    const perMsg = (bundleBytes(1000) - bundleBytes(0)) / 1000;
    // 這條不是斷言效能，是**把數字釘在測試裡**——日後訊息結構變胖會在這裡看到。
    // 實測約 193 UTF-8 bytes/則（中文正文 ~90 ＋ id ~30 ＋ JSON 結構 ~70）。
    expect(perMsg).toBeGreaterThan(150);
    expect(perMsg).toBeLessThan(400);
  });

  it("🔴 量測必須用 UTF-8 位元組，不得用 String.length（這正是原本的錯）", () => {
    const json = buildPairBundle(withMessages(200), { relayUrl: "wss://r" });
    // 中文內容下兩者差距顯著；若哪天有人把量測改回 .length，這條會紅。
    // ⚠ 差距是 **~1.4 倍**而非三倍：捆包裡有大量 ASCII（id、pubkey、時間戳、JSON 鍵），
    // 只有正文是中文。純中文字串才會到三倍。
    expect(utf8ByteLength(json)).toBeGreaterThan(json.length * 1.2);
  });

  it("🔴 門檻要落在「重傳會讓人不爽」的量級，而不是隨手取的整數", () => {
    // LARGE_BUNDLE_BYTES 對應約多少則訊息——若哪天改了門檻，這裡會顯示它的實際意義。
    const perMsg = (bundleBytes(1000) - bundleBytes(0)) / 1000;
    const msgsAtThreshold = LARGE_BUNDLE_BYTES / perMsg;
    // 門檻應該落在「累積了不少歷史」的使用者，而不是剛用兩天就跳警告。
    expect(msgsAtThreshold).toBeGreaterThan(5_000);
    expect(msgsAtThreshold).toBeLessThan(100_000);
  });

  it("isLargeBundle：門檻上下（ASCII，1 byte/字）", () => {
    expect(isLargeBundle("a".repeat(LARGE_BUNDLE_BYTES - 1))).toBe(false);
    expect(isLargeBundle("a".repeat(LARGE_BUNDLE_BYTES + 1))).toBe(true);
  });

  it("🔴 中文以 3 bytes 計——舊寫法在這裡會漏報", () => {
    // 三分之一門檻的中文字串＝剛好未達；再多一點就超過。舊的 `.length` 寫法兩者都判 false。
    const justUnder = "中".repeat(Math.floor(LARGE_BUNDLE_BYTES / 3) - 1);
    const justOver = "中".repeat(Math.floor(LARGE_BUNDLE_BYTES / 3) + 2);
    expect(isLargeBundle(justUnder)).toBe(false);
    expect(isLargeBundle(justOver)).toBe(true);
    expect(justOver.length).toBeLessThan(LARGE_BUNDLE_BYTES); // ← 證明 .length 會漏報
  });
});
