import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";
import { isThumbnailable, THUMB_MAX_BYTES } from "./types.js";
import { exportRecords } from "./export.js";
import type { MessageArchive } from "./archive.js";
import type { StoredMessage } from "./types.js";

/** 建一份含文字、檔案、群訊、回應、已收回的儲存作為測試素材。 */
function seed(): MemoryStorage {
  const s = new MemoryStorage();
  s.addContact({ pubkey: "bob", name: "Bob" });
  s.saveGroup({ id: "g1", name: "好友", admin: "me", members: ["me", "bob"] });
  s.appendMessage({ id: "m1", contact: "bob", outgoing: true, text: "晚點打給你", at: 1_700_000_000_000 });
  s.appendMessage({ id: "m2", contact: "bob", outgoing: false, text: "好", at: 1_700_000_060_000 });
  s.appendMessage({
    id: "m3",
    contact: "bob",
    outgoing: false,
    text: "",
    at: 1_700_000_120_000,
    file: { tid: "f1", name: "report.pdf", size: 20480, mime: "application/pdf", savedPath: "D:/下載/report.pdf" },
  });
  s.appendMessage({ id: "gm1", contact: "g1", outgoing: false, text: "嗨大家", at: 1_700_000_200_000, sender: "bob" });
  s.addReaction({ id: "r1", messageId: "m2", emoji: "👍", mine: true });
  s.markDeleted("m1");
  return s;
}

describe("明文紀錄導出（ADR-0094）", () => {
  it("TXT：含對話標頭、時間、對象、文字；檔案顯示為 metadata 行含儲存路徑", async () => {
    const txt = await exportRecords(seed(), "txt", { now: 1_700_000_300_000 });
    expect(txt).toContain("對話：Bob");
    expect(txt).toContain("Bob：好");
    expect(txt).toContain("📄 report.pdf");
    expect(txt).toContain("D:/下載/report.pdf");
    expect(txt).toContain("群組：好友");
  });

  it("已收回訊息標「（已收回）」、不外洩原文", async () => {
    const txt = await exportRecords(seed(), "txt", {});
    expect(txt).toContain("（已收回）");
    expect(txt).not.toContain("晚點打給你");
  });

  it("emoji 回應附在對應訊息後；可關閉", async () => {
    expect(await exportRecords(seed(), "txt", {})).toContain("👍");
    expect(await exportRecords(seed(), "txt", { includeReactions: false })).not.toContain("👍");
  });

  it("Markdown：標題與清單格式", async () => {
    const md = await exportRecords(seed(), "md", {});
    expect(md).toContain("# Cinderous 對話紀錄導出");
    expect(md).toContain("## 對話：Bob");
    expect(md).toMatch(/- \*\*\[.+\] Bob：\*\* 好/);
  });

  it("JSON：結構化、含 file metadata 與回應、時間為原始毫秒", async () => {
    const json = JSON.parse(await exportRecords(seed(), "json", { now: 42 }));
    expect(json.app).toBe("Cinderous");
    expect(json.exportedAt).toBe(42);
    const bob = json.conversations.find((c: { name: string }) => c.name === "Bob");
    expect(bob.kind).toBe("contact");
    const fileMsg = bob.messages.find((m: { id: string }) => m.id === "m3");
    expect(fileMsg.file).toMatchObject({ name: "report.pdf", size: 20480, savedPath: "D:/下載/report.pdf" });
    const reacted = bob.messages.find((m: { id: string }) => m.id === "m2");
    expect(reacted.reactions).toEqual(["👍"]);
    expect(bob.messages.find((m: { id: string }) => m.id === "m1").deleted).toBe(true);
  });

  it("範圍可選：只導出指定對話鍵", async () => {
    const onlyGroup = await exportRecords(seed(), "txt", { keys: ["g1"] });
    expect(onlyGroup).toContain("群組：好友");
    expect(onlyGroup).not.toContain("對話：Bob");
  });

  it("群訊以 sender 名標示對象", async () => {
    expect(await exportRecords(seed(), "txt", { keys: ["g1"] })).toContain("Bob：嗨大家");
  });

  it("不含私鑰／檔案本體（只有 metadata）", async () => {
    const s = seed();
    s.saveIdentity({ nsec: "nsec1SECRET", name: "me" });
    const all = await exportRecords(s, "json", {});
    expect(all).not.toContain("nsec1SECRET");
  });
});

