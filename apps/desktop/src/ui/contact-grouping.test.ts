import { describe, expect, it } from "vitest";
import type { Contact } from "@cinderous/engine";
import { groupContacts } from "./contact-grouping.js";

const mk = (name: string, status: Contact["status"]): Contact => ({ pubkey: name, name, status, statusMessage: "", nowPlaying: "" });
const contacts = [mk("Zoe", "busy"), mk("Amy", "online"), mk("Bob", "offline"), mk("Cara", "away")];
const labels: Record<string, string[]> = { Amy: ["家人", "同事"], Zoe: ["家人"], Cara: [] };

describe("groupContacts（ADR-0215）", () => {
  it("依狀態：線上→離開→忙碌→離線、區內名稱排序、跳過空區、標頭顯示總數", () => {
    const secs = groupContacts(contacts, "status", {});
    expect(secs.map((s) => s.status)).toEqual(["online", "away", "busy", "offline"]);
    expect(secs.every((s) => !s.showOnlineCount)).toBe(true);
    expect(secs[0]!.total).toBe(1); // online: Amy
  });

  it("依名稱：單一「全部」區、A→Z、顯示總數", () => {
    const secs = groupContacts(contacts, "name", {});
    expect(secs).toHaveLength(1);
    expect(secs[0]!.all).toBe(true);
    expect(secs[0]!.contacts.map((c) => c.name)).toEqual(["Amy", "Bob", "Cara", "Zoe"]);
    expect(secs[0]!.showOnlineCount).toBe(false);
  });

  it("依分組：每標籤一區（可多屬）＋未分組；標頭顯示線上/總數；區內線上優先", () => {
    const secs = groupContacts(contacts, "group", labels);
    // 標籤區依名稱排序：家人、同事；未分組殿後
    expect(secs.map((s) => s.labelName ?? (s.ungrouped ? "未分組" : ""))).toEqual(["同事", "家人", "未分組"]);
    // Amy 有兩標籤 → 家人與同事兩區都出現
    const jia = secs.find((s) => s.labelName === "家人")!;
    expect(jia.contacts.map((c) => c.name)).toEqual(["Amy", "Zoe"]); // 都線上/離開？Amy online、Zoe busy→online 優先
    expect(jia.showOnlineCount).toBe(true);
    expect({ online: jia.online, total: jia.total }).toEqual({ online: 2, total: 2 }); // busy 也算線上
    // 未分組＝無標籤者（Cara；Bob 無 labels 記錄也算無標籤）
    const un = secs.find((s) => s.ungrouped)!;
    expect(un.contacts.map((c) => c.name)).toEqual(["Cara", "Bob"]); // Cara away(線上優先) 先於 Bob offline
    expect({ online: un.online, total: un.total }).toEqual({ online: 1, total: 2 });
  });

  it("純函式：不改動輸入陣列", () => {
    const input = [mk("B", "busy"), mk("A", "online")];
    groupContacts(input, "name", {});
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("空聯絡人 → 各模式皆回空陣列", () => {
    expect(groupContacts([], "status", {})).toEqual([]);
    expect(groupContacts([], "group", {})).toEqual([]);
    expect(groupContacts([], "name", {})).toEqual([]);
  });
});
