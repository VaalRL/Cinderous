import { beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_CHUNK,
  ArchiveWriter,
  HOT_CAP,
  loadAllArchived,
  type MessageArchive,
  nextOlderChunk,
  prependChunk,
} from "./archive.js";
import { LocalStorage } from "./local.js";
import { MemoryStorage } from "./memory.js";
import type { StoredMessage } from "./types.js";

/** 記憶體封存替身（可注入失敗，用來驗「封存失敗絕不裁切熱區」）。 */
class FakeArchive implements MessageArchive {
  readonly chunks = new Map<string, StoredMessage[][]>();
  failNext = false;

  append(convo: string, messages: StoredMessage[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("磁碟寫入失敗"));
    }
    const list = this.chunks.get(convo) ?? [];
    list.push([...messages]);
    this.chunks.set(convo, list);
    return Promise.resolve();
  }
  chunkCount(convo: string): Promise<number> {
    return Promise.resolve(this.chunks.get(convo)?.length ?? 0);
  }
  loadChunk(convo: string, seq: number): Promise<StoredMessage[]> {
    return Promise.resolve(this.chunks.get(convo)?.[seq] ?? []);
  }
  remove(convo: string): Promise<void> {
    this.chunks.delete(convo);
    return Promise.resolve();
  }
}

const msg = (i: number): StoredMessage => ({ id: `m${i}`, contact: "bob", outgoing: false, text: `#${i}`, at: i });

/** 小上限的 writer（免灌 6,000 則）。 */
function writerWith(hotCap: number, archive: MessageArchive, mem = new MemoryStorage()) {
  return { mem, writer: new ArchiveWriter(mem, archive, () => {}, hotCap) };
}

describe("訊息封存（ADR-0111）", () => {
  it("溢出滿一整塊才搬——不足一塊時熱區原封不動", async () => {
    const arch = new FakeArchive();
    const { mem, writer } = writerWith(10, arch);
    for (let i = 0; i < 10 + ARCHIVE_CHUNK - 1; i++) mem.appendMessage(msg(i));
    writer.schedule("bob");
    await writer.flush();

    expect(await arch.chunkCount("bob")).toBe(0);
    expect(mem.loadMessages("bob")).toHaveLength(10 + ARCHIVE_CHUNK - 1);
  });

  it("滿一塊 → 最舊的 1,000 則移入封存，熱區回到上限", async () => {
    const arch = new FakeArchive();
    const { mem, writer } = writerWith(10, arch);
    for (let i = 0; i < 10 + ARCHIVE_CHUNK; i++) mem.appendMessage(msg(i));
    writer.schedule("bob");
    await writer.flush();

    expect(await arch.chunkCount("bob")).toBe(1);
    const chunk = await arch.loadChunk("bob", 0);
    expect(chunk).toHaveLength(ARCHIVE_CHUNK);
    expect(chunk[0]!.id).toBe("m0"); // 搬走的是最舊的
    expect(mem.loadMessages("bob")).toHaveLength(10);
    expect(mem.loadMessages("bob")[0]!.id).toBe(`m${ARCHIVE_CHUNK}`);
  });

  it("**封存寫入失敗 → 熱區絕不裁切**（不可讓失敗變成永久遺失）", async () => {
    const arch = new FakeArchive();
    const { mem, writer } = writerWith(10, arch);
    for (let i = 0; i < 10 + ARCHIVE_CHUNK; i++) mem.appendMessage(msg(i));
    arch.failNext = true;
    writer.schedule("bob");
    await writer.flush();

    expect(await arch.chunkCount("bob")).toBe(0);
    expect(mem.loadMessages("bob")).toHaveLength(10 + ARCHIVE_CHUNK); // 一則都沒少
  });

  it("封存 + 熱區合起來就是完整歷史，且順序正確（封存在前）", async () => {
    const arch = new FakeArchive();
    const { mem, writer } = writerWith(10, arch);
    const total = 10 + ARCHIVE_CHUNK * 2;
    for (let i = 0; i < total; i++) mem.appendMessage(msg(i));
    writer.schedule("bob");
    await writer.flush();

    const all = [...(await loadAllArchived(arch, "bob")), ...mem.loadMessages("bob")];
    expect(all).toHaveLength(total);
    expect(all.map((m) => m.id)).toEqual(Array.from({ length: total }, (_, i) => `m${i}`));
  });

  it("同一對話的多次搬移不會交錯（promise 鏈序列化）", async () => {
    const arch = new FakeArchive();
    const { mem, writer } = writerWith(10, arch);
    for (let i = 0; i < 10 + ARCHIVE_CHUNK * 3; i++) mem.appendMessage(msg(i));
    writer.schedule("bob");
    writer.schedule("bob"); // 併發排程
    writer.schedule("bob");
    await writer.flush();

    expect(await arch.chunkCount("bob")).toBe(3);
    expect(mem.loadMessages("bob")).toHaveLength(10);
    // 三塊各 1,000 則、彼此不重疊
    const ids = new Set((await loadAllArchived(arch, "bob")).map((m) => m.id));
    expect(ids.size).toBe(ARCHIVE_CHUNK * 3);
  });

  it("熱區上限與塊大小的關係：HOT_CAP 遠大於一塊，避免頻繁搬移", () => {
    expect(HOT_CAP).toBeGreaterThanOrEqual(ARCHIVE_CHUNK * 2);
  });
});

