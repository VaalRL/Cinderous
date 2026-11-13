import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLegacyInvisible, loadPresence, savePresence } from "./presence-store.js";

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

  it("🔴 舊版設定頁開了隱身（nb.invisible=1）→ 升級後以「隱身」狀態上線（ADR-0422）", () => {
    localStorage.setItem("nb.invisible", "1");
    expect(loadPresence("fresh")).toEqual({ status: "offline", statusMessage: "" });
    savePresence("pk", { status: "busy", statusMessage: "趕稿" });
    expect(loadPresence("pk")).toEqual({ status: "offline", statusMessage: "趕稿" }); // 沒手動改前仍隱身
  });

  it("手動改一次狀態就清掉舊旗標（之後照選的走）", () => {
    localStorage.setItem("nb.invisible", "1");
    savePresence("pk", { status: "online", statusMessage: "" });
    clearLegacyInvisible();
    expect(loadPresence("pk")?.status).toBe("online");
    expect(localStorage.getItem("nb.invisible")).toBeNull();
  });
});
