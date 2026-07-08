import { KIND, wrapMessage, type NostrEvent, type RelayClientHandlers } from "@cinder/core";
import { createInMemoryRelayNetwork } from "@cinder/relay";
import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import { normalizeRelayUrl, RELAY_STALE_MS, RelayChatBackend } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/** 兩座互不相識的 relay（模擬兩個自架 worker），與依 URL 取用的連線工廠。 */
function twoRelays() {
  const netX = createInMemoryRelayNetwork();
  const netY = createInMemoryRelayNetwork();
  const nets: Record<string, ReturnType<typeof createInMemoryRelayNetwork>> = {
    "wss://x": netX,
    "wss://y": netY,
  };
  let n = 0;
  const connectorFor = (url: string) => (h: RelayClientHandlers) =>
    nets[url]!.connect(`pool-${n++}`, h);
  /** 對某座 relay 掛側錄訂閱，回傳收到的事件陣列。 */
  const spy = (net: ReturnType<typeof createInMemoryRelayNetwork>, filter: object): NostrEvent[] => {
    const got: NostrEvent[] = [];
    const c = net.connect(`spy-${n++}`, { onEvent: (_s, e) => got.push(e) });
    c.subscribe("spy", [filter as never]);
    return got;
  };
  return { netX, netY, connectorFor, spy };
}

describe("normalizeRelayUrl（ADR-0034）", () => {
  it("trim、去尾斜線；非 ws(s) 或空值回傳 undefined", () => {
    expect(normalizeRelayUrl(" wss://x/ ")).toBe("wss://x");
    expect(normalizeRelayUrl("ws://localhost:8787")).toBe("ws://localhost:8787");
    expect(normalizeRelayUrl("https://x")).toBeUndefined();
    expect(normalizeRelayUrl("")).toBeUndefined();
    expect(normalizeRelayUrl(undefined)).toBeUndefined();
  });
});

