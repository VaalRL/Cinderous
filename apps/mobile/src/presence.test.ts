import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPresence, savePresence } from "./presence.js";

// 與桌面 presence-store.test.ts 同一份契約（ADR-0164；行動端 ADR-0168 補齊）。
describe("行動端本機記住上線狀態（ADR-0168）", () => {
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

  it("round-trip：狀態＋自訂狀態文字；依身分隔離", () => {
    savePresence("pkA", { status: "busy", statusMessage: "趕稿中 🔥" });
    expect(loadPresence("pkA")).toEqual({ status: "busy", statusMessage: "趕稿中 🔥" });
    expect(loadPresence("pkB")).toBeNull();
  });

  it("離線狀態忠實還原（appear offline）", () => {
    savePresence("pk", { status: "offline", statusMessage: "" });
    expect(loadPresence("pk")?.status).toBe("offline");
  });

  it("防禦：未存回 null；壞 JSON 回 null；非法 status 回 null；缺 message 補空字串", () => {
    expect(loadPresence("none")).toBeNull();
    localStorage.setItem("nb.presence.bad", "not json");
    expect(loadPresence("bad")).toBeNull();
    localStorage.setItem("nb.presence.x", JSON.stringify({ status: "invisible", statusMessage: "x" }));
    expect(loadPresence("x")).toBeNull();
    localStorage.setItem("nb.presence.y", JSON.stringify({ status: "away" }));
    expect(loadPresence("y")).toEqual({ status: "away", statusMessage: "" });
  });

  it("無 localStorage（SSR）時安全：load 回 null、save 不丟例外", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadPresence("pk")).toBeNull();
    expect(() => savePresence("pk", { status: "online", statusMessage: "" })).not.toThrow();
  });
});
