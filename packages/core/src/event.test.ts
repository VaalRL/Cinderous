import { describe, expect, it } from "vitest";
import { getEventHash, serializeEvent, type UnsignedEvent } from "./event.js";

const sample: UnsignedEvent = {
  pubkey: "ab".repeat(32),
  created_at: 1700000000,
  kind: 1,
  tags: [["e", "abc"]],
  content: 'héllo "q"\n',
};

describe("Nostr 事件序列化（NIP-01）", () => {
  it("依 [0,pubkey,created_at,kind,tags,content] 順序、無多餘空白序列化", () => {
    expect(serializeEvent(sample)).toBe(
      JSON.stringify([0, sample.pubkey, 1700000000, 1, [["e", "abc"]], 'héllo "q"\n']),
    );
  });

  it("event id 為序列化字串的 sha256（64-hex）且具確定性", () => {
    const id1 = getEventHash(sample);
    const id2 = getEventHash(sample);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
    expect(id1).toBe(id2);
  });

  it("內容不同會產生不同 id", () => {
    expect(getEventHash(sample)).not.toBe(getEventHash({ ...sample, content: "x" }));
  });
});
