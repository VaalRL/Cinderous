import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPresence, savePresence } from "./presence-store.js";

describe("本機記住上線狀態（ADR-0164）", () => {
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
    expect(loadPresence("pkB")).toBeNull(); // 另一身分各記各的
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
});
