// 封存刪除後的殘留可解性（ADR-0298 §3 的缺口 → ADR-0413 修掉的那一半）。
//
// 這支測試原本是**特徵化測試**：斷言「刪除後的殘留仍能用同一把金鑰解開」這個弱行為，
// 並交代「分段金鑰實作後把斷言翻正，不要把測試刪掉」。ADR-0413 實作了每塊一把隨機金鑰，
// 斷言已翻正，而且改成跑**真的** `openOpfsArchive`（原本是測試裡自己寫的迷你封存）。
//
// ## 這支測試刻意只驗「我們這一層」
//
// 「刪除後資料是否真的從實體介質消失」**不是我們能測的**——flash 的耗損平均與預留空間讓
// 軟體沒有可靠手段保證抹除，那是已確立的硬體事實，引用即可，不該用一台 VM 去「驗證」
// （虛擬磁碟沒有耗損平均也沒有預留空間，會給出漂亮但不成立的結論）。
//
// 我們該負責的是另一半：**假如那些位元組確實留在介質上，我們的設計讓它們可讀嗎？**
// 所以下面的假 OPFS 記下**每一次寫入過的位元組**（`residue`），刪除與覆寫都不會把它們拿掉。
//
// ## 還剩什麼沒擋住（寫在測試裡，免得之後有人以為擋住了）
//
// 金鑰包裹自己也寫在同一個介質上。攻擊者若連**包裹的殘留**都撿得回來，再加上 nsec，
// 還是解得開——最後一則測試把這個界線釘住。要補上這一段只能靠硬體銷毀根秘密（ADR-0297）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveStorageKey, generateSecretKey, openValue, sealValue, unwrapSegmentKey } from "@cinderous/core";
import { openOpfsArchive, wipeOpfsArchive } from "./opfs-archive.js";
import type { StoredMessage } from "./types.js";

/**
 * 假 OPFS，模型化「刪除只移除索引，位元組留在介質上」。
 *
 * `live` ＝ App 看得到的檔案；`residue` ＝ 曾經寫下的每一份位元組（刪除、覆寫都不會消失）。
 */
interface Disk {
  live: Map<string, string>;
  residue: { name: string; bytes: string }[];
  /** 依序記下每一次刪除的檔名 */
  removed: string[];
  /** 這些檔刪不掉（另一個分頁正握著它） */
  locked: Set<string>;
  /** 寫這個檔時，關閉前先等這個 promise（用來排出並發的先後） */
  hold: Map<string, Promise<void>>;
}

/** 假的 Web Locks：同名的請求依序執行（同一個 origin 的所有分頁共用）。 */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: <T>(name: string, cb: () => Promise<T>): Promise<T> => {
      const run = (tails.get(name) ?? Promise.resolve()).then(cb, cb);
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

function residualOpfs(opts: { locks?: boolean } = {}): Disk {
  const live = new Map<string, string>();
  const residue: { name: string; bytes: string }[] = [];
  const removed: string[] = [];
  const locked = new Set<string>();
  const hold = new Map<string, Promise<void>>();
  const dir = {
    keys: async function* () {
      for (const k of [...live.keys()]) yield k;
    },
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!live.has(name) && !opts?.create) throw new Error("NotFoundError");
      return {
        createWritable: async () => {
          let buf = "";
          return {
            write: async (data: string) => {
              buf += data;
            },
            close: async () => {
              const gate = hold.get(name);
              if (gate) {
                hold.delete(name); // 只擋第一個寫這個檔的人
                await gate;
              }
              live.set(name, buf);
              residue.push({ name, bytes: buf }); // 介質上的痕跡：寫下去就在了
            },
          };
        },
        getFile: async () => ({ text: async () => live.get(name) ?? "" }),
      };
    },
    /** 檔案系統刪除：只移索引。**residue 一動也沒動**。 */
    removeEntry: async (name: string) => {
      if (locked.has(name)) throw new Error("NoModificationAllowedError");
      removed.push(name);
      live.delete(name);
    },
    getDirectoryHandle: async () => dir,
  };
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => dir },
    ...(opts.locks ? { locks: fakeLocks() } : {}),
  });
  return { live, residue, removed, locked, hold };
}