describe("封存接上 LocalStorage（ADR-0111）", () => {
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

  it("**未掛封存 → 絕不裁切**（沒有封存就沒有上限；不可讓「封存不可用」變成「訊息被刪掉」）", () => {
    const s = new LocalStorage("ns");
    for (let i = 0; i < HOT_CAP + ARCHIVE_CHUNK + 10; i++) s.appendMessage(msg(i));
    expect(s.loadMessages("bob")).toHaveLength(HOT_CAP + ARCHIVE_CHUNK + 10);
  });

  it("掛上封存 → 溢出的訊息搬進封存，且裁切後的熱區有落地（重載後仍是熱區大小）", async () => {
    const arch = new FakeArchive();
    const s = new LocalStorage("ns");
    s.attachArchive(arch);
    for (let i = 0; i < HOT_CAP + ARCHIVE_CHUNK; i++) s.appendMessage(msg(i));
    await s.flushArchive();

    expect(await arch.chunkCount("bob")).toBe(1);
    expect(s.loadMessages("bob")).toHaveLength(HOT_CAP);
    expect(new LocalStorage("ns").loadMessages("bob")).toHaveLength(HOT_CAP); // 裁切結果已落地
  });

  it("刪除聯絡人 → 封存也一起清（否則刪好友卻留下歷史）", async () => {
    const arch = new FakeArchive();
    const s = new LocalStorage("ns");
    s.attachArchive(arch);
    s.addContact({ pubkey: "bob", name: "Bob" });
    await arch.append("bob", [msg(1)]);
    s.removeContact("bob");
    expect(await arch.chunkCount("bob")).toBe(0);
  });
});