describe("跨中繼通訊：Relay Pool 與收件人路由（ADR-0034）", () => {
  it("私訊路由到收件人的 relay：Alice(home X) → Bob(home Y) 送達，且不經 X", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(`${b.selfNpub}@wss://y`);
    // 側錄在加好友「之後」掛上——加好友會先送一則個人檔 gift wrap（ADR-0061），
    // 這裡只想量「訊息」的路由（個人檔路由另有測試）。
    const dmOnX = spy(netX, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });
    const dmOnY = spy(netY, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });
    a.sendMessage(b.self.pubkey, "跨 relay 哈囉");

    expect(bIncoming.map((m) => m.text)).toContain("跨 relay 哈囉");
    expect(dmOnY).toHaveLength(1);
    expect(dmOnX).toHaveLength(0); // 不浪費也不外洩到自己的 home
    a.stop();
    b.stop();
  });

  it("不對稱認知：Bob 無 hint 回覆走他的 home Y，Alice 靠 pool 收件箱收到", () => {
    const { netX, netY, connectorFor } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const aIncoming: ChatMessage[] = [];
    const bIncoming: ChatMessage[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m) });
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(`${b.selfNpub}@wss://y`);
    a.sendMessage(b.self.pubkey, "去程");
    expect(bIncoming.map((m) => m.text)).toContain("去程");

    // Bob 被自動加入 Alice（無 relay hint）→ 回覆退回自己的 home Y
    b.sendMessage(a.self.pubkey, "回程");
    expect(aIncoming.map((m) => m.text)).toContain("回程");
    a.stop();
    b.stop();
  });

  it("心跳發到 pool 中所有 relay：對方未記錄我的 relay 也看得到我在線", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    a.start(noop);
    b.start(noop);
    a.addContact(`${b.selfNpub}@wss://y`); // 建立 pool 連線 Y

    const hbOnX = spy(netX, { kinds: [KIND.HEARTBEAT], authors: [a.self.pubkey] });
    const hbOnY = spy(netY, { kinds: [KIND.HEARTBEAT], authors: [a.self.pubkey] });
    a.setStatus("online"); // 觸發即時心跳

    expect(hbOnX).toHaveLength(1);
    expect(hbOnY).toHaveLength(1);
    expect(hbOnX[0]!.id).toBe(hbOnY[0]!.id); // 同一顆心跳扇出
    a.stop();
    b.stop();
  });

  it("同一事件經多個 relay 抵達只處理一次（去重）", () => {
    const { netX, netY, connectorFor } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const aIncoming: ChatMessage[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m) });
    b.start(noop);
    a.addContact(`${b.selfNpub}@wss://y`); // Alice 的收件箱同時掛在 X 與 Y

    // 第三方把「同一個」給 Alice 的 wrap 各發一次到 X 與 Y
    const senderSk = (b as unknown as { sk: Uint8Array }).sk;
    const wrap = wrapMessage("雙路送達", senderSk, a.self.pubkey);
    const pubX = netX.connect("dup-x", {});
    const pubY = netY.connect("dup-y", {});
    pubX.publish(wrap);
    pubY.publish(wrap);

    expect(aIncoming.filter((m) => m.text === "雙路送達")).toHaveLength(1);
    a.stop();
    b.stop();
  });

  it("addContact 解析 hint：尾斜線正規化、與 home 相同時不儲存、純 npub 不受影響", () => {
    const { netX, connectorFor } = twoRelays();
    const store = new MemoryStorage();
    const a = new RelayChatBackend(store, (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
    const c = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("c", h), "Carol");
    const d = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("d", h), "Dan");
    a.start(noop);

    a.addContact(`${b.selfNpub}@wss://y/`);
    a.addContact(`${c.selfNpub}@wss://x`); // 同 home → 不存 hint
    a.addContact(d.selfNpub);

    const by = (pk: string) => store.loadContacts().find((x) => x.pubkey === pk)!;
    expect(by(b.self.pubkey).relayUrl).toBe("wss://y");
    expect(by(c.self.pubkey).relayUrl).toBeUndefined();
    expect(by(d.self.pubkey).relayUrl).toBeUndefined();
    a.stop();
  });

  it("selfShareUri：帶 home relay 時為 npub@url，未設定時同 npub", () => {
    const { netX, connectorFor } = twoRelays();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x/",
      connectorFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
    expect(a.selfShareUri).toBe(`${a.selfNpub}@wss://x`);
    expect(b.selfShareUri).toBe(b.selfNpub);
  });

  it("hint 自動學習（ADR-0035）：收到第一則來訊即自癒，回程直達對方 relay", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(storeB, (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const aIncoming: ChatMessage[] = [];
    a.start({ ...noop, onMessage: (_pk, m) => aIncoming.push(m) });
    b.start(noop);

    a.addContact(`${b.selfNpub}@wss://y`);
    a.sendMessage(b.self.pubkey, "帶 hint 的來訊");

    // Bob 被自動加入 Alice 且從加密 rumor 學到她的 relay
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.relayUrl).toBe("wss://x");

    // 回程：直達 X（不再退回 Bob 的 home Y）
    const dmToAOnX = spy(netX, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [a.self.pubkey] });
    const dmToAOnY = spy(netY, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [a.self.pubkey] });
    b.sendMessage(a.self.pubkey, "自癒後的回程");
    expect(aIncoming.map((m) => m.text)).toContain("自癒後的回程");
    expect(dmToAOnX).toHaveLength(1);
    expect(dmToAOnY).toHaveLength(0);
    a.stop();
    b.stop();
  });

  it("hint 學習的邊界：與收件人 home 相同存為無 hint；非法 hint 不動現有值", () => {
    const { netX, netY, connectorFor } = twoRelays();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://y", // 故意與 Bob 同 home
      connectorFor,
    });
    const b = new RelayChatBackend(storeB, (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    a.start(noop);
    b.start(noop);
    a.addContact(b.selfNpub); // 同 home，無需 hint
    a.sendMessage(b.self.pubkey, "同座來訊");
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.relayUrl).toBeUndefined();
    a.stop();
    b.stop();
  });

  it("pool 連線狀態：onRelayPool 回報 home 與外部座（home 標記正確）", () => {
    const { netX, connectorFor } = twoRelays();
    const seen: { url: string; state: string; home: boolean }[][] = [];
    // 外部座連接器：立刻回報 online
    const statefulFor = (url: string) => {
      const inner = connectorFor(url);
      return ((h: RelayClientHandlers, onStatus?: (s: "connecting" | "online" | "offline") => void) => {
        const c = inner(h);
        onStatus?.("online");
        return c;
      }) as ReturnType<typeof connectorFor>;
    };
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor: statefulFor,
    });
    a.start({ ...noop, onRelayPool: (rs) => seen.push(rs) });
    a.addContact(`${b.selfNpub}@wss://y`);

    const last = seen[seen.length - 1]!;
    expect(last).toContainEqual({ url: "wss://y", state: "online", home: false, stale: false });
    expect(last.find((r) => r.home)?.url).toBe("wss://x");
    a.stop();
    b.stop();
  });

  it("群訊帶 hint（ADR-0036）：入群（group-create）即學會建群者的 relay", () => {
    const { netX, netY, connectorFor } = twoRelays();
    const storeB = new MemoryStorage();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor,
    });
    const b = new RelayChatBackend(storeB, (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    a.start(noop);
    b.start(noop);
    // Bob 先手動加了 Alice 但沒有 hint（模擬僅知 npub）
    b.addContact(a.selfNpub);
    a.addContact(`${b.selfNpub}@wss://y`);

    a.createGroup("跨座群", [b.self.pubkey]);

    // group-create 的 rumor 帶 hint → Bob 學到 Alice 的 relay
    expect(storeB.loadContacts().find((c) => c.pubkey === a.self.pubkey)?.relayUrl).toBe("wss://x");
    a.stop();
    b.stop();
  });

  it("陳舊偵測（ADR-0036）：外部座連續離線超過門檻，onRelayPool 標記 stale", () => {
    vi.useFakeTimers();
    try {
      const { netX, connectorFor } = twoRelays();
      const statusCbs = new Map<string, (s: "connecting" | "online" | "offline") => void>();
      const statefulFor = (url: string) => {
        const inner = connectorFor(url);
        return ((h: RelayClientHandlers, onStatus?: (s: "connecting" | "online" | "offline") => void) => {
          if (onStatus) statusCbs.set(url, onStatus);
          return inner(h);
        }) as ReturnType<typeof connectorFor>;
      };
      const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
      const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
        relayUrl: "wss://x",
        connectorFor: statefulFor,
      });
      const seen: { url: string; state: string; stale: boolean }[][] = [];
      a.start({ ...noop, onRelayPool: (rs) => seen.push(rs) });
      a.addContact(`${b.selfNpub}@wss://y`);

      statusCbs.get("wss://y")!("offline");
      let y = seen[seen.length - 1]!.find((r) => r.url === "wss://y")!;
      expect(y.state).toBe("offline");
      expect(y.stale).toBe(false); // 剛斷線還不算陳舊

      vi.advanceTimersByTime(RELAY_STALE_MS + 2000); // 1 秒 tick 會重算 stale
      y = seen[seen.length - 1]!.find((r) => r.url === "wss://y")!;
      expect(y.stale).toBe(true);

      statusCbs.get("wss://y")!("online"); // 復活即解除
      y = seen[seen.length - 1]!.find((r) => r.url === "wss://y")!;
      expect(y.stale).toBe(false);
      a.stop();
      b.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("離線回退（ADR-0036）：目標座離線時雙發（目標佇列 + home），收端仍只收一次", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const statusCbs = new Map<string, (s: "connecting" | "online" | "offline") => void>();
    const statefulFor = (url: string) => {
      const inner = connectorFor(url);
      return ((h: RelayClientHandlers, onStatus?: (s: "connecting" | "online" | "offline") => void) => {
        if (onStatus) statusCbs.set(url, onStatus);
        return inner(h);
      }) as ReturnType<typeof connectorFor>;
    };
    const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor: statefulFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });
    a.addContact(`${b.selfNpub}@wss://y`);

    const dmOnX = spy(netX, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });
    const dmOnY = spy(netY, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });

    statusCbs.get("wss://y")!("offline"); // 目標座離線
    a.sendMessage(b.self.pubkey, "離線期間的訊息");

    expect(dmOnY).toHaveLength(1); // 照常投入目標座（in-memory 立即送達）
    expect(dmOnX).toHaveLength(1); // 回退 home 的副本
    expect(bIncoming.filter((m) => m.text === "離線期間的訊息")).toHaveLength(1); // 去重
    a.stop();
    b.stop();
  });

  it("清除 hint（ADR-0036 UI 動作）：聯絡人改回 home 路由、連線關閉並移出 pool", () => {
    const { netX, netY, connectorFor, spy } = twoRelays();
    const closed: string[] = [];
    const closableFor = (url: string) => {
      const inner = connectorFor(url);
      return ((h: RelayClientHandlers) => {
        const c = inner(h) as ReturnType<ReturnType<typeof connectorFor>> & { close?: () => void };
        c.close = () => closed.push(url);
        return c;
      }) as ReturnType<typeof connectorFor>;
    };
    const storeA = new MemoryStorage();
    const a = new RelayChatBackend(storeA, (h) => netX.connect("a", h), "Alice", {
      relayUrl: "wss://x",
      connectorFor: closableFor,
    });
    const b = new RelayChatBackend(new MemoryStorage(), (h) => netY.connect("b", h), "Bob", {
      relayUrl: "wss://y",
      connectorFor,
    });
    const seen: { url: string }[][] = [];
    a.start({ ...noop, onRelayPool: (rs) => seen.push(rs) });
    b.start(noop);
    a.addContact(`${b.selfNpub}@wss://y`);

    a.clearRelayHint("wss://y/"); // 正規化後匹配

    // hint 已移除、pool 快照不再含 Y、連線被關閉
    expect(storeA.loadContacts().find((c) => c.pubkey === b.self.pubkey)?.relayUrl).toBeUndefined();
    expect(seen[seen.length - 1]!.map((r) => r.url)).toEqual(["wss://x"]);
    expect(closed).toEqual(["wss://y"]);

    // 後續訊息改走 home X
    const dmOnX = spy(netX, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });
    const dmOnY = spy(netY, { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [b.self.pubkey] });
    a.sendMessage(b.self.pubkey, "清除後");
    expect(dmOnX).toHaveLength(1);
    expect(dmOnY).toHaveLength(0);
    a.stop();
    b.stop();
  });

  it("確認保留（ADR-0036 UI 動作）：重置離線計時、警告暫時消失後可再現", () => {
    vi.useFakeTimers();
    try {
      const { netX, connectorFor } = twoRelays();
      const statusCbs = new Map<string, (s: "connecting" | "online" | "offline") => void>();
      const statefulFor = (url: string) => {
        const inner = connectorFor(url);
        return ((h: RelayClientHandlers, onStatus?: (s: "connecting" | "online" | "offline") => void) => {
          if (onStatus) statusCbs.set(url, onStatus);
          return inner(h);
        }) as ReturnType<typeof connectorFor>;
      };
      const b = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("b", h), "Bob");
      const a = new RelayChatBackend(new MemoryStorage(), (h) => netX.connect("a", h), "Alice", {
        relayUrl: "wss://x",
        connectorFor: statefulFor,
      });
      const seen: { url: string; stale: boolean }[][] = [];
      a.start({ ...noop, onRelayPool: (rs) => seen.push(rs) });
      a.addContact(`${b.selfNpub}@wss://y`);
      const yStale = () => seen[seen.length - 1]!.find((r) => r.url === "wss://y")!.stale;

      statusCbs.get("wss://y")!("offline");
      vi.advanceTimersByTime(RELAY_STALE_MS + 2000);
      expect(yStale()).toBe(true);

      a.acknowledgeRelayStale("wss://y"); // 確認保留 → 警告消失
      expect(yStale()).toBe(false);

      vi.advanceTimersByTime(RELAY_STALE_MS + 2000); // 仍持續離線 → 再次警告
      expect(yStale()).toBe(true);
      a.stop();
      b.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("單 relay 模式（未提供 connectorFor）：hint 被忽略、行為與既有相同", () => {
    const net = createInMemoryRelayNetwork();
    const a = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("a", h), "Alice");
    const b = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("b", h), "Bob");
    const bIncoming: ChatMessage[] = [];
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });

    a.addContact(`${b.selfNpub}@wss://elsewhere`); // hint 存了也只會退回唯一連線
    a.sendMessage(b.self.pubkey, "單機模式");
    expect(bIncoming.map((m) => m.text)).toContain("單機模式");
    a.stop();
    b.stop();
  });
});