/** 新格式塊去掉開頭的 `s1:<kid>:`，剩下密文本體。 */
const body = (bytes: string) => bytes.replace(/^s1:[0-9a-f]{16}:/, "");

const msg = (id: string, text: string): StoredMessage => ({ id, text }) as unknown as StoredMessage;
const chunksOf = (residue: { name: string; bytes: string }[]) => residue.filter((r) => r.name.endsWith(".json"));
const keysOf = (residue: { name: string; bytes: string }[]) => residue.filter((r) => r.name.endsWith(".key"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("封存刪除後的殘留可解性（ADR-0298 §3 → ADR-0413）", () => {
  const sk = generateSecretKey();
  const dek = deriveStorageKey(sk);

  it("🔴 刪除之後，塊的殘留位元組**用 nsec 導出的金鑰解不開**", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("m1", "週五老地方見")]);
    expect(await arch.loadChunk("bob", 0)).toHaveLength(1); // 刪除前讀得到

    await arch.remove("bob");
    expect(disk.live.size).toBe(0); // App 視角：刪掉了
    expect(await arch.loadChunk("bob", 0)).toEqual([]);

    // 介質視角：塊的位元組還在，但已經不是用 dek 加密的。
    const left = chunksOf(disk.residue);
    expect(left).toHaveLength(1);
    expect(left[0]!.bytes).not.toContain("週五老地方見");
    expect(left[0]!.bytes.startsWith("s1:")).toBe(true);
    expect(openValue(dek, body(left[0]!.bytes))).toBeNull();
  });

  it("🔴 每塊各自一把隨機金鑰——不是從 nsec 導出的，同樣的內容兩塊的密鑰也不同", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("old", "去年的事")]);
    await arch.append("bob", [msg("new", "上週的事")]);

    const wraps = keysOf(disk.residue);
    expect(wraps).toHaveLength(2);
    const k0 = unwrapSegmentKey(dek, wraps[0]!.bytes)!;
    const k1 = unwrapSegmentKey(dek, wraps[1]!.bytes)!;
    expect(k0).not.toEqual(k1);
    expect(k0).not.toEqual(dek);
    // 每把只開得了自己那一塊。
    const [c0, c1] = chunksOf(disk.residue);
    expect(openValue(k0, body(c0!.bytes))).toContain("去年的事");
    expect(openValue(k0, body(c1!.bytes))).toBeNull();
    expect(openValue(k1, body(c1!.bytes))).toContain("上週的事");
  });

  it("刪除時先銷毀金鑰包裹、再刪塊（順序是重點：包裹沒了，塊刪不乾淨也解不開）", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("m1", "a")]);
    await arch.append("bob", [msg("m2", "b")]);
    const before = disk.residue.length;

    await arch.remove("bob");
    expect(disk.removed).toHaveLength(4);
    expect(disk.removed.slice(0, 2).every((n) => n.endsWith(".key"))).toBe(true);
    expect(disk.removed.slice(2).every((n) => n.endsWith(".json"))).toBe(true);
    // 刪除過程不再寫任何東西（OPFS 的覆寫碰不到原本的位元組，只會多留一份）。
    expect(disk.residue.length).toBe(before);
  });

  it("🔴 一個檔刪不掉，其餘的照樣刪——不能因為一次失敗就把後面的金鑰全留下來", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("m1", "a")]);
    await arch.append("bob", [msg("m2", "b")]);
    const firstKey = [...disk.live.keys()].find((k) => k.startsWith("bob.0.") && k.endsWith(".key"))!;
    disk.locked.add(firstKey);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(arch.remove("bob")).resolves.toBeUndefined();
    expect([...disk.live.keys()]).toEqual([firstKey]); // 只剩刪不掉的那一個
    expect(await arch.loadChunk("bob", 1)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("⚠ 界線：連**金鑰包裹的殘留**都被撿回來、又有 nsec 的人，還是解得開（ADR-0298 §6）", async () => {
    // 這不是我們要的行為，是這個設計**擋不住**的那一段——釘在這裡，避免文案說過頭。
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("m1", "還是被看到了")]);
    await arch.remove("bob");

    const wrap = keysOf(disk.residue).find((r) => unwrapSegmentKey(dek, r.bytes) !== null)!;
    const seg = unwrapSegmentKey(dek, wrap.bytes)!;
    expect(openValue(seg, body(chunksOf(disk.residue)[0]!.bytes))).toContain("還是被看到了");
  });

  it("對照組：升級前的舊塊（直接用 dek 加密）刪除後殘留**仍然解得開**——保障只及於升級後寫下的塊", async () => {
    const disk = residualOpfs();
    const legacy = sealValue(dek, JSON.stringify([msg("m0", "升級前的訊息")]));
    disk.live.set("bob.0.json", legacy);
    disk.residue.push({ name: "bob.0.json", bytes: legacy });

    const arch = (await openOpfsArchive("ns", dek))!;
    expect(await arch.loadChunk("bob", 0)).toHaveLength(1); // 舊塊照常讀得到
    await arch.remove("bob");
    expect(openValue(dek, chunksOf(disk.residue)[0]!.bytes)).toContain("升級前的訊息");
  });
});

