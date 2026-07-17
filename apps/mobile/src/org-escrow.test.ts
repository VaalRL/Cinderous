import { generateSecretKey } from "@cinder/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EscrowEntry, loadEscrow, offboardedEntries, removeEscrow, saveEscrow, upsertEscrow } from "./org-escrow.js";

const sk = generateSecretKey();
const entry = (pubkey: string, name: string): EscrowEntry => ({ pubkey, name, nsec: `nsec1${pubkey}`, relayUrl: "wss://co", at: 1 });

describe("行動端離職金鑰託管・加密落盤（ADR-0179）", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("加密往返：save→load 還原；落盤是密文、**不含明文 nsec**（紅線）", () => {
    saveEscrow("admin", sk, [entry("m1", "Alice")]);
    const raw = localStorage.getItem("nb.orgEscrow.admin")!;
    expect(raw.startsWith("c1:")).toBe(true); // 密文前綴
    expect(raw).not.toContain("nsec1m1"); // 明文 nsec 不落盤
    expect(loadEscrow("admin", sk)).toEqual([entry("m1", "Alice")]);
  });

  it("錯金鑰（另一把 sk）→ 解不開回空（不靜默洩漏）", () => {
    saveEscrow("admin", sk, [entry("m1", "Alice")]);
    expect(loadEscrow("admin", generateSecretKey())).toEqual([]);
  });

  it("upsert（同 pubkey 更新）／remove／offboardedEntries 純函式", () => {
    let l = upsertEscrow(upsertEscrow([], entry("m1", "A")), entry("m2", "B"));
    l = upsertEscrow(l, { ...entry("m1", "A2") });
    expect(l).toHaveLength(2);
    expect(l.find((e) => e.pubkey === "m1")!.name).toBe("A2");
    // m1 仍在名冊在世成員 → 只有 m2 算離職
    expect(offboardedEntries(l, new Set(["m1"])).map((e) => e.pubkey)).toEqual(["m2"]);
    expect(removeEscrow(l, "m1").map((e) => e.pubkey)).toEqual(["m2"]);
  });

  it("無 localStorage（SSR）安全：load 回空、save 不丟例外", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadEscrow("a", sk)).toEqual([]);
    expect(() => saveEscrow("a", sk, [])).not.toThrow();
  });
});
