// 背景收件（ADR-0415 B）：沒在用的身分只掛一條收件匣訂閱，數「離開後的新訊息」。
// 🔴 它只能讀：不發任何事件（不送回條、不發心跳）、不寫儲存——切回去時正式後端照常處理。
import {
  KIND,
  TIMESTAMP_JITTER_SECONDS,
  generateSecretKey,
  getPublicKey,
  nsecEncode,
  wrapGroupMessage,
  wrapMessage,
  wrapReceipt,
  type NostrEvent,
  type RelayClientHandlers,
} from "@cinderous/core";
import { describe, expect, it } from "vitest";
import { InboxWatcher, fsRecipientKeys, mutedConvosOf, type CountedMessage } from "./inbox-watch.js";
import type { RelayConnector } from "./relay-backend.js";

function fakeRelay() {
  const subs: { id: string; filters: unknown[] }[] = [];
  const published: NostrEvent[] = [];
  let handlers: RelayClientHandlers | undefined;
  let closed = false;
  const connector: RelayConnector = (h) => {
    handlers = h;
    return {
      publish: (e) => published.push(e),
      subscribe: (id, filters) => subs.push({ id, filters }),
      unsubscribe: () => {},
      close: () => {
        closed = true;
      },
    };
  };
  return {
    connector,
    subs,
    published,
    deliver: (e: NostrEvent) => handlers?.onEvent?.("inbox", e),
    get handlers() {
      return handlers;
    },
    get closed() {
      return closed;
    },
  };
}

const me = generateSecretKey();
const mePk = getPublicKey(me);
const alice = generateSecretKey();
const SINCE = 1_800_000_000;

function watch(relay: ReturnType<typeof fakeRelay>, counts: number[], blocked: string[] = []) {
  return new InboxWatcher({
    self: mePk,
    sk: me,
    url: "wss://relay/s/ab",
    connector: relay.connector,
    sinceSec: SINCE,
    keys: () => [me],
    blocked: new Set(blocked),
    onCount: (n) => counts.push(n),
  });
}

describe("InboxWatcher（ADR-0415 背景收件）", () => {
  it("只訂收件匣，since 往前推 2 天（外層時戳有抖動）", () => {
    const relay = fakeRelay();
    watch(relay, []);
    expect(relay.subs).toHaveLength(1);
    expect(relay.subs[0]!.filters).toEqual([
      { kinds: [KIND.OFFLINE_DM_GIFT_WRAP], "#p": [mePk], since: SINCE - TIMESTAMP_JITTER_SECONDS },
    ]);
  });

  it("認證後重掛訂閱，並用這個身分回應 AUTH", () => {
    const relay = fakeRelay();
    watch(relay, []);
    const auth = relay.handlers!.authSigner!("chal");
    expect(auth.pubkey).toBe(mePk);
    expect(auth.tags).toContainEqual(["relay", "wss://relay/s/ab"]);
    relay.handlers!.onAuthenticated!({ subscribe: (id: string, f: unknown[]) => relay.subs.push({ id, filters: f }) } as never);
    expect(relay.subs).toHaveLength(2);
  });

  it("數離開之後別人寄來的訊息；同一則（rumor id）不重複數", () => {
    const relay = fakeRelay();
    const counts: number[] = [];
    watch(relay, counts);
    const w = wrapMessage("hi", alice, mePk, { now: SINCE + 10 });
    relay.deliver(w.events[0]!);
    relay.deliver(w.events[0]!);
    relay.deliver(wrapMessage("yo", alice, mePk, { now: SINCE + 20 }).events[0]!);
    expect(counts).toEqual([1, 2]);
  });

  it("不數：離開前的舊訊息、回條、自己別台裝置的副本、封鎖的人、解不開的", () => {
    const relay = fakeRelay();
    const counts: number[] = [];
    const mallory = generateSecretKey();
    watch(relay, counts, [getPublicKey(mallory)]);
    relay.deliver(wrapMessage("old", alice, mePk, { now: SINCE - 5 }).events[0]!);
    relay.deliver(wrapReceipt("read", alice, mePk, "a".repeat(64), { now: SINCE + 10 }));
    relay.deliver(wrapMessage("from my laptop", me, getPublicKey(alice), { now: SINCE + 10 }).selfCopy);
    relay.deliver(wrapMessage("spam", mallory, mePk, { now: SINCE + 10 }).events[0]!);
    relay.deliver(wrapMessage("not for me", alice, getPublicKey(generateSecretKey()), { now: SINCE + 10 }).events[0]!);
    expect(counts).toEqual([]);
  });

  it("🔴 只讀：收到訊息也不發任何事件（不送已送達回條）", () => {
    const relay = fakeRelay();
    watch(relay, []);
    relay.deliver(wrapMessage("hi", alice, mePk, { now: SINCE + 10 }).events[0]!);
    expect(relay.published).toEqual([]);
  });

  it("stop() 斷線，之後到的不再數", () => {
    const relay = fakeRelay();
    const counts: number[] = [];
    const w = watch(relay, counts);
    w.stop();
    expect(relay.closed).toBe(true);
    relay.deliver(wrapMessage("late", alice, mePk, { now: SINCE + 10 }).events[0]!);
    expect(counts).toEqual([]);
  });
});

