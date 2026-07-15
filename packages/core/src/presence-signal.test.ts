import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { PRESENCE_SIGNAL_KIND, readPresenceState, wrapPresenceState } from "./presence-signal.js";

const aliceSk = generateSecretKey();
const alicePk = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bobPk = getPublicKey(bobSk);

describe("封裝的在線狀態（ADR-0129）", () => {
  it("🔴 **外層看不到寄件人與內容**——中繼看到的和一則 Gift Wrap 一樣", () => {
    const e = wrapPresenceState({ s: "away", m: "我在發呆", np: "某首歌", hb: 60_000 }, aliceSk, bobPk);
    expect(e.kind).toBe(PRESENCE_SIGNAL_KIND); // ephemeral，中繼不落盤
    expect(e.pubkey).not.toBe(alicePk); // 外層是一次性臨時金鑰
    expect(e.tags).toContainEqual(["p", bobPk]); // 只有收件人明文（與 1059 一致）
    const wire = JSON.stringify(e);
    expect(wire).not.toContain("我在發呆"); // 內容全密文
    expect(wire).not.toContain("某首歌");
    expect(wire).not.toContain(alicePk);
  });

  it("收件人解得開，且拿到**經驗證的**寄件人與狀態", () => {
    const e = wrapPresenceState({ s: "busy", m: "忙", np: "歌", hb: 300_000 }, aliceSk, bobPk);
    const { sender, state } = readPresenceState(e, bobSk);
    expect(sender).toBe(alicePk);
    expect(state).toEqual({ s: "busy", m: "忙", np: "歌", hb: 300_000 });
  });

  it("別人解不開", () => {
    const e = wrapPresenceState({ s: "online", m: "", np: "" }, aliceSk, bobPk);
    expect(() => readPresenceState(e, generateSecretKey())).toThrow();
  });

  it("缺欄位時給安全預設（不炸）", () => {
    const e = wrapPresenceState({ s: "online" } as never, aliceSk, bobPk);
    const { state } = readPresenceState(e, bobSk);
    expect(state.m).toBe("");
    expect(state.np).toBe("");
  });
});
