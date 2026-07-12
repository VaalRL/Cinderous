import type { ChatMessage, Contact, Group } from "@cinder/engine";
import { describe, expect, it } from "vitest";
import { buildChatList, chatList, chatTimeLabel, lastMessageOf, previewText, sortByRecent } from "./chat-list.js";

const contact = (pubkey: string, name: string): Contact => ({
  pubkey,
  name,
  status: "online",
  statusMessage: "",
  nowPlaying: "",
});
const group = (id: string, name: string, members: string[]): Group => ({ id, name, admin: members[0]!, members });
const msg = (id: string, at: number, text: string, outgoing = false): ChatMessage => ({ id, at, text, outgoing });

describe("行動端聊天清單邏輯（ADR-0085）", () => {
  it("lastMessageOf／previewText：取最新一則、檔案顯示 📎", () => {
    const msgs = [msg("a", 100, "早"), msg("b", 300, "晚"), msg("c", 200, "中")];
    expect(lastMessageOf(msgs)?.id).toBe("b");
    expect(lastMessageOf([])).toBeUndefined();
    expect(previewText(msg("x", 1, "hi"))).toBe("hi");
    const file: ChatMessage = { id: "f", at: 1, text: "", outgoing: false, file: { id: "f", name: "cat.png", mime: "image/png", size: 1, sent: 1, incoming: true } };
    expect(previewText(file)).toBe("📎 cat.png");
    expect(previewText(undefined)).toBe("");
  });

  it("buildChatList：聯絡人＋群組合成、帶最後預覽/時間/未讀/自己送出", () => {
    const convos = { p1: [msg("m1", 500, "在嗎"), msg("m2", 900, "好喔", true)], g1: [msg("m3", 700, "大家好")] };
    const list = buildChatList([contact("p1", "Amy")], [group("g1", "工作", ["me", "p1"])], convos, { p1: 2 });
    const amy = list.find((e) => e.id === "p1")!;
    expect(amy).toMatchObject({ name: "Amy", isGroup: false, lastText: "好喔", lastAt: 900, lastOutgoing: true, unread: 2, status: "online" });
    const g = list.find((e) => e.id === "g1")!;
    expect(g).toMatchObject({ name: "工作", isGroup: true, memberCount: 2, lastText: "大家好", lastAt: 700, unread: 0 });
  });

  it("sortByRecent／chatList：最近互動優先、無互動殿後、同分依名稱", () => {
    const convos = { b: [msg("x", 900, "hi")], a: [msg("y", 500, "yo")] };
    const contacts = [contact("a", "Alpha"), contact("b", "Bravo"), contact("z", "Zulu"), contact("m", "Mike")];
    const sorted = chatList(contacts, [], convos, {});
    expect(sorted.map((e) => e.id)).toEqual(["b", "a", "m", "z"]); // b(900)>a(500)>無互動(m,z 依名稱)
  });

  it("chatTimeLabel：今日 HH:MM、昨天、更早 M/D、無互動空字串", () => {
    const now = new Date(2026, 6, 12, 15, 0).getTime();
    expect(chatTimeLabel(new Date(2026, 6, 12, 9, 5).getTime(), now)).toBe("9:05");
    expect(chatTimeLabel(new Date(2026, 6, 11, 10, 0).getTime(), now)).toBe("昨天");
    expect(chatTimeLabel(new Date(2026, 6, 1, 8, 0).getTime(), now)).toBe("7/1");
    expect(chatTimeLabel(0, now)).toBe("");
  });
});
