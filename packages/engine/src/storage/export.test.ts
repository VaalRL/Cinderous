import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";
import { exportRecords } from "./export.js";

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
  it("TXT：含對話標頭、時間、對象、文字；檔案顯示為 metadata 行含儲存路徑", () => {
    const txt = exportRecords(seed(), "txt", { now: 1_700_000_300_000 });
    expect(txt).toContain("對話：Bob");
    expect(txt).toContain("Bob：好");
    expect(txt).toContain("📄 report.pdf");
    expect(txt).toContain("D:/下載/report.pdf");
    expect(txt).toContain("群組：好友");
  });

  it("已收回訊息標「（已收回）」、不外洩原文", () => {
    const txt = exportRecords(seed(), "txt", {});
    expect(txt).toContain("（已收回）");
    expect(txt).not.toContain("晚點打給你");
  });

  it("emoji 回應附在對應訊息後；可關閉", () => {
    expect(exportRecords(seed(), "txt", {})).toContain("👍");
    expect(exportRecords(seed(), "txt", { includeReactions: false })).not.toContain("👍");
  });

  it("Markdown：標題與清單格式", () => {
    const md = exportRecords(seed(), "md", {});
    expect(md).toContain("# Cinder 對話紀錄導出");
    expect(md).toContain("## 對話：Bob");
    expect(md).toMatch(/- \*\*\[.+\] Bob：\*\* 好/);
  });

  it("JSON：結構化、含 file metadata 與回應、時間為原始毫秒", () => {
    const json = JSON.parse(exportRecords(seed(), "json", { now: 42 }));
    expect(json.app).toBe("Cinder");
    expect(json.exportedAt).toBe(42);
    const bob = json.conversations.find((c: { name: string }) => c.name === "Bob");
    expect(bob.kind).toBe("contact");
    const fileMsg = bob.messages.find((m: { id: string }) => m.id === "m3");
    expect(fileMsg.file).toMatchObject({ name: "report.pdf", size: 20480, savedPath: "D:/下載/report.pdf" });
    const reacted = bob.messages.find((m: { id: string }) => m.id === "m2");
    expect(reacted.reactions).toEqual(["👍"]);
    expect(bob.messages.find((m: { id: string }) => m.id === "m1").deleted).toBe(true);
  });

  it("範圍可選：只導出指定對話鍵", () => {
    const onlyGroup = exportRecords(seed(), "txt", { keys: ["g1"] });
    expect(onlyGroup).toContain("群組：好友");
    expect(onlyGroup).not.toContain("對話：Bob");
  });

  it("群訊以 sender 名標示對象", () => {
    expect(exportRecords(seed(), "txt", { keys: ["g1"] })).toContain("Bob：嗨大家");
  });

  it("不含私鑰／檔案本體（只有 metadata）", () => {
    const s = seed();
    s.saveIdentity({ nsec: "nsec1SECRET", name: "me" });
    const all = exportRecords(s, "json", {});
    expect(all).not.toContain("nsec1SECRET");
  });
});
