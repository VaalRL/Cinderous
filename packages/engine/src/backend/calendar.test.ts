// 共享行程的端到端行為（ADR-0263 實作階段二）：經**真實 RelayCore** 的記憶體網路收發，
// 驗證「建立一次、扇出全體、id 跨成員一致、主揪權威、RSVP 只往前推進」。
import { generateSecretKey, getPublicKey, npubEncode, nsecEncode } from "@cinderous/core";
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

describe("共享行程端到端（ADR-0263）", () => {
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

describe("未送達邀請的補送（ADR-0264 §9）", () => {
  /** 讓 A 的 presence 觀察到 B 剛上線（離線→上線），觸發補送。 */
  const comeOnline = (a: RelayChatBackend, bPubkey: string): void => {
    (a as unknown as { observeContactPresence: (pk: string, sec: number, c?: number) => void })
      .observeContactPresence(bPubkey, Math.floor(Date.now() / 1000), undefined);
  };

  it("對方收到行程後回送達回條 → 主揪記下 delivered", () => {
    const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    const id = a.calendarPublish({ contact: b.self.pubkey }, trip)!;

    expect(a.calendarList().find((e) => e.id === id)?.delivered?.[b.self.pubkey]).toBeDefined();
    a.stop();
    b.stop();
  });

  it("已送達者不補送（上線也不會重來一次）", () => {
    const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    a.calendarPublish({ contact: b.self.pubkey }, trip);
    const before = b.calendarList()[0]!.updatedAt;

    comeOnline(a, b.self.pubkey);

    expect(b.calendarList()).toHaveLength(1); // 沒有變成兩筆
    expect(b.calendarList()[0]!.updatedAt).toBe(before); // 內容也沒被動到
    a.stop();
    b.stop();
  });

  it("⚠ 錯過邀請的人上線 → 補送到，內容與 id 都一致", () => {
    const netA = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netA.connect("a", h), "Alice", {});
    a.start(noop);
    // Bob 的身分先生成、但**完全不連線**——這才是「他離線超過 TTL、那份 wrap 已消失」。
    // （早期版本先建一個 tmp backend 取 pubkey，但那個 backend 一建構就連上網路、
    //  於是當場收到了邀請，讓「他本來沒有」的前提失效。）
    const bSk = generateSecretKey();
    const bPubkey = getPublicKey(bSk);
    a.addContact(npubEncode(bPubkey));
    const id = a.calendarPublish({ contact: bPubkey }, trip)!;

    // Bob 現在才上線。**不必手動戳 presence**——他一上線就發心跳，Alice 的
    // `observeContactPresence` 看到「離線→上線」即自動補送。這正是這個功能要證明的路徑。
    const bStorage = new MemoryStorage();
    const b = new RelayChatBackend(bStorage, (h) => netA.connect("b", h), "Bob", { nsecOverride: nsecEncode(bSk) });
    b.start(noop);

    const got = b.calendarList();
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe(id); // 補送的是同一個行程，不是新的
    expect(got[0]!.title).toBe("週六爬山");
    a.stop();
    b.stop();
  });

  it("過去的行程不補（補了也沒意義）", () => {
    const netA = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netA.connect("a", h), "Alice", {});
    a.start(noop);
    const bSk = generateSecretKey();
    const bPubkey = getPublicKey(bSk);
    a.addContact(npubEncode(bPubkey));
    a.calendarPublish({ contact: bPubkey }, { title: "上週的事", start: NOW - 86_400 * 7 });

    const b = new RelayChatBackend(new MemoryStorage(), (h) => netA.connect("b", h), "Bob", { nsecOverride: nsecEncode(bSk) });
    b.start(noop);
    comeOnline(a, bPubkey);

    expect(b.calendarList()).toEqual([]);
    a.stop();
    b.stop();
  });

  it("已 RSVP 者不補送——有回覆就是拿到了的更強證據", () => {
    const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    const id = a.calendarPublish({ contact: b.self.pubkey }, trip)!;
    b.calendarRsvp(id, "accepted");

    comeOnline(a, b.self.pubkey);

    expect(b.calendarList()).toHaveLength(1);
    expect(b.calendarList()[0]!.rsvps?.[b.self.pubkey]?.status).toBe("accepted"); // 沒被覆蓋
    a.stop();
    b.stop();
  });

  it("不是主揪就不補送別人的行程", () => {
    const [a, b] = peers(["Alice", "Bob"]) as [RelayChatBackend, RelayChatBackend];
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub);
    b.addContact(a.selfNpub);
    a.calendarPublish({ contact: b.self.pubkey }, trip);
    // B 手上有這筆但不是主揪 → A 上線時 B 不該補送任何東西
    expect(() => comeOnline(b, a.self.pubkey)).not.toThrow();
    expect(a.calendarList()).toHaveLength(1);
    a.stop();
    b.stop();
  });

  it("新成員入群 → 補送既有的未來行程（無伺服器端房間＝沒有歷史重播）", () => {
    const [a, b, c] = peers(["Alice", "Bob", "Carol"]) as [RelayChatBackend, RelayChatBackend, RelayChatBackend];
    let gid = "";
    a.start({ ...noop, onGroups: (gs) => { gid = gs[0]?.id ?? gid; } });
    b.start(noop);
    c.start(noop);
    a.addContact(b.selfNpub);
    a.addContact(c.selfNpub);
    a.createGroup("登山團", [b.self.pubkey]);
    const id = a.calendarPublish({ groupId: gid }, trip)!;
    expect(c.calendarList()).toEqual([]); // Carol 還不在群裡

    a.addGroupMember(gid, c.self.pubkey);

    expect(c.calendarList().map((e) => e.id)).toEqual([id]);
    for (const p of [a, b, c]) p.stop();
  });
});

