import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { contentHash } from "./event.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap } from "./nip59.js";
import {
  ASSET_CHUNK_CHARS,
  ASSET_CHUNK_MAX_TOTAL,
  parseAssetChunk,
  parseAssetRequest,
  reassembleAssetChunks,
  splitAssetChunks,
  wrapAssetChunk,
  wrapAssetRequest,
} from "./asset-relay.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);
const HASH = contentHash("data:image/gif;base64,ABC");

describe("emoji blob backfill 協定（ADR-0223）", () => {
  it("splitAssetChunks：等分＋殘塊；空字串一塊", () => {
    const parts = splitAssetChunks("x".repeat(ASSET_CHUNK_CHARS + 10));
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBe(ASSET_CHUNK_CHARS);
    expect(parts[1]!.length).toBe(10);
    expect(splitAssetChunks("").length).toBe(1);
  });

  it("ASSET_REQUEST wrap/parse round-trip（Gift Wrap、第三者不可解）", () => {
    const wrap = wrapAssetRequest(HASH, aliceSk, bobPk, { now: 1_700_000_000 });
    expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
    const opened = openWrap(wrap, bobSk);
    expect(opened.sender).toBe(alicePk);
    expect(parseAssetRequest(opened.rumor)).toEqual({ hash: HASH });
    expect(() => openWrap(wrap, generateSecretKey())).toThrow();
  });

  it("ASSET_CHUNK wrap/parse round-trip（外層 FILE_WRAP＋#p＋過期章）", () => {
    const wrap = wrapAssetChunk({ hash: HASH, seq: 0, total: 2, data: "abc" }, aliceSk, bobPk, {
      now: 1_700_000_000,
      expiration: 1_700_086_400,
    });
    expect(wrap.kind).toBe(KIND.FILE_WRAP);
    expect(wrap.tags).toContainEqual(["p", bobPk]);
    expect(wrap.tags).toContainEqual(["expiration", "1700086400"]);
    expect(parseAssetChunk(openWrap(wrap, bobSk).rumor)).toEqual({ hash: HASH, seq: 0, total: 2, data: "abc" });
  });

  it("parseAssetChunk 防禦：kind 不符、壞 hash、seq/total 非法、超大塊 → null", () => {
    const mk = (content: string, kind: number = KIND.ASSET_CHUNK) => ({ kind, tags: [], content, created_at: 0, id: "x", pubkey: "p" });
    const ok = { hash: HASH, seq: 0, total: 1, data: "" };
    expect(parseAssetChunk(mk(JSON.stringify(ok), KIND.CHAT))).toBeNull();
    expect(parseAssetChunk(mk("not json"))).toBeNull();
    expect(parseAssetChunk(mk(JSON.stringify({ ...ok, hash: "zzz" })))).toBeNull();
    expect(parseAssetChunk(mk(JSON.stringify({ ...ok, seq: 1 })))).toBeNull();
    expect(parseAssetChunk(mk(JSON.stringify({ ...ok, total: ASSET_CHUNK_MAX_TOTAL + 1 })))).toBeNull();
    expect(parseAssetChunk(mk(JSON.stringify({ ...ok, data: "x".repeat(ASSET_CHUNK_CHARS + 1) })))).toBeNull();
    expect(parseAssetChunk(mk(JSON.stringify(ok)))).not.toBeNull();
  });

  it("parseAssetRequest 防禦：kind/hash", () => {
    const mk = (content: string, kind: number = KIND.ASSET_REQUEST) => ({ kind, tags: [], content, created_at: 0, id: "x", pubkey: "p" });
    expect(parseAssetRequest(mk(JSON.stringify({ hash: HASH }), KIND.CHAT))).toBeNull();
    expect(parseAssetRequest(mk(JSON.stringify({ hash: "bad" })))).toBeNull();
    expect(parseAssetRequest(mk(JSON.stringify({ hash: HASH })))).toEqual({ hash: HASH });
  });

  it("reassembleAssetChunks：齊全＋整合性→字串；不齊/掉包→null", () => {
    const data = "data:image/gif;base64," + "A".repeat(ASSET_CHUNK_CHARS + 200); // 跨 2 塊
    const hash = contentHash(data);
    const parts = splitAssetChunks(data);
    expect(parts.length).toBeGreaterThan(1);
    const chunks = parts.map((d, i) => ({ hash, seq: i, total: parts.length, data: d }));
    expect(reassembleAssetChunks(chunks)).toBe(data);
    expect(reassembleAssetChunks(chunks.slice(0, -1))).toBeNull(); // 不齊
    expect(reassembleAssetChunks([{ hash, seq: 0, total: 1, data: "tampered" }])).toBeNull(); // 掉包
  });
});
