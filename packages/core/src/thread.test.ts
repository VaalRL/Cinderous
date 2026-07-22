import { describe, expect, it } from "vitest";
import { alsoMain, alsoMainTag, replyTag, threadRoot } from "./thread.js";
import type { Rumor } from "./nip59.js";

const rumor = (tags: string[][]): Rumor => ({
  id: "x",
  pubkey: "sender",
  created_at: 0,
  kind: 14,
  tags,
  content: "hi",
});

describe("thread（ADR-0051）", () => {
  it("replyTag 產生 NIP-10 reply-marked e-tag", () => {
    expect(replyTag("root1")).toEqual(["e", "root1", "", "reply"]);
  });

  it("threadRoot 讀出 reply e-tag 的根 id", () => {
    expect(threadRoot(rumor([["g", "grp"], replyTag("root1")]))).toBe("root1");
  });

  it("非回覆（無 reply 標記）回傳 undefined", () => {
    expect(threadRoot(rumor([["g", "grp"]]))).toBeUndefined();
    // 未標記 reply 的 e-tag（例如其他引用）不誤判為串根
    expect(threadRoot(rumor([["e", "someid"]]))).toBeUndefined();
  });
});

describe("also-main 同傳主對話旗標（ADR-0232）", () => {
  it("回覆＋also-main tag → true；tag 缺 → false", () => {
    expect(alsoMain(rumor([replyTag("root1"), alsoMainTag()]))).toBe(true);
    expect(alsoMain(rumor([replyTag("root1")]))).toBe(false);
  });

  it("非回覆帶 also-main → false（旗標僅對回覆有意義）", () => {
    expect(alsoMain(rumor([alsoMainTag()]))).toBe(false);
    expect(alsoMain(rumor([["g", "grp"], alsoMainTag()]))).toBe(false);
  });
});