describe("行程保留上限（ADR-0264 §10）", () => {
  it("開機清掉過久的過去行程，未來的留著", () => {
    const store = new MemoryStorage();
    const old = { id: "old", title: "去年的事", start: NOW - 400 * 86_400, organizer: "x", updatedAt: 1 };
    const soon = { id: "soon", title: "下週", start: NOW + 7 * 86_400, organizer: "x", updatedAt: 1 };
    store.upsertCalendarEvent(old);
    store.upsertCalendarEvent(soon);

    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice", {});
    a.start(noop);

    expect(a.calendarList().map((e) => e.id)).toEqual(["soon"]);
    a.stop();
  });

  it("寫入時就套用上限——過久的那筆不會因為新增一筆而復活", () => {
    const store = new MemoryStorage();
    store.upsertCalendarEvent({ id: "old", title: "舊", start: NOW - 400 * 86_400, organizer: "x", updatedAt: 1 });
    store.upsertCalendarEvent({ id: "new", title: "新", start: NOW + 86_400, organizer: "x", updatedAt: 1 });
    expect(store.loadCalendar().map((e) => e.id)).toEqual(["new"]);
  });

  it("保留窗內的過去行程留著（剛結束的活動不會馬上消失）", () => {
    const store = new MemoryStorage();
    store.upsertCalendarEvent({ id: "yesterday", title: "昨天", start: NOW - 86_400, organizer: "x", updatedAt: 1 });
    expect(store.loadCalendar()).toHaveLength(1);
  });
});

