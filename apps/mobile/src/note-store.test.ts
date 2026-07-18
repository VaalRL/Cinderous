import { deriveStorageKey, generateSecretKey } from "@cinderous/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadNote, saveNote } from "./note-store.js";

const key = deriveStorageKey(generateSecretKey());

describe("行動端便條・加密落盤（ADR-0183）", () => {
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

  it("加密往返：每對話一張、依 id 隔離；落盤是密文、**不含明文內容**（紅線）", () => {
    saveNote("p1", key, "買牛奶\n12*8");
    saveNote("p2", key, "另一個對話");
    const raw = localStorage.getItem("nb.note.p1")!;
    expect(raw.startsWith("c1:")).toBe(true); // 密文前綴
    expect(raw).not.toContain("買牛奶"); // 明文內容不落盤
    expect(loadNote("p1", key)).toBe("買牛奶\n12*8");
    expect(loadNote("p2", key)).toBe("另一個對話");
    expect(loadNote("p3", key)).toBe(""); // 未寫過＝空
  });

  it("錯金鑰（另一把 nsec 導出）→ 解不開回空", () => {
    saveNote("p1", key, "秘密");
    expect(loadNote("p1", deriveStorageKey(generateSecretKey()))).toBe("");
  });

  it("空字串＝清除（不留空鍵）", () => {
    saveNote("p1", key, "暫存");
    saveNote("p1", key, "");
    expect(loadNote("p1", key)).toBe("");
    expect(localStorage.getItem("nb.note.p1")).toBeNull();
  });

  it("無 localStorage（SSR）安全：load 回空、save 不丟例外", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadNote("p1", key)).toBe("");
    expect(() => saveNote("p1", key, "x")).not.toThrow();
  });
});
