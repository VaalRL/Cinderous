import { beforeEach, describe, expect, it } from "vitest";
import { ARCHIVE_CHUNK, ArchiveWriter, HOT_CAP, loadAllArchived, type MessageArchive } from "./archive.js";
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