describe("前向保密的訊息（加密到 EK）", () => {
  const ek = generateSecretKey();
  const ekPk = getPublicKey(ek);
  const fsWrap = () =>
    wrapMessage("fs", alice, mePk, { now: SINCE + 10, fs: { myEk: getPublicKey(alice), encryptToFor: () => ekPk } }).events[0]!;

  it("有那把 EK 才解得開、才數得到；fsRecipientKeys 把本機存的 EK 與身分金鑰一起交出", () => {
    const keys = fsRecipientKeys([{ nsec: nsecEncode(ek), pk: ekPk, at: 1 }], me);
    expect(keys).toHaveLength(2);
    for (const [k, expected] of [[[me], []], [keys, [1]]] as const) {
      const relay = fakeRelay();
      const counts: number[] = [];
      new InboxWatcher({ self: mePk, sk: me, url: "wss://r", connector: relay.connector, sinceSec: SINCE, keys: () => [...k], onCount: (n) => counts.push(n) });
      relay.deliver(fsWrap());
      expect(counts).toEqual(expected);
    }
  });
});

describe("陌生人不數（ADR-0121：接受前不跳通知）", () => {
  it("給了聯絡人名單：只數聯絡人寄來的；陌生人的不數", () => {
    const relay = fakeRelay();
    const counts: number[] = [];
    const stranger = generateSecretKey();
    new InboxWatcher({
      self: mePk, sk: me, url: "wss://r", connector: relay.connector, sinceSec: SINCE, keys: () => [me],
      known: { contacts: new Set([getPublicKey(alice)]), groups: new Set() },
      onCount: (n) => counts.push(n),
    });
    relay.deliver(wrapMessage("hi from stranger", stranger, mePk, { now: SINCE + 10 }).events[0]!);
    expect(counts).toEqual([]);
    relay.deliver(wrapMessage("hi from alice", alice, mePk, { now: SINCE + 10 }).events[0]!);
    expect(counts).toEqual([1]);
  });
});

describe("onCount 帶出剛數到那一則的路由資訊（給呼叫端套通知閘門）", () => {
  it("1:1：寄件人、沒有群組；不含內文", () => {
    const relay = fakeRelay();
    const got: CountedMessage[] = [];
    new InboxWatcher({ self: mePk, sk: me, url: "wss://r", connector: relay.connector, sinceSec: SINCE, keys: () => [me], onCount: (_n, m) => got.push(m) });
    relay.deliver(wrapMessage("secret", alice, mePk, { now: SINCE + 10 }).events[0]!);
    expect(got).toEqual([{ sender: getPublicKey(alice), mentionsMe: false }]);
  });

  it("群訊：帶群組 id；@我 時 mentionsMe", () => {
    const relay = fakeRelay();
    const got: CountedMessage[] = [];
    new InboxWatcher({ self: mePk, sk: me, url: "wss://r", connector: relay.connector, sinceSec: SINCE, keys: () => [me], onCount: (_n, m) => got.push(m) });
    const alicePk = getPublicKey(alice);
    const group = { id: "g1", name: "G", admin: alicePk, members: [alicePk, mePk] };
    const forMe = (w: { events: NostrEvent[] }) => w.events.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === mePk))!;
    relay.deliver(forMe(wrapGroupMessage("plain", alice, alicePk, group, { now: SINCE + 10 })));
    relay.deliver(forMe(wrapGroupMessage("@me", alice, alicePk, group, { now: SINCE + 11, mentions: [mePk] })));
    expect(got).toEqual([
      { sender: alicePk, group: "g1", mentionsMe: false },
      { sender: alicePk, group: "g1", mentionsMe: true },
    ]);
  });
});

describe("mutedConvosOf（後端與背景收件共用）", () => {
  it("只取 mute: 開頭且 v=1 的", () => {
    expect(mutedConvosOf({ "mute:a": { v: "1" }, "mute:b": { v: "" }, "other:c": { v: "1" } })).toEqual(["a"]);
  });
});
