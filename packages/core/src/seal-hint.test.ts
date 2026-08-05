// seal 層 EK hint（ADR-0326）：群訊的 FS 發現機制。
//
// 承重的性質只有一條——**`rumor.id` 不得因為帶了 hint 而改變**。它是跨成員一致的群訊識別碼
// （回條與引用的鍵，ADR-0095），而 EK 每 7 天輪替；放進 rumor 會讓同一則訊息在不同時間
// 得到不同 id（ADR-0318 為此否決了 rumor 內嵌）。seal 是逐收件人的一層，改它不動 id。
import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap, sealAndWrap } from "./nip59.js";
import { KIND } from "./constants.js";
import { wrapGroupMessage } from "./group.js";
import { ekHintOf } from "./subkey.js";

const rumor = { kind: KIND.CHAT, created_at: 1_700_000_000, tags: [], content: "內容" };

describe("seal 層 tags（ADR-0326）", () => {
  it("預設空＝與 NIP-59 慣例一致", () => {
    const sk = generateSecretKey();
    const me = generateSecretKey();
    const w = sealAndWrap(rumor, sk, getPublicKey(me), { kind: KIND.OFFLINE_DM_GIFT_WRAP, tags: [] });
    expect(openWrap(w, me).sealTags).toEqual([]);
  });

  it("帶進去、解出來", () => {
    const sk = generateSecretKey();
    const me = generateSecretKey();
    const w = sealAndWrap(rumor, sk, getPublicKey(me), { kind: KIND.OFFLINE_DM_GIFT_WRAP, tags: [] }, [
      ["ek", "aa".repeat(32)],
    ]);
    expect(ekHintOf(openWrap(w, me).sealTags)).toBe("aa".repeat(32));
  });

  it("🔴 seal tags 不出現在外層——中繼看不到（那是放這裡而不是 wrap tags 的全部理由）", () => {
    const sk = generateSecretKey();
    const w = sealAndWrap(rumor, sk, getPublicKey(generateSecretKey()), { kind: KIND.OFFLINE_DM_GIFT_WRAP, tags: [] }, [
      ["ek", "aa".repeat(32)],
    ]);
    expect(JSON.stringify(w.tags)).not.toContain("aa".repeat(32));
    expect(w.content).not.toContain("aa".repeat(32));
  });
});

describe("群訊帶 EK hint（ADR-0326）", () => {
  const senderSk = generateSecretKey();
  const senderPk = getPublicKey(senderSk);
  const memberSk = generateSecretKey();
  const group = { id: "g1", name: "群", members: [senderPk, getPublicKey(memberSk)], admin: senderPk } as never;
  const ek = "bb".repeat(32);

  it("🔴 `rumor.id` 與不帶 hint 時**完全相同**——否則每次輪替都會產生新的群訊 id", () => {
    const opts = { now: 1_700_000_000 };
    expect(wrapGroupMessage("哈囉", senderSk, senderPk, group, { ...opts, myEk: ek }).id).toBe(
      wrapGroupMessage("哈囉", senderSk, senderPk, group, opts).id,
    );
  });

  it("hint 在 seal 層，不在 rumor 裡", () => {
    const w = wrapGroupMessage("哈囉", senderSk, senderPk, group, { now: 1, myEk: ek });
    const opened = openWrap(w.events[0]!, memberSk);
    expect(ekHintOf(opened.sealTags)).toBe(ek);
    expect(ekHintOf(opened.rumor.tags)).toBeUndefined();
  });

  it("不給 myEk 就不帶（未啟用 FS 的人一個位元組都不多送）", () => {
    const w = wrapGroupMessage("哈囉", senderSk, senderPk, group, { now: 1 });
    expect(openWrap(w.events[0]!, memberSk).sealTags).toEqual([]);
  });
});
