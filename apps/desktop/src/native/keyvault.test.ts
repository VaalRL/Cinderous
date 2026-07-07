import { beforeEach, describe, expect, it } from "vitest";
import { browserKeyVault, getKeyVault } from "./keyvault.js";

describe("KeyVault 瀏覽器後備（B5，ADR-0053）", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("set/get/delete roundtrip、以 pubkey 隔離", async () => {
    expect(await browserKeyVault.getKey("pkA")).toBeNull();
    await browserKeyVault.setKey("pkA", "nsecA");
    await browserKeyVault.setKey("pkB", "nsecB");
    expect(await browserKeyVault.getKey("pkA")).toBe("nsecA");
    expect(await browserKeyVault.getKey("pkB")).toBe("nsecB"); // 不同 pubkey 不互相覆蓋
    // 覆寫
    await browserKeyVault.setKey("pkA", "nsecA2");
    expect(await browserKeyVault.getKey("pkA")).toBe("nsecA2");
    // 刪除僅影響該 pubkey
    await browserKeyVault.deleteKey("pkA");
    expect(await browserKeyVault.getKey("pkA")).toBeNull();
    expect(await browserKeyVault.getKey("pkB")).toBe("nsecB");
  });

  it("非 Tauri 環境（jsdom）getKeyVault 回瀏覽器後備", () => {
    // jsdom 無 window.__TAURI_INTERNALS__ → isTauri() 為 false
    expect(getKeyVault()).toBe(browserKeyVault);
  });
});