describe("歷史紀錄分頁（ADR-0111，桌面與行動共用）", () => {
  const m = (id: string): StoredMessage => ({ id, contact: "bob", outgoing: false, text: id, at: 1 });

  it("由新到舊逐塊往回：先看最新一塊，再往更舊翻，翻完回 null", () => {
    expect(nextOlderChunk(3, -1)).toBe(2); // 尚未載入 → 從最新（最大 seq）開始
    expect(nextOlderChunk(3, 2)).toBe(1);
    expect(nextOlderChunk(3, 1)).toBe(0);
    expect(nextOlderChunk(3, 0)).toBeNull(); // 已到最舊
  });

  it("沒有任何封存 → 沒有東西可翻", () => {
    expect(nextOlderChunk(0, -1)).toBeNull();
  });

  it("併入更舊的一塊：接在前面（較舊在上）", () => {
    expect(prependChunk([m("c")], [m("a"), m("b")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("**去重**：當機窗口可能讓同一則同時存在於封存與熱區——讀取端必須自己收斂", () => {
    expect(prependChunk([m("b"), m("c")], [m("a"), m("b")]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("保留上限＝封存門檻，不再刪除（ADR-0126）", () => {
  it("🔴 **使用者設小上限 → 溢出進封存，不刪除**（統一兩個各說各話的上限）", async () => {
    const arch = new FakeArchive();
    const mem = new MemoryStorage();
    mem.attachArchive(arch); // mem 自帶 writer（預設 hotCap＝HOT_CAP）
    mem.setMaxPerConvo(10); // 但保留上限 10 會覆蓋 → 有效熱區＝10（ADR-0126）

    // 加 10 + 一整塊 → 觸發一次封存搬移。
    for (let i = 0; i < 10 + ARCHIVE_CHUNK; i++) mem.appendMessage(msg(i));
    await mem.flushArchive();

    // 修正前：`cap()` 會把它 splice 刪到剩 10，封存永遠不被觸發，舊訊息**永久消失**。
    expect(mem.loadMessages("bob")).toHaveLength(10); // 熱區＝上限
    const archived = await loadAllArchived(arch, "bob");
    expect(archived).toHaveLength(ARCHIVE_CHUNK); // 溢出**在封存裡**，沒有不見
    // 熱＋冷＝全部，一則不少。
    const all = new Set([...mem.loadMessages("bob"), ...archived].map((m) => m.id));
    expect(all.size).toBe(10 + ARCHIVE_CHUNK);
  });

  it("調低上限 → **即刻**重新封存既有溢出（不必等下一則訊息）", async () => {
    const arch = new FakeArchive();
    const mem = new MemoryStorage();
    mem.attachArchive(arch);
    // 先無上限累積一塊多。
    for (let i = 0; i < ARCHIVE_CHUNK + 20; i++) mem.appendMessage(msg(i));
    await mem.flushArchive();
    expect(mem.loadMessages("bob")).toHaveLength(ARCHIVE_CHUNK + 20); // 還沒到 HOT_CAP，全在熱區

    mem.setMaxPerConvo(10); // 調到 10 → 立刻封存溢出
    await mem.flushArchive();
    expect(mem.loadMessages("bob")).toHaveLength(20); // 剩最新 20（熱區在 [10,10+塊) 間；此處恰好一塊）
    expect(await loadAllArchived(arch, "bob")).toHaveLength(ARCHIVE_CHUNK);
  });

  it("封存搬移**同步清掉 id 索引**——不留指向已搬走訊息的幽靈", async () => {
    const arch = new FakeArchive();
    const mem = new MemoryStorage();
    mem.attachArchive(arch);
    mem.setMaxPerConvo(10);
    for (let i = 0; i < 10 + ARCHIVE_CHUNK; i++) mem.appendMessage(msg(i));
    await mem.flushArchive();

    // m0 已被搬進封存、離開熱區。改它的狀態不該改到熱區裡的幽靈。
    mem.setMessageStatus("bob", "m0", "read");
    expect(mem.loadMessages("bob").some((m) => m.id === "m0")).toBe(false);
    // 且它的 id 可重新加入（索引沒殘留 → 不被誤判重複）。
    mem.appendMessage(msg(0));
    expect(mem.loadMessages("bob").some((m) => m.id === "m0")).toBe(true);
  });

  it("無上限（0）→ 沿用 HOT_CAP，行為不變", async () => {
    const arch = new FakeArchive();
    const { mem, writer } = writerWith(10, arch); // 建構 hotCap=10 當「HOT_CAP 替身」
    // 沒有 setMaxPerConvo → retentionCap()＝0 → 用建構的 hotCap（10）。
    for (let i = 0; i < 10 + ARCHIVE_CHUNK; i++) mem.appendMessage(msg(i));
    for (let i = 0; i < 10 + ARCHIVE_CHUNK; i++) writer.schedule("bob");
    await writer.flush();
    expect(mem.loadMessages("bob")).toHaveLength(10);
  });
});
