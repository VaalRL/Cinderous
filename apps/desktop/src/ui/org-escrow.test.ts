import { generateSecretKey } from "@cinderous/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EscrowEntry, loadEscrow, offboardedEntries, removeEscrow, saveEscrow, upsertEscrow } from "./org-escrow.js";

const entry = (pubkey: string, name = "小美"): EscrowEntry => ({
  pubkey,
  name,
  nsec: "nsec1abc",
  relayUrl: "wss://corp.example",
  at: 1000,
});

const ownerSk = generateSecretKey();
const otherSk = generateSecretKey();

describe("入職金鑰託管（ADR-0163）", () => {
  it("upsert 以 pubkey 為鍵；remove 移除", () => {
    let list = upsertEscrow([], entry("a"));
    list = upsertEscrow(list, entry("a", "改名")); // 同 pubkey → 取代
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("改名");
    list = upsertEscrow(list, entry("b"));
    expect(list.length).toBe(2);
    expect(removeEscrow(list, "a").map((e) => e.pubkey)).toEqual(["b"]);
  });

  it("offboardedEntries：託管中但不在現行名冊在世成員＝已離職", () => {
    const list = [entry("a"), entry("b"), entry("c")];
    const live = new Set(["a", "c"]); // b 已被移出名冊
    expect(offboardedEntries(list, live).map((e) => e.pubkey)).toEqual(["b"]);
    expect(offboardedEntries(list, new Set(["a", "b", "c"]))).toEqual([]); // 全在職
  });

  describe("持久化（依管理者身分、加密落盤，ADR-0254）", () => {
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

    it("round-trip；毀損回空；過濾非法形狀", () => {
      saveEscrow("admin1", ownerSk, [entry("a")]);
      expect(loadEscrow("admin1", ownerSk).map((e) => e.pubkey)).toEqual(["a"]);
      expect(loadEscrow("other", ownerSk)).toEqual([]); // 依身分隔離
      localStorage.setItem("nb.orgEscrow.bad", "not json");
      expect(loadEscrow("bad", ownerSk)).toEqual([]);
    });

    it("落盤是密文：磁碟上不得出現託管的 nsec", () => {
      saveEscrow("admin1", ownerSk, [entry("a")]);
      const raw = localStorage.getItem("nb.orgEscrow.admin1")!;
      expect(raw.startsWith("c1:")).toBe(true);
      expect(raw).not.toContain("nsec1abc");
      expect(raw).not.toContain("wss://corp.example");
    });

    it("換一把鑰匙就解不開（密文離開企業主 nsec 即無效）", () => {
      saveEscrow("admin1", ownerSk, [entry("a")]);
      expect(loadEscrow("admin1", otherSk)).toEqual([]); // 不得回傳、更不得拋出
    });

    it("遷移：讀到 ADR-0254 之前的舊明文 → 內容照樣讀得到，且磁碟就地改寫為密文", () => {
      // 舊版行為：直接把 JSON 明文寫進 localStorage。
      localStorage.setItem("nb.orgEscrow.admin1", JSON.stringify([entry("a"), entry("b")]));
      expect(loadEscrow("admin1", ownerSk).map((e) => e.pubkey)).toEqual(["a", "b"]); // 不因遷移而遺失

      const raw = localStorage.getItem("nb.orgEscrow.admin1")!;
      expect(raw.startsWith("c1:")).toBe(true); // 已就地加密
      expect(raw).not.toContain("nsec1abc"); // 明文 nsec 已從磁碟消失
      expect(loadEscrow("admin1", ownerSk).map((e) => e.pubkey)).toEqual(["a", "b"]); // 遷移後仍可讀
    });

    it("遷移只發生一次：已是密文不重寫（同鑰匙下讀取穩定）", () => {
      saveEscrow("admin1", ownerSk, [entry("a")]);
      const before = localStorage.getItem("nb.orgEscrow.admin1");
      loadEscrow("admin1", ownerSk);
      expect(localStorage.getItem("nb.orgEscrow.admin1")).toBe(before); // 未被重新封裝
    });
  });
});
