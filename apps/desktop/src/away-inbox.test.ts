import { shardPath } from "@cinderous/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  awayDelta,
  bgInboxEnabled,
  bgStartDelayMs,
  inboxUrlOf,
  readAway,
  recordAway,
  setBgInboxEnabled,
  takeAway,
  totalUnread,
} from "./away-inbox.js";

const PK = "a".repeat(64);

describe("沒在用的身分的新訊息（ADR-0415）", () => {
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

  it("背景收件（B）預設關，設定裡打開才有", () => {
    expect(bgInboxEnabled()).toBe(false);
    setBgInboxEnabled(true);
    expect(bgInboxEnabled()).toBe(true);
    setBgInboxEnabled(false);
    expect(bgInboxEnabled()).toBe(false);
  });

  it("C：切走時記下離開時間與未讀數，切回來讀一次就清掉", () => {
    recordAway(PK, { at: 100, unread: 2 });
    expect(readAway(PK)).toEqual({ at: 100, unread: 2 });
    expect(takeAway(PK)).toEqual({ at: 100, unread: 2 });
    expect(takeAway(PK)).toBeUndefined();
  });

  it("壞掉的紀錄當作沒有", () => {
    localStorage.setItem(`nb.away.${PK}`, "{oops");
    expect(readAway(PK)).toBeUndefined();
    localStorage.setItem(`nb.away.${PK}`, JSON.stringify({ at: "x" }));
    expect(readAway(PK)).toBeUndefined();
  });

  it("離開期間多出來的未讀數；別台裝置讀掉了也不會是負的", () => {
    expect(totalUnread({ a: 2, b: 3 })).toBe(5);
    expect(awayDelta(2, 5)).toBe(3);
    expect(awayDelta(5, 1)).toBe(0);
  });

  it("收件匣網址：個人身分在分片模式下是自己的訊息片，工作身分固定公司站", () => {
    const p = { pubkey: PK, relayUrl: "wss://r" };
    expect(inboxUrlOf(p, true)).toBe(`wss://r${shardPath(PK)}`);
    expect(inboxUrlOf(p, false)).toBe("wss://r");
    expect(inboxUrlOf({ ...p, enterprise: true }, true)).toBe("wss://r");
  });

  it("背景連線錯開 5～30 秒", () => {
    expect(bgStartDelayMs(() => 0)).toBe(5_000);
    expect(bgStartDelayMs(() => 0.999)).toBeLessThan(30_000);
  });
});
