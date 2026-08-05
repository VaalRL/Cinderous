import { describe, expect, it } from "vitest";
import type { CustomSticker } from "./sticker-library.js";
import { activeSuggest, clampSel, moveSel, suggestAcceptOnEnter, suggestCount } from "./composer-suggest.js";
import type { TriggerEntry } from "./sticker-triggers.js";

const emoji = (shortcode: string): CustomSticker => ({
  id: shortcode,
  label: shortcode,
  svg: "<svg/>",
  kind: "emoji",
  shortcode,
});

const cands = [
  { pubkey: "pk_alice", name: "Alice" },
  { pubkey: "pk_bob", name: "Bob" },
];
const library = [emoji("smile"), emoji("smirk"), emoji("wave")];
const commands = [{ id: "code" }, { id: "list" }];
const triggers: TriggerEntry[] = [{ trigger: "ok", ref: { pack: "p", id: "1" } }];

describe("activeSuggest — 單一建議與優先序（ADR-0308 §4）", () => {
  it("@提及優先於其他", () => {
    const s = activeSuggest({ text: "嗨 @Al", mentionCandidates: cands, emojiLibrary: library, slashCommands: commands });
    expect(s?.kind).toBe("mention");
  });

  it(":短碼在無提及時命中", () => {
    const s = activeSuggest({ text: "哈 :sm", mentionCandidates: cands, emojiLibrary: library });
    expect(s?.kind).toBe("emoji");
    expect(suggestCount(s)).toBe(2); // smile, smirk
  });

  it("斜線在無提及／短碼時命中", () => {
    const s = activeSuggest({ text: "/co", mentionCandidates: cands, emojiLibrary: library, slashCommands: commands });
    expect(s?.kind).toBe("slash");
  });

  it("貼圖觸發字優先序最低", () => {
    const s = activeSuggest({ text: "ok", triggers, slashCommands: commands });
    expect(s?.kind).toBe("trigger");
  });

  it("同時只回一個建議——短碼命中時不回觸發字", () => {
    const both = activeSuggest({ text: ":sm", emojiLibrary: library, triggers });
    expect(both?.kind).toBe("emoji");
  });

  it("無命中回 null", () => {
    expect(activeSuggest({ text: "普通訊息", mentionCandidates: cands, emojiLibrary: library })).toBeNull();
  });

  it("dismissed（Esc）時一律不建議", () => {
    expect(activeSuggest({ text: "嗨 @Al", mentionCandidates: cands, dismissed: true })).toBeNull();
  });
});

describe("activeSuggest — 企業政策與可解析性", () => {
  it("停用貼圖時不做短碼補全（ADR-0048）", () => {
    const s = activeSuggest({ text: ":sm", emojiLibrary: library, stickersDisabled: true });
    expect(s).toBeNull();
  });

  it("🔴 停用貼圖時**觸發字也不建議**（ADR-0310：接受觸發字＝送出貼圖，不能留鍵盤捷徑）", () => {
    expect(activeSuggest({ text: "ok", triggers })?.kind).toBe("trigger"); // 政策未開＝照常
    expect(activeSuggest({ text: "ok", triggers, stickersDisabled: true })).toBeNull();
  });

  it("停用只影響建議，不動觸發字資料（政策解除即恢復）", () => {
    const before = [...triggers];
    activeSuggest({ text: "ok", triggers, stickersDisabled: true });
    expect(triggers).toEqual(before);
  });

  it("觸發字指向已刪貼圖時濾掉（懸空參照不顯示）", () => {
    const s = activeSuggest({ text: "ok", triggers, triggerResolvable: () => false });
    expect(s).toBeNull();
  });
});

describe("Enter 可否接受（ADR-0037 契約）", () => {
  it("提及／短碼／斜線可用 Enter 接受", () => {
    expect(suggestAcceptOnEnter(activeSuggest({ text: "@Al", mentionCandidates: cands }))).toBe(true);
    expect(suggestAcceptOnEnter(activeSuggest({ text: ":sm", emojiLibrary: library }))).toBe(true);
    expect(suggestAcceptOnEnter(activeSuggest({ text: "/co", slashCommands: commands }))).toBe(true);
  });

  it("貼圖觸發字（接受即送出）不可用 Enter 接受", () => {
    expect(suggestAcceptOnEnter(activeSuggest({ text: "ok", triggers }))).toBe(false);
  });

  it("無建議時為 false", () => {
    expect(suggestAcceptOnEnter(null)).toBe(false);
  });
});

describe("選取索引", () => {
  it("clampSel 夾在有效範圍（候選變少時不越界）", () => {
    expect(clampSel(5, 2)).toBe(1);
    expect(clampSel(1, 0)).toBe(0);
    expect(clampSel(0, 3)).toBe(0);
  });

  it("moveSel 環狀移動", () => {
    expect(moveSel(0, 1, 3)).toBe(1);
    expect(moveSel(2, 1, 3)).toBe(0);
    expect(moveSel(0, -1, 3)).toBe(2);
    expect(moveSel(0, 1, 0)).toBe(0);
  });
});
