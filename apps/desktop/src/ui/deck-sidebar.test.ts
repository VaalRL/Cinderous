import { describe, expect, it } from "vitest";
import type { ChatMessage, Contact, Group } from "@cinder/engine";
import type { GroupPrefsMap } from "./group-labels.js";
import { buildEntries, lastInteraction, matchesQuery, sortEntries, visibleEntries } from "./deck-sidebar.js";

const c = (pubkey: string, name: string, status: Contact["status"] = "online"): Contact => ({
  pubkey,
  name,
  status,
  statusMessage: "",
  nowPlaying: "",
});
const msg = (text: string, at: number): ChatMessage => ({ id: `${at}`, outgoing: false, text, at });

describe("三欄左側欄邏輯（ADR-0079 Q2）", () => {
  it("lastInteraction：取最大時間戳；無訊息回 0", () => {
    expect(lastInteraction("x", {})).toBe(0);
    expect(lastInteraction("x", { x: [msg("a", 10), msg("b", 30), msg("c", 20)] })).toBe(30);
  });

  it("buildEntries：聯絡人＋群組合流，帶最近互動與標籤", () => {
    const contacts = [c("p1", "Amy")];
    const groups: Group[] = [{ id: "g1", name: "工作", admin: "p1", members: ["p1", "p2"] }];
    const convos = { p1: [msg("hi", 100)] };
    const prefs: GroupPrefsMap = { p1: { labels: ["家人"], pinned: false } };
    const entries = buildEntries(contacts, groups, convos, prefs);
    expect(entries).toHaveLength(2);
    const amy = entries.find((e) => e.id === "p1")!;
    expect(amy.kind).toBe("contact");
    expect(amy.lastAt).toBe(100);
    expect(amy.labels).toEqual(["家人"]); // 聯絡人也能有標籤（擴充 ADR-0040）
    const grp = entries.find((e) => e.id === "g1")!;
    expect(grp.kind).toBe("group");
    expect(grp.memberCount).toBe(2);
  });

  it("matchesQuery：命中名稱或訊息內容；空查詢全中", () => {
    const convos = { p1: [msg("聚餐約週五", 1)] };
    const amy = buildEntries([c("p1", "Amy")], [], convos, {})[0]!;
    expect(matchesQuery(amy, "", convos)).toBe(true);
    expect(matchesQuery(amy, "am", convos)).toBe(true); // 名稱
    expect(matchesQuery(amy, "聚餐", convos)).toBe(true); // 訊息內容
    expect(matchesQuery(amy, "旅行", convos)).toBe(false);
  });

  it("sortEntries：最近互動新→舊，無互動殿後", () => {
    const convos = { a: [msg("x", 50)], b: [msg("y", 200)] };
    const entries = buildEntries([c("a", "A"), c("b", "B"), c("z", "Z")], [], convos, {});
    expect(sortEntries(entries).map((e) => e.id)).toEqual(["b", "a", "z"]); // z 無互動殿後
  });

  it("visibleEntries：標籤篩選＋查詢＋排序一次到位", () => {
    const convos = { a: [msg("hello", 300)], b: [msg("world", 100)] };
    const prefs: GroupPrefsMap = { a: { labels: ["vip"], pinned: false } };
    const entries = buildEntries([c("a", "A"), c("b", "B")], [], convos, prefs);
    expect(visibleEntries(entries, "", "vip", convos).map((e) => e.id)).toEqual(["a"]); // 只有 a 有 vip
    expect(visibleEntries(entries, "world", undefined, convos).map((e) => e.id)).toEqual(["b"]); // 內容命中
  });
});