describe("OPFS 封存的基本行為（每塊金鑰加進來之後不能壞的東西）", () => {
  const dek = deriveStorageKey(generateSecretKey());

  it("塊數只數塊檔，不數金鑰包裹；讀回的內容與順序不變", async () => {
    residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    expect(await arch.chunkCount("bob")).toBe(0);
    await arch.append("bob", [msg("a", "1")]);
    await arch.append("bob", [msg("b", "2")]);
    expect(await arch.chunkCount("bob")).toBe(2);
    expect((await arch.loadChunk("bob", 0))[0]!.id).toBe("a");
    expect((await arch.loadChunk("bob", 1))[0]!.id).toBe("b");
    expect(await arch.loadChunk("bob", 2)).toEqual([]);
  });

  it("🔴 有 Web Locks：兩個分頁同時封存，兩塊都留下來（第二個分頁拿到下一個 seq）", async () => {
    const disk = residualOpfs({ locks: true });
    const tabA = (await openOpfsArchive("ns", dek))!;
    const tabB = (await openOpfsArchive("ns", dek))!;
    let release!: () => void;
    disk.hold.set("bob.0.json", new Promise<void>((r) => (release = r)));
    const a = tabA.append("bob", [msg("a", "分頁 A 的")]);
    await new Promise((r) => setTimeout(r, 0));
    const b = tabB.append("bob", [msg("b", "分頁 B 的")]); // 等 A 的鎖
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([a, b]);

    expect(await tabB.chunkCount("bob")).toBe(2);
    expect((await tabB.loadChunk("bob", 0))[0]!.text).toBe("分頁 A 的");
    expect((await tabB.loadChunk("bob", 1))[0]!.text).toBe("分頁 B 的");
  });

  it("🔴 有 Web Locks：移除身分等正在寫的那一塊寫完才刪，不留下剛寫的包裹與塊", async () => {
    const disk = residualOpfs({ locks: true });
    const arch = (await openOpfsArchive("ns", dek))!;
    let release!: () => void;
    disk.hold.set("bob.0.json", new Promise<void>((r) => (release = r)));
    const writing = arch.append("bob", [msg("a", "剛好在搬")]);
    await new Promise((r) => setTimeout(r, 0));
    const wiping = wipeOpfsArchive("ns");
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([writing, wiping]);

    expect(disk.live.size).toBe(0);
  });

  it("沒有 Web Locks：兩個分頁同時封存同一個 seq，留下來的那一塊讀得到（不會配到另一個分頁的金鑰）", async () => {
    const disk = residualOpfs();
    const tabA = (await openOpfsArchive("ns", dek))!;
    const tabB = (await openOpfsArchive("ns", dek))!;
    // A 的塊最後才落地：A 先算出 seq 0、寫了包裹，塊卡在關閉前；B 整個做完；A 才寫完。
    let release!: () => void;
    disk.hold.set("bob.0.json", new Promise<void>((r) => (release = r)));
    const a = tabA.append("bob", [msg("a", "分頁 A 的")]);
    await new Promise((r) => setTimeout(r, 0));
    await tabB.append("bob", [msg("b", "分頁 B 的")]);
    release();
    await a;

    expect(await tabB.chunkCount("bob")).toBe(1);
    const got = await tabB.loadChunk("bob", 0);
    expect(got).toHaveLength(1); // 後寫者贏；重點是**不是空的**
    expect(got[0]!.text).toBe("分頁 A 的");
    // 移除時兩份包裹都清掉。
    await tabA.remove("bob");
    expect(disk.live.size).toBe(0);
  });

  it("🔴 降回舊版又升級：舊版在同一個 seq 寫下的塊讀得到，不會被留下來的包裹拿去解", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("new", "新版寫的")]);
    // 舊版的 remove 只刪 `.json`、留下包裹；之後在同一個 seq 用 dek 直接加密寫下一塊。
    disk.live.delete("bob.0.json");
    disk.live.set("bob.0.json", sealValue(dek, JSON.stringify([msg("old", "舊版寫的")])));

    expect((await arch.loadChunk("bob", 0))[0]!.text).toBe("舊版寫的");
  });

  it("新格式塊的包裹不在了（刪到一半）→ 讀不到，也不會退回用 nsec 的金鑰硬解", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("a", "x")]);
    for (const k of [...disk.live.keys()]) if (k.endsWith(".key")) disk.live.delete(k);
    expect(await arch.loadChunk("bob", 0)).toEqual([]);
  });

  it("寫完包裹、還沒寫塊就當機 → 下一次 append 用同一個 seq 重來，讀得到", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    disk.live.set("bob.0.0123456789abcdef.key", "k1:孤兒包裹"); // 上一次只寫到包裹
    expect(await arch.chunkCount("bob")).toBe(0);
    await arch.append("bob", [msg("a", "重來的那一塊")]);
    expect(await arch.chunkCount("bob")).toBe(1);
    expect((await arch.loadChunk("bob", 0))[0]!.text).toBe("重來的那一塊");
  });

  it("換了 nsec（錯的根金鑰）讀不到，原本的金鑰回來就還讀得到", async () => {
    residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("a", "x")]);
    const other = (await openOpfsArchive("ns", deriveStorageKey(generateSecretKey())))!;
    expect(await other.loadChunk("bob", 0)).toEqual([]);
    expect(await arch.loadChunk("bob", 0)).toHaveLength(1);
  });

  it("移除只動這個對話：名稱是它前綴的鄰居不受影響", async () => {
    residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("a", "b")]);
    await arch.append("bobby", [msg("c", "bb")]);
    await arch.remove("bob");
    expect(await arch.chunkCount("bob")).toBe(0);
    expect(await arch.loadChunk("bobby", 0)).toHaveLength(1);
  });

  it("沒有金鑰（明文模式）：照舊寫明文、不產生金鑰包裹", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns"))!;
    await arch.append("bob", [msg("a", "明文")]);
    expect([...disk.live.keys()]).toEqual(["bob.0.json"]);
    expect((await arch.loadChunk("bob", 0))[0]!.text).toBe("明文");
  });
});

