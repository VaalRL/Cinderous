// 裝置外觀偏好的持久化（ADR-0333）。
import { beforeEach, describe, expect, it } from "vitest";
import { setKvBackend, type KvStore } from "@cinderous/engine";
import { readAccent, readLocale, readTheme, saveAccent, saveLocale, saveTheme } from "./device-prefs.js";

const memKv = (seed: Record<string, string> = {}): KvStore & { map: Map<string, string> } => {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

describe("裝置外觀偏好（ADR-0333）", () => {
  beforeEach(() => setKvBackend(null));

  it("🔴 存了就讀得回來——這正是行動端原本缺的（重開就回預設）", () => {
    setKvBackend(memKv());
    saveTheme("dark");
    saveLocale("en");
    saveAccent("#ff8800");
    expect(readTheme("light")).toBe("dark");
    expect(readLocale("zh-Hant")).toBe("en");
    expect(readAccent(null)).toBe("#ff8800");
  });

  it("🔴 沒存過 → 回退呼叫端的預設（ADR-0248：初次登入一律明亮，仍成立）", () => {
    setKvBackend(memKv());
    expect(readTheme("light")).toBe("light");
    expect(readLocale("zh-Hant")).toBe("zh-Hant");
    expect(readAccent(null)).toBeNull();
  });

  it("🔴 值壞掉不得讓 App 起不來——一律回退，不拋", () => {
    setKvBackend(memKv({ "nb.theme": "螢光粉", "nb.locale": "kl-KL", "nb.accent": "rm -rf" }));
    expect(readTheme("light")).toBe("light");
    expect(readLocale("zh-Hant")).toBe("zh-Hant");
    expect(readAccent("#123456")).toBeNull(); // 不合法的顏色不套用，也不沿用上一個
  });

  it("KV 整個不可用時也只是記不住，不拋", () => {
    setKvBackend({
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {
        throw new Error("nope");
      },
      removeItem: () => {
        throw new Error("nope");
      },
    });
    expect(() => saveTheme("dark")).not.toThrow();
    expect(readTheme("light")).toBe("light");
  });

  it("主色設回預設（null）→ 清掉鍵，之後讀到的是呼叫端的預設", () => {
    const kv = memKv();
    setKvBackend(kv);
    saveAccent("#ff8800");
    saveAccent(null);
    expect(kv.map.has("nb.accent")).toBe(false);
    expect(readAccent(null)).toBeNull();
  });

  it("與桌面用同一組鍵名（同一台裝置的心智模型一致）", () => {
    const kv = memKv();
    setKvBackend(kv);
    saveTheme("dark");
    saveLocale("en");
    expect([...kv.map.keys()].sort()).toEqual(["nb.locale", "nb.theme"]);
  });
});
