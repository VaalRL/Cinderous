// 共享行程的端到端行為（ADR-0259 實作階段二）：經**真實 RelayCore** 的記憶體網路收發，
// 驗證「建立一次、扇出全體、id 跨成員一致、主揪權威、RSVP 只往前推進」。
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";
import type { ChatBackendEvents } from "./types.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };
const NOW = Math.floor(Date.now() / 1000);
const soon = (days: number): number => NOW + days * 86_400;

/** 起 N 個接在同一座記憶體 relay 上的後端。 */
function peers(names: string[]): RelayChatBackend[] {
  const net = createInMemoryRelayNetwork();
  return names.map((n, i) => new RelayChatBackend(new MemoryStorage(), (h) => net.connect(`c${i}`, h), n, {}));
}

const trip = { title: "週六爬山", start: soon(3), end: soon(3) + 7200, location: "象山", description: "帶水" };

describe("共享行程端到端（ADR-0259）", () => {
  describe("1:1", () => {
    it("一個人建立 → 對方收到同一個行程（id 一致）", () => {
      const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
      const seen: number[] = [];
      a.start(noop);
      b.start({ ...noop, onCalendar: (events) => seen.push(events.length) });
      a.addContact(b.selfNpub);

      const id = a.calendarPublish({ contact: b.self.pubkey }, trip);

      expect(id).toBeTruthy();
      expect(a.calendarList()).toHaveLength(1); // 本機是真實來源：自己先看得到
      const got = b.calendarList();
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ id, title: "週六爬山", location: "象山", organizer: a.self.pubkey });
      expect(got[0]!.contact).toBe(a.self.pubkey); // 1:1 歸屬＝寄件人
      expect(seen.at(-1)).toBe(1); // onCalendar 有發
      a.stop();
      b.stop();
    });

    it("RSVP 回到主揪，且雙方看到同一份回覆表", () => {
      const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
      a.start(noop);
      b.start(noop);
      a.addContact(b.selfNpub);
      const id = a.calendarPublish({ contact: b.self.pubkey }, trip)!;

      b.calendarRsvp(id, "accepted");

      expect(b.calendarList()[0]!.rsvps?.[b.self.pubkey]?.status).toBe("accepted");
      expect(a.calendarList()[0]!.rsvps?.[b.self.pubkey]?.status).toBe("accepted");
      a.stop();
      b.stop();
    });
  });

  describe("群組：建立一次、扇出全體", () => {
    const setup = (): [RelayChatBackend, RelayChatBackend, RelayChatBackend, string] => {
      const [a, b, c] = peers(["Alice", "Bob", "Carol"]) as [RelayChatBackend, RelayChatBackend, RelayChatBackend];
      // `createGroup` 回傳 void——群組 id 從 onGroups 取（早期版本的測試誤以為它回傳 id，
      // 導致 `expect(undefined).toBe(undefined)` 假通過）。
      let gid = "";
      a.start({ ...noop, onGroups: (gs) => { gid = gs[0]?.id ?? gid; } });
      b.start(noop);
      c.start(noop);
      a.addContact(b.selfNpub);
      a.addContact(c.selfNpub);
      a.createGroup("登山團", [b.self.pubkey, c.self.pubkey]);
      expect(gid).toBeTruthy();
      return [a, b, c, gid];
    };

    it("兩位成員收到的是**同一個**行程（rumor.id 跨成員一致，ADR-0095）", () => {
      const [a, b, c, gid] = setup();
      const id = a.calendarPublish({ groupId: gid }, trip);

      expect(id).toBeTruthy(); // 沒有這行，下面兩個 undefined===undefined 會假通過
      expect(a.calendarList()[0]?.id).toBe(id);
      expect(b.calendarList()[0]?.id).toBe(id);
      expect(c.calendarList()[0]?.id).toBe(id); // 沒有人需要自己重建
      expect(b.calendarList()[0]?.groupId).toBe(gid);
      for (const p of [a, b, c]) p.stop();
    });

    it("小群 RSVP 廣播：其他成員也看得到誰要來", () => {
      const [a, b, c, gid] = setup();
      const id = a.calendarPublish({ groupId: gid }, trip)!;

      b.calendarRsvp(id, "tentative");

      expect(a.calendarList()[0]!.rsvps?.[b.self.pubkey]?.status).toBe("tentative");
      expect(c.calendarList()[0]!.rsvps?.[b.self.pubkey]?.status).toBe("tentative"); // 非主揪也收到
      for (const p of [a, b, c]) p.stop();
    });
  });

  describe("主揪權威（§1.7）", () => {
    it("主揪改時間 → 全體更新；主揪取消 → 全體移除", () => {
      const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
      a.start(noop);
      b.start(noop);
      a.addContact(b.selfNpub);
      const id = a.calendarPublish({ contact: b.self.pubkey }, trip)!;

      a.calendarPublish({ contact: b.self.pubkey }, { ...trip, start: soon(4) }, { action: "update", eventId: id });
      expect(b.calendarList()[0]!.start).toBe(soon(4));
      expect(b.calendarList()[0]!.id).toBe(id); // id 不因修改而變

      a.calendarPublish({ contact: b.self.pubkey }, trip, { action: "cancel", eventId: id });
      expect(b.calendarList()).toEqual([]);
      a.stop();
      b.stop();
    });

    it("⚠ 非主揪改不動：連送都不送（送出去也會被收端忽略）", () => {
      const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
      a.start(noop);
      b.start(noop);
      a.addContact(b.selfNpub);
      b.addContact(a.selfNpub);
      const id = a.calendarPublish({ contact: b.self.pubkey }, trip)!;

      // Bob 不是主揪 → calendarPublish 直接拒絕
      expect(b.calendarPublish({ contact: a.self.pubkey }, { ...trip, title: "被改掉" }, { action: "update", eventId: id })).toBeUndefined();
      expect(a.calendarList()[0]!.title).toBe("週六爬山");
      expect(b.calendarList()[0]!.title).toBe("週六爬山");
      a.stop();
      b.stop();
    });
  });

  it("行程不存在時的 RSVP 不炸、也不憑空生出行程", () => {
    const [a] = peers(["Alice"]) as [RelayChatBackend];
    a.start(noop);
    expect(() => a.calendarRsvp("nope", "accepted")).not.toThrow();
    expect(a.calendarList()).toEqual([]);
    a.stop();
  });

  it("改時間不會清掉大家已經回覆的 RSVP", () => {
    const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    const id = a.calendarPublish({ contact: b.self.pubkey }, trip)!;
    b.calendarRsvp(id, "accepted");

    a.calendarPublish({ contact: b.self.pubkey }, { ...trip, start: soon(5) }, { action: "update", eventId: id });

    expect(a.calendarList()[0]!.start).toBe(soon(5));
    expect(a.calendarList()[0]!.rsvps?.[b.self.pubkey]?.status).toBe("accepted"); // 回覆還在
    a.stop();
    b.stop();
  });
});
