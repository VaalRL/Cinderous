import { wrapSecret } from "@cinderous/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserKeyVault } from "./keyvault.js";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

describe("瀏覽器金鑰庫（ADR-0112）", () => {
  const nsec = "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

  it("**拒絕明文 nsec 落盤**——這是紅線，不是建議", async () => {
    await browserKeyVault.setKey("pk", nsec);
    expect(backing.has("nb.key.pk")).toBe(false);
    expect(await browserKeyVault.getKey("pk")).toBeNull();
  });

  it("密碼包裹過的 blob 才收；存進去的東西不含明文 nsec", async () => {
    await browserKeyVault.setKey("pk", wrapSecret("pw", nsec));
    const stored = backing.get("nb.key.pk")!;
    expect(stored).toBeDefined();
    expect(stored).not.toContain(nsec);
  });

  it("殘留的舊明文條目會被清掉（升級路徑）", async () => {
    backing.set("nb.key.pk", nsec); // ADR-0112 之前留下的明文私鑰
    await browserKeyVault.setKey("pk", nsec); // 再次嘗試明文寫入 → 拒絕 ＋ 清除
    expect(backing.has("nb.key.pk")).toBe(false);
  });
});