describe("行程提醒（ADR-0266）：本機計時器、零中繼成本", () => {
  /** 起一個接在記憶體 relay 上的後端，並回傳它與可觀察的提醒清單。 */
  function loneBackend(store: MemoryStorage): { a: RelayChatBackend; fired: string[] } {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "Alice", {});
    const fired: string[] = [];
    a.start({ ...noop, onCalendarReminder: (e) => fired.push(e.id) });
    return { a, fired };
  }

  it("開機時掃一次：App 關著錯過、但還在寬限窗內的提醒仍會響", () => {
    const store = new MemoryStorage();
    // 10 分鐘前就該提醒的行程（現在起算 1 分鐘後開始）。
    store.upsertCalendarEvent({ id: "e1", title: "會議", start: NOW + 60, organizer: "x", updatedAt: 1 });
    store.setCalendarReminder("e1", 10 * 60);

    const { a, fired } = loneBackend(store);
    expect(fired).toEqual(["e1"]);
    a.stop();
  });

  it("同一個 start 只響一次（開機掃完就記下，不會每個 tick 重來）", () => {
    const store = new MemoryStorage();
    store.upsertCalendarEvent({ id: "e1", title: "會議", start: NOW + 60, organizer: "x", updatedAt: 1 });
    store.setCalendarReminder("e1", 10 * 60);

    const { a, fired } = loneBackend(store);
    a.stop();
    // 重開＝再掃一次；已記下的不該再響。**沒有這條，重開 App 就會被同一個提醒轟一次。**
    const again = loneBackend(store);
    expect(again.fired).toEqual([]);
    expect(fired).toEqual(["e1"]);
    again.a.stop();
  });

  it("沒設提醒 → 不響（沒表態＝不吵）", () => {
    const store = new MemoryStorage();
    store.upsertCalendarEvent({ id: "e1", title: "會議", start: NOW + 60, organizer: "x", updatedAt: 1 });
    const { a, fired } = loneBackend(store);
    expect(fired).toEqual([]);
    a.stop();
  });

  it("還沒到提前量 → 不響", () => {
    const store = new MemoryStorage();
    store.upsertCalendarEvent({ id: "e1", title: "會議", start: NOW + 7200, organizer: "x", updatedAt: 1 });
    store.setCalendarReminder("e1", 10 * 60);
    const { a, fired } = loneBackend(store);
    expect(fired).toEqual([]);
    a.stop();
  });

  it("⚠ `calendarRemind` 不產生任何中繼流量（ADR-0263 §1.4 的紅線）", () => {
    const store = new MemoryStorage();
    store.upsertCalendarEvent({ id: "e1", title: "會議", start: NOW + 7200, organizer: "x", updatedAt: 1 });
    const net = createInMemoryRelayNetwork();
    // 攔在 client.publish：這就是真正上線的位元組——中繼看到什麼，這裡就是什麼。
    const seen: unknown[] = [];
    const wiretap = (h: Parameters<typeof net.connect>[1]): ReturnType<typeof net.connect> => {
      const c = net.connect("a", h);
      const publish = c.publish.bind(c);
      c.publish = (e) => {
        seen.push(e);
        publish(e);
      };
      return c;
    };
    const a = new RelayChatBackend(store, wiretap, "Alice", {});
    a.start(noop);
    const before = seen.length;

    a.calendarRemind("e1", 600);

    expect(seen.length).toBe(before); // 一顆事件都沒多
    expect(a.calendarList()[0]!.remindLead).toBe(600);
    a.stop();
  });

  it("⚠ 主揪改時間 → 提醒重新武裝，且**本機的提醒設定不被收到的 rumor 清掉**", () => {
    const net = createInMemoryRelayNetwork();
    const bStore = new MemoryStorage(); // 留著參照：稍後要用同一份儲存重開 Bob
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice", {});
    const b = new RelayChatBackend(bStore, (h) => net.connect("b", h), "Bob", {});
    a.start(noop);
    const fired: string[] = [];
    b.start({ ...noop, onCalendarReminder: (e) => fired.push(e.id) });
    a.addContact(b.selfNpub);

    // Alice 開一個很久以後的行程；Bob 設了提醒（此時當然還不該響）。
    const id = a.calendarPublish({ contact: b.self.pubkey }, { title: "同步會", start: NOW + 30 * 86_400 })!;
    b.calendarRemind(id, 10 * 60);
    expect(fired).toEqual([]);

    // Alice 把它改到「1 分鐘後」——Bob 收到的 rumor **不帶**提醒設定。
    a.calendarPublish({ contact: b.self.pubkey }, { title: "同步會", start: NOW + 60 }, { action: "update", eventId: id });

    expect(b.calendarList()[0]!.remindLead).toBe(600); // 設定還在
    a.stop();
    b.stop();
    // 重新起一個接同一份儲存的後端＝下一次 tick；改過時間後該響。
    const net2 = createInMemoryRelayNetwork();
    const b2 = new RelayChatBackend(bStore, (h) => net2.connect("b2", h), "Bob", {});
    const fired2: string[] = [];
    b2.start({ ...noop, onCalendarReminder: (e) => fired2.push(e.id) });
    expect(fired2).toEqual([id]);
    b2.stop();
  });
});
