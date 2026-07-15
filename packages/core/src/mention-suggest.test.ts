import { describe, expect, it } from "vitest";
import { applyMention, suggestMentions } from "./mention-suggest.js";

const cands = [
  { pubkey: "pk_alice", name: "Alice" },
  { pubkey: "pk_alan", name: "Alan" },
  { pubkey: "pk_bob", name: "Bob" },
];

describe("suggestMentions（ADR-0050／0133）", () => {
  it("剛輸入 @ 顯示全部候選", () => {
    const s = suggestMentions("嗨 @", cands);
    expect(s?.candidates.map((c) => c.name)).toEqual(["Alice", "Alan", "Bob"]);
    expect(s?.query).toBe("");
  });

  it("前綴過濾、大小寫不敏感", () => {
    expect(suggestMentions("@al", cands)?.candidates.map((c) => c.name)).toEqual(["Alice", "Alan"]);
    expect(suggestMentions("hi @BO", cands)?.candidates.map((c) => c.name)).toEqual(["Bob"]);
  });

  it("非結尾或無空白前導的 @ 不觸發", () => {
    expect(suggestMentions("@Alice 已完成", cands)).toBeNull(); // token 後有空白
    expect(suggestMentions("a@al", cands)).toBeNull(); // @ 前非詞界
  });

  it("無命中回傳 null", () => {
    expect(suggestMentions("@zzz", cands)).toBeNull();
  });

  it("applyMention 以 @名稱＋空白替換進行中 token", () => {
    const s = suggestMentions("嗨 @al", cands)!;
    expect(applyMention("嗨 @al", s, cands[0]!)).toBe("嗨 @Alice ");
  });
});
