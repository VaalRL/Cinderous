import { describe, expect, it } from "vitest";
import { applySlash, SLASH_SUGGEST_MAX, suggestSlash, type SlashCommand } from "./slash-command.js";

const cmds: SlashCommand[] = [
  { id: "code", aliases: ["程式碼"] },
  { id: "list", aliases: ["清單"] },
  { id: "callout", aliases: ["提示框"] },
  { id: "sticker", aliases: ["貼圖"] },
];

describe("suggestSlash（ADR-0309）", () => {
  it("只打 / 即列出全部命令", () => {
    const s = suggestSlash("/", cmds);
    expect(s?.commands.map((c) => c.id)).toEqual(["code", "list", "callout", "sticker"]);
    expect(s?.query).toBe("");
    expect(s?.start).toBe(0);
  });

  it("前綴過濾 id，大小寫不敏感", () => {
    expect(suggestSlash("/c", cmds)?.commands.map((c) => c.id)).toEqual(["code", "callout"]);
    expect(suggestSlash("/co", cmds)?.commands.map((c) => c.id)).toEqual(["code"]);
    expect(suggestSlash("/LI", cmds)?.commands.map((c) => c.id)).toEqual(["list"]);
  });

  it("繁中別名也可比對", () => {
    expect(suggestSlash("/貼", cmds)?.commands.map((c) => c.id)).toEqual(["sticker"]);
  });

  it("行首（換行後）也觸發", () => {
    const s = suggestSlash("第一行\n/c", cmds);
    expect(s?.commands.map((c) => c.id)).toEqual(["code", "callout"]);
    expect(s?.start).toBe(4); // "第一行\n" 之後
  });

  it("不在行首不觸發——日期 3/15 不受影響", () => {
    expect(suggestSlash("3/15 見", cmds)).toBeNull();
    expect(suggestSlash("3/1", cmds)).toBeNull();
    expect(suggestSlash("and/or", cmds)).toBeNull();
  });

  it("含第二個斜線不觸發——路徑不受影響", () => {
    expect(suggestSlash("/usr/bin", cmds)).toBeNull();
    expect(suggestSlash("//", cmds)).toBeNull();
  });

  it("token 後有空白即結束，不再觸發", () => {
    expect(suggestSlash("/code ", cmds)).toBeNull();
    expect(suggestSlash("/code 內容", cmds)).toBeNull();
  });

  it("無命中回傳 null（不顯示空列）", () => {
    expect(suggestSlash("/zzz", cmds)).toBeNull();
  });

  it("候選數以 SLASH_SUGGEST_MAX 為上限", () => {
    const many: SlashCommand[] = Array.from({ length: SLASH_SUGGEST_MAX + 3 }, (_, i) => ({ id: `c${i}` }));
    expect(suggestSlash("/", many)?.commands).toHaveLength(SLASH_SUGGEST_MAX);
  });
});

describe("applySlash（ADR-0309）", () => {
  it("接受後把 /命令 片段自草稿移除", () => {
    const s = suggestSlash("/co", cmds)!;
    expect(applySlash("/co", s)).toBe("");
  });

  it("保留同一則草稿的其餘文字", () => {
    const s = suggestSlash("前面\n/co", cmds)!;
    expect(applySlash("前面\n/co", s)).toBe("前面\n");
  });
});
