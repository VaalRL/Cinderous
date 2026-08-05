import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey, nsecEncode } from "./keys.js";
import { buildEkEnvelope, EK_ENVELOPE_KIND, EK_ENVELOPE_SLOTS, openEkEnvelope } from "./ek-envelope.js";

const idSk = generateSecretKey();
const idPk = getPublicKey(idSk);
const mkKey = (at: number) => {
  const sk = generateSecretKey();
  return { nsec: nsecEncode(sk), pk: getPublicKey(sk), at };
};
const keys = [mkKey(1), mkKey(2)];

describe("EK per-device 分發（ADR-0322 S2）", () => {
  it("目錄內的裝置解得開；不在目錄內的解不開——**撤銷在此成立**", () => {
    const inDir = generateSecretKey();
    const removed = generateSecretKey();
    const ev = buildEkEnvelope(idSk, [getPublicKey(inDir)], keys, { now: 1 });
    expect(ev.kind).toBe(EK_ENVELOPE_KIND);
    expect(openEkEnvelope(ev, inDir, idPk)).toEqual(keys);
    expect(openEkEnvelope(ev, removed, idPk)).toBeNull(); // 🔴 被移除的裝置拿不到新 EK
  });

  it("多台裝置各自解得開同一份", () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    const ev = buildEkEnvelope(idSk, [getPublicKey(a), getPublicKey(b)], keys, { now: 1 });
    expect(openEkEnvelope(ev, a, idPk)).toEqual(keys);
    expect(openEkEnvelope(ev, b, idPk)).toEqual(keys);
  });

  it("🔴 密文數不洩漏裝置數：1 台與 5 台的槽數相同", () => {
    const one = buildEkEnvelope(idSk, [getPublicKey(generateSecretKey())], keys, { now: 1 });
    const five = buildEkEnvelope(
      idSk,
      Array.from({ length: 5 }, () => getPublicKey(generateSecretKey())),
      keys,
      { now: 1 },
    );
    expect(JSON.parse(one.content)).toHaveLength(EK_ENVELOPE_SLOTS);
    expect(JSON.parse(five.content)).toHaveLength(EK_ENVELOPE_SLOTS);
  });

  it("超過一組槽位時補到下一個倍數（仍不精確洩漏）", () => {
    const many = buildEkEnvelope(
      idSk,
      Array.from({ length: EK_ENVELOPE_SLOTS }, () => getPublicKey(generateSecretKey())),
      keys,
      { now: 1 },
    );
    expect(JSON.parse(many.content)).toHaveLength(EK_ENVELOPE_SLOTS * 2);
  });

  it("空目錄＝沒有人拿得到（不是「不分發」）", () => {
    const ev = buildEkEnvelope(idSk, [], keys, { now: 1 });
    expect(JSON.parse(ev.content)).toHaveLength(EK_ENVELOPE_SLOTS);
    expect(openEkEnvelope(ev, generateSecretKey(), idPk)).toBeNull();
  });

  it("不信任網路來源：壞簽章／錯 kind／別人簽的一律 null", () => {
    const d = generateSecretKey();
    const ev = buildEkEnvelope(idSk, [getPublicKey(d)], keys, { now: 1 });
    expect(openEkEnvelope({ ...ev, sig: "00".repeat(32) }, d, idPk)).toBeNull();
    expect(openEkEnvelope({ ...ev, kind: 1 }, d, idPk)).toBeNull();
    const other = buildEkEnvelope(generateSecretKey(), [getPublicKey(d)], keys, { now: 1 });
    expect(openEkEnvelope(other, d, idPk)).toBeNull(); // 非該身分所發
  });

  it("畸形內容整份丟棄", () => {
    const d = generateSecretKey();
    const bad = buildEkEnvelope(idSk, [getPublicKey(d)], [{ nsec: "x", pk: "zz", at: 1 }] as never, { now: 1 });
    expect(openEkEnvelope(bad, d, idPk)).toBeNull();
  });
});