describe("移除身分時連封存一起清（ADR-0202／0413）", () => {
  const dek = deriveStorageKey(generateSecretKey());

  it("🔴 整個身分的封存都刪掉，而且每一份金鑰包裹都先銷毀——殘留的塊用 nsec 解不開", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("ns", dek))!;
    await arch.append("bob", [msg("a", "給 bob 的")]);
    await arch.append("carol", [msg("b", "給 carol 的")]);

    await wipeOpfsArchive("ns");
    expect(disk.live.size).toBe(0);
    // 包裹先刪、塊後刪。
    const firstChunk = disk.removed.findIndex((n) => n.endsWith(".json"));
    expect(disk.removed.slice(0, firstChunk).filter((n) => n.endsWith(".key"))).toHaveLength(2);
    for (const c of chunksOf(disk.residue)) expect(openValue(dek, body(c.bytes))).toBeNull();
  });

  it("空的 namespace 不做事（舊的單一身分共用 legacy 目錄，不能被別的身分的移除波及）", async () => {
    const disk = residualOpfs();
    const arch = (await openOpfsArchive("", dek))!;
    await arch.append("bob", [msg("a", "x")]);
    await wipeOpfsArchive("");
    expect(disk.live.size).toBe(2);
  });

  it("沒有 OPFS 的環境：安靜地什麼都不做", async () => {
    vi.stubGlobal("navigator", {});
    await expect(wipeOpfsArchive("ns")).resolves.toBeUndefined();
  });
});
