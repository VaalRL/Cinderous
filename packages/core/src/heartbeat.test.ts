import { describe, expect, it } from "vitest";
import { KIND } from "./constants.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { createHeartbeat, heartbeatCadenceMs } from "./heartbeat.js";
import { verifyEvent } from "./sign.js";

describe("心跳事件建構（Kind 20000 / Ephemeral）", () => {
  const sk = generateSecretKey();

  it("產生 kind 20000、作者正確且驗章通過的事件", () => {
    const hb = createHeartbeat(sk, { created_at: 1700000000 });
    expect(hb.kind).toBe(KIND.HEARTBEAT);
    expect(hb.pubkey).toBe(getPublicKey(sk));
    expect(verifyEvent(hb)).toBe(true);
  });

  it("預設 content 為空字串，可帶入狀態字串", () => {
    expect(createHeartbeat(sk, { created_at: 1 }).content).toBe("");
    expect(createHeartbeat(sk, { created_at: 1, status: "🎵 Song" }).content).toBe("🎵 Song");
  });

  it("未指定 created_at 時填入接近現在的秒數", () => {
    const before = Math.floor(Date.now() / 1000);
    const hb = createHeartbeat(sk);
    expect(hb.created_at).toBeGreaterThanOrEqual(before);
    expect(hb.created_at).toBeLessThanOrEqual(before + 2);
  });
});

describe("心跳自報節奏（ADR-0109）", () => {
  const sk = generateSecretKey();

  it("帶上 hb tag（秒），可原樣讀回", () => {
    const evt = createHeartbeat(sk, { cadenceMs: 300_000 });
    expect(evt.tags).toContainEqual(["hb", "300"]);
    expect(heartbeatCadenceMs(evt)).toBe(300_000);
  });

  it("未指定節奏 → 不加 tag；讀回 undefined（相容舊版客戶端）", () => {
    const evt = createHeartbeat(sk);
    expect(evt.tags).toEqual([]);
    expect(heartbeatCadenceMs(evt)).toBeUndefined();
  });

  it("節奏損壞/非法 → 視為未自報（不可讓觀察端算出荒謬的容忍窗）", () => {
    const evt = createHeartbeat(sk);
    expect(heartbeatCadenceMs({ ...evt, tags: [["hb", "abc"]] })).toBeUndefined();
    expect(heartbeatCadenceMs({ ...evt, tags: [["hb", "-5"]] })).toBeUndefined();
    expect(heartbeatCadenceMs({ ...evt, tags: [["hb", "0"]] })).toBeUndefined();
  });
})