describe("圖片縮圖持久化（ADR-0102）", () => {
  const img = (thumb?: string) => ({
    id: "p1",
    contact: "bob",
    outgoing: false,
    text: "",
    at: 1,
    file: { tid: "t1", name: "a.png", size: 900, mime: "image/png", ...(thumb ? { thumb } : {}) },
  });

  it("縮圖跨 session 存活（重載後仍在）——這正是相簿空掉的根因修正", async () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.appendMessage(img());
    s.setFileThumb("bob", "p1", "data:image/jpeg;base64,AAAA");
    // 模擬重載：快照 export/import（等同 Tauri 加密 blob 的來回）
    const restored = new MemoryStorage();
    restored.importSnapshot(s.exportSnapshot());
    expect(restored.loadMessages("bob")[0]?.file?.thumb).toBe("data:image/jpeg;base64,AAAA");
  });

  it("超過上限的縮圖不存（寧可沒縮圖，也不讓儲存膨脹）", async () => {
    const s = new MemoryStorage();
    s.appendMessage(img());
    s.setFileThumb("bob", "p1", "x".repeat(THUMB_MAX_BYTES + 1));
    expect(s.loadMessages("bob")[0]?.file?.thumb).toBeUndefined();
  });

  it("原檔位元組**依然不保存**（ADR-0093 裁示不變）：只有 metadata 與縮圖", async () => {
    const s = new MemoryStorage();
    s.appendMessage(img("data:image/jpeg;base64,AAAA"));
    const f = s.loadMessages("bob")[0]?.file;
    expect(Object.keys(f ?? {}).sort()).toEqual(["mime", "name", "size", "thumb", "tid"]);
  });

  it("isThumbnailable：只認點陣圖；SVG 排除（可執行標記，不必要的攻擊面）", async () => {
    expect(isThumbnailable("image/png")).toBe(true);
    expect(isThumbnailable("image/jpeg")).toBe(true);
    expect(isThumbnailable("image/svg+xml")).toBe(false);
    expect(isThumbnailable("application/pdf")).toBe(false);
  });
});

describe("匯出必須含封存（ADR-0111）", () => {
  class FakeArchive implements MessageArchive {
    constructor(private readonly chunks: StoredMessage[][]) {}
    append(): Promise<void> {
      return Promise.resolve();
    }
    chunkCount(): Promise<number> {
      return Promise.resolve(this.chunks.length);
    }
    loadChunk(_convo: string, seq: number): Promise<StoredMessage[]> {
      return Promise.resolve(this.chunks[seq] ?? []);
    }
    remove(): Promise<void> {
      return Promise.resolve();
    }
  }
  const m = (id: string, at: number, text: string): StoredMessage => ({
    id,
    contact: "bob",
    outgoing: false,
    text,
    at,
  });

  it("封存的舊訊息一定要出現在匯出裡——只讀熱區會**靜默漏掉**使用者最想留的部分", async () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.appendMessage(m("hot1", 300, "熱區訊息"));
    const arch = new FakeArchive([[m("old1", 100, "很久以前")], [m("old2", 200, "有點久以前")]]);
    s.attachArchive?.(arch);

    const txt = await exportRecords(s, "txt", { now: 0 });
    expect(txt).toContain("很久以前");
    expect(txt).toContain("有點久以前");
    expect(txt).toContain("熱區訊息");
    // 順序：封存在前（較舊）
    expect(txt.indexOf("很久以前")).toBeLessThan(txt.indexOf("熱區訊息"));
  });

  it("重複去重：當機窗口可能讓同一則同時存在於封存與熱區（刻意；寧可重複不可遺失）", async () => {
    const s = new MemoryStorage();
    s.addContact({ pubkey: "bob", name: "Bob" });
    s.appendMessage(m("dup", 100, "只該出現一次"));
    s.attachArchive?.(new FakeArchive([[m("dup", 100, "只該出現一次")]]));

    const txt = await exportRecords(s, "txt", { now: 0 });
    expect(txt.split("只該出現一次")).toHaveLength(2); // 出現剛好一次
  });
});
