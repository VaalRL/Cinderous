import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./types.js";
import { mainMessages, replyCounts, rootIdOf, threadMessages } from "./thread-util.js";

const msg = (id: string, at: number, replyTo?: string): ChatMessage => ({
  id,
  outgoing: false,
  text: id,
  at,
  ...(replyTo !== undefined ? { replyTo } : {}),
});

const msgs: ChatMessage[] = [
  msg("r1", 1),
  msg("a", 2, "r1"),
  msg("r2", 3),
  msg("b", 4, "r1"),
  msg("c", 5, "r2"),
];

describe("thread-util（ADR-0051）", () => {
  it("rootIdOf：回覆取 replyTo、根取自身", () => {
    expect(rootIdOf(msg("x", 1))).toBe("x");
    expect(rootIdOf(msg("y", 1, "r1"))).toBe("r1");
  });

  it("mainMessages 排除回覆", () => {
    expect(mainMessages(msgs).map((m) => m.id)).toEqual(["r1", "r2"]);
  });

  it("replyCounts 統計各根回覆數", () => {
    const c = replyCounts(msgs);
    expect(c.get("r1")).toBe(2);
    expect(c.get("r2")).toBe(1);
    expect(c.has("r3")).toBe(false);
  });

  it("threadMessages：根＋回覆依時間排序", () => {
    expect(threadMessages(msgs, "r1").map((m) => m.id)).toEqual(["r1", "a", "b"]);
    expect(threadMessages(msgs, "r2").map((m) => m.id)).toEqual(["r2", "c"]);
  });

  it("threadMessages：根缺席時只回覆（面板佔位由 UI 處理）", () => {
    expect(threadMessages([msg("a", 2, "gone")], "gone").map((m) => m.id)).toEqual(["a"]);
  });
});
