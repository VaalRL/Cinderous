import { describe, expect, it } from "vitest";
import {
  applyCalendarChange,
  CALENDAR_RSVP_BROADCAST_MAX,
  calendarEventOf,
  calendarRsvpOf,
  rsvpAudience,
  wrapCalendarEvent,
  wrapCalendarRsvp,
  wrapGroupCalendarEvent,
  type CalendarEvent,
  type CalendarEventInput,
} from "./calendar.js";
import { KIND } from "./constants.js";
import type { Group } from "./group.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { openWrap } from "./nip59.js";

const NOW = 1_700_000_000;
const aliceSk = generateSecretKey();
const alice = getPublicKey(aliceSk);
const bobSk = generateSecretKey();
const bob = getPublicKey(bobSk);
const carolSk = generateSecretKey();
const carol = getPublicKey(carolSk);

const input: CalendarEventInput = {
  title: "週六爬山",
  start: NOW + 86_400,
  end: NOW + 86_400 * 2,
  location: "象山登山口",
  description: "帶水",
};

const group = (members: string[]): Group => ({ id: "g1", name: "登山團", admin: alice, members });

/** 以收件人私鑰拆開 wrap 取回 rumor。 */
const open = (evt: Parameters<typeof openWrap>[0], sk: Uint8Array) => openWrap(evt, sk).rumor;

describe("共享行程（ADR-0259）", () => {
  describe("1:1 邀請", () => {
    it("外層與一般訊息無異：kind 1059＋單一 p tag，行程欄位全在密文內層", () => {
      const { events } = wrapCalendarEvent(input, aliceSk, bob, { now: NOW });
      expect(events).toHaveLength(1);
      const wrap = events[0]!;
      expect(wrap.kind).toBe(KIND.OFFLINE_DM_GIFT_WRAP);
      expect(wrap.tags.filter((t) => t[0] === "p").map((t) => t[1])).toEqual([bob]);
      // 中繼看得到的整顆事件裡不得出現任何行程欄位
      const onTheWire = JSON.stringify(wrap);
      for (const secret of ["週六爬山", "象山登山口", "帶水", String(input.start)]) {
        expect(onTheWire).not.toContain(secret);
      }
    });

    it("收件人解得開，欄位完整", () => {
      const { events, id } = wrapCalendarEvent(input, aliceSk, bob, { now: NOW });
      const parsed = calendarEventOf(open(events[0]!, bobSk));
      expect(parsed).toMatchObject({
        id,
        action: "create",
        title: "週六爬山",
        start: input.start,
        end: input.end,
        location: "象山登山口",
        description: "帶水",
        organizer: alice,
      });
      expect(parsed?.groupId).toBeUndefined();
    });

    it("自封副本讓自己的其他裝置也看得到（ADR-0107）", () => {
      const { selfCopy } = wrapCalendarEvent(input, aliceSk, bob, { now: NOW });
      expect(calendarEventOf(open(selfCopy, aliceSk))?.title).toBe("週六爬山");
    });
  });

  describe("群組邀請", () => {
    it("建立一次、扇出全體——不是每人各建一份", () => {
      const { events, selfCopy } = wrapGroupCalendarEvent(input, aliceSk, group([alice, bob, carol]), { now: NOW });
      expect(events).toHaveLength(2); // 不含自己
      expect(selfCopy).toBeDefined();
    });

    it("行程 id 跨成員一致（ADR-0095 的 rumor.id 性質——RSVP 才對得回去）", () => {
      const { events, id } = wrapGroupCalendarEvent(input, aliceSk, group([alice, bob, carol]), { now: NOW });
      const byBob = calendarEventOf(open(events[0]!, bobSk))!;
      const byCarol = calendarEventOf(open(events[1]!, carolSk))!;
      expect(byBob.id).toBe(id);
      expect(byCarol.id).toBe(id); // 兩位成員看到的是**同一個**行程
      expect(byBob.groupId).toBe("g1");
    });
  });

  describe("RSVP 送給誰（ADR-0259 §1.4 的 O(N²) 閘）", () => {
    it("小群：送給全體（不含自己）", () => {
      const members = [alice, bob, carol];
      expect(rsvpAudience(members, alice, bob).sort()).toEqual([alice, carol].sort());
    });

    it("超過上限：只送主揪，每輪從 O(N²) 降回 O(N)", () => {
      const many = Array.from({ length: CALENDAR_RSVP_BROADCAST_MAX + 1 }, () => getPublicKey(generateSecretKey()));
      const members = [alice, bob, ...many];
      expect(rsvpAudience(members, alice, bob)).toEqual([alice]);
    });

    it("邊界：剛好等於上限仍廣播", () => {
      const members = Array.from({ length: CALENDAR_RSVP_BROADCAST_MAX }, () => getPublicKey(generateSecretKey()));
      expect(rsvpAudience([...members], members[0]!, members[1]!)).toHaveLength(members.length - 1);
    });

    it("主揪自己回覆：大群下對象為空（只留自封副本）", () => {
      const many = Array.from({ length: CALENDAR_RSVP_BROADCAST_MAX + 1 }, () => getPublicKey(generateSecretKey()));
      expect(rsvpAudience([alice, ...many], alice, alice)).toEqual([]);
    });
  });

  describe("RSVP", () => {
    it("指向行程 id、由本人簽章、狀態可解析", () => {
      const { id } = wrapGroupCalendarEvent(input, aliceSk, group([alice, bob]), { now: NOW });
      const { events } = wrapCalendarRsvp(id, "accepted", bobSk, [alice], { now: NOW, groupId: "g1" });
      const parsed = calendarRsvpOf(open(events[0]!, aliceSk));
      expect(parsed).toEqual({ eventId: id, status: "accepted", groupId: "g1", by: bob, updatedAt: NOW });
    });

    it("外層不洩漏這是 RSVP 或其狀態", () => {
      const { events } = wrapCalendarRsvp("evt1", "declined", bobSk, [alice], { now: NOW });
      const onTheWire = JSON.stringify(events[0]!);
      expect(onTheWire).not.toContain("declined");
      expect(onTheWire).not.toContain("evt1");
    });

    it("非法狀態不解析", () => {
      const rumor = { kind: KIND.CALENDAR_RSVP, created_at: NOW, tags: [["e", "x"], ["status", "maybe"]], content: "", pubkey: bob, id: "r" };
      expect(calendarRsvpOf(rumor)).toBeUndefined();
    });
  });

  describe("解析守門", () => {
    it("kind 不符、缺 title/start、update 缺目標 → undefined", () => {
      const base = { created_at: NOW, content: "", pubkey: alice, id: "r" };
      expect(calendarEventOf({ ...base, kind: KIND.CHAT, tags: [] })).toBeUndefined();
      expect(calendarEventOf({ ...base, kind: KIND.CALENDAR_EVENT, tags: [["action", "create"]] })).toBeUndefined();
      expect(
        calendarEventOf({
          ...base,
          kind: KIND.CALENDAR_EVENT,
          tags: [["action", "update"], ["title", "x"], ["start", "1"]], // 缺 e tag
        }),
      ).toBeUndefined();
      expect(
        calendarEventOf({ ...base, kind: KIND.CALENDAR_EVENT, tags: [["action", "bogus"], ["title", "x"], ["start", "1"]] }),
      ).toBeUndefined();
    });
  });

  describe("主揪權威（§1.7）", () => {
    const created = (): CalendarEvent =>
      calendarEventOf(open(wrapCalendarEvent(input, aliceSk, bob, { now: NOW }).events[0]!, bobSk))!;

    it("主揪改時間 → 套用", () => {
      const evt = created();
      const { events } = wrapCalendarEvent({ ...input, start: NOW + 99 }, aliceSk, bob, {
        now: NOW + 10,
        action: "update",
        eventId: evt.id,
      });
      const next = applyCalendarChange(evt, calendarEventOf(open(events[0]!, bobSk))!);
      expect(next).not.toBeNull();
      expect((next as CalendarEvent).start).toBe(NOW + 99);
      expect((next as CalendarEvent).id).toBe(evt.id); // id 不因修改而變
    });

    it("主揪取消 → null（呼叫端移除）", () => {
      const evt = created();
      const { events } = wrapCalendarEvent(input, aliceSk, bob, { now: NOW + 10, action: "cancel", eventId: evt.id });
      expect(applyCalendarChange(evt, calendarEventOf(open(events[0]!, bobSk))!)).toBeNull();
    });

    it("⚠ 非主揪的修改一律忽略——權威是執行點，不是提示", () => {
      const evt = created();
      // Carol 偽造一則指向同一行程的「更新」，且時間更新（LWW 下本來會贏）
      const { events } = wrapCalendarEvent({ ...input, title: "改成別的" }, carolSk, bob, {
        now: NOW + 9999,
        action: "update",
        eventId: evt.id,
      });
      const next = applyCalendarChange(evt, calendarEventOf(open(events[0]!, bobSk))!);
      expect(next).toBe(evt); // 原封不動
      expect((next as CalendarEvent).title).toBe("週六爬山");
    });

    it("⚠ 非主揪也取消不掉", () => {
      const evt = created();
      const { events } = wrapCalendarEvent(input, carolSk, bob, { now: NOW + 9999, action: "cancel", eventId: evt.id });
      expect(applyCalendarChange(evt, calendarEventOf(open(events[0]!, bobSk))!)).toBe(evt);
    });

    it("較舊的修改忽略（亂序抵達）", () => {
      const evt = { ...created(), updatedAt: NOW + 100, title: "新的" };
      const stale = { ...evt, action: "update" as const, title: "舊的", updatedAt: NOW + 50 };
      expect((applyCalendarChange(evt, stale) as CalendarEvent).title).toBe("新的");
    });

    it("沒有原行程時，update/cancel 不憑空生出一個", () => {
      const evt = created();
      expect(applyCalendarChange(undefined, { ...evt, action: "update" })).toBeUndefined();
      expect(applyCalendarChange(undefined, { ...evt, action: "cancel" })).toBeUndefined();
    });

    it("重複收到 create（多裝置/重送）不覆蓋較新狀態", () => {
      const evt = created();
      const newer = { ...evt, updatedAt: evt.updatedAt + 5 };
      expect(applyCalendarChange(newer, evt)).toBe(newer);
    });
  });
});
