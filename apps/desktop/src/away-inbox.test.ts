import { shardPath } from "@cinderous/core";
import { DEFAULT_NOTIFY_PREFS } from "@cinderous/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advanceNotified,
  bgInboxEnabled,
  bgShouldNotify,
  bgStartDelayMs,
  countAwayMessage,
  inboxUrlOf,
  readAway,
  readOrgInfo,
  recordAway,
  saveOrgInfo,
  setBgInboxEnabled,
  takeAway,
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

  it("C：切走時記下離開時間，切回來讀一次就清掉", () => {
    recordAway(PK, { at: 100 });
    expect(readAway(PK)).toEqual({ at: 100 });
    expect(takeAway(PK)).toEqual({ at: 100 });
    expect(takeAway(PK)).toBeUndefined();
  });

  it("壞掉的紀錄當作沒有", () => {
    localStorage.setItem(`nb.away.${PK}`, "{oops");
    expect(readAway(PK)).toBeUndefined();
    localStorage.setItem(`nb.away.${PK}`, JSON.stringify({ at: "x" }));
    expect(readAway(PK)).toBeUndefined();
  });

  it("🔴 C 數的是離開後別人寄來的訊息——對話開著、訊息一到就已讀也照樣算（實機測試發現）", () => {
    const tally = { since: 100, until: 200_000, ids: new Set<string>() };
    expect(countAwayMessage(tally, { id: "a", outgoing: false, at: 101_000 })).toBe(true);
    expect(countAwayMessage(tally, { id: "a", outgoing: false, at: 101_000 })).toBe(false); // 重複
    expect(countAwayMessage(tally, { id: "b", outgoing: true, at: 101_000 })).toBe(false); // 自己送的
    expect(countAwayMessage(tally, { id: "c", outgoing: false, at: 99_000 })).toBe(false); // 離開前的
    expect(countAwayMessage(null, { id: "d", outgoing: false, at: 101_000 })).toBe(false); // 沒在數
    expect(tally.ids.size).toBe(1);
  });

  it("切回來之後才送出的不算「離開期間」（審查 L2）", () => {
    const tally = { since: 100, until: 200_000, ids: new Set<string>() };
    expect(countAwayMessage(tally, { id: "late", outgoing: false, at: 200_001 })).toBe(false);
    expect(countAwayMessage(tally, { id: "edge", outgoing: false, at: 200_000 })).toBe(true);
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

describe("背景收件的通知閘門（審查 M1／M2）", () => {
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

  const ALICE = "b".repeat(64);
  const base = {
    prefs: DEFAULT_NOTIFY_PREFS,
    masterOn: true,
    latest: { sender: ALICE, mentionsMe: false },
    muted: new Set<string>(),
    org: null,
    orgGroups: new Set<string>(),
    nowMin: 12 * 60,
  };

  it("預設會通知；總開關關掉就不通知", () => {
    expect(bgShouldNotify(base)).toBe(true);
    expect(bgShouldNotify({ ...base, masterOn: false })).toBe(false);
  });

  it("照 1:1／群組事件開關走；群訊 @我 可覆寫", () => {
    expect(bgShouldNotify({ ...base, prefs: { ...DEFAULT_NOTIFY_PREFS, dm: false } })).toBe(false);
    const g = { ...base, latest: { sender: ALICE, group: "g1", mentionsMe: false } };
    expect(bgShouldNotify({ ...g, prefs: { ...DEFAULT_NOTIFY_PREFS, group: false } })).toBe(false);
    expect(bgShouldNotify({ ...g, prefs: { ...DEFAULT_NOTIFY_PREFS, group: false }, latest: { ...g.latest, mentionsMe: true } })).toBe(true);
  });

  it("背景身分自己靜音的對話不通知（1:1 看寄件人、群訊看群組）", () => {
    expect(bgShouldNotify({ ...base, muted: new Set([ALICE]) })).toBe(false);
    expect(bgShouldNotify({ ...base, latest: { sender: ALICE, group: "g1", mentionsMe: false }, muted: new Set(["g1"]) })).toBe(false);
  });

  it("🔴 公司身分在背景時照樣套下班靜音（ADR-0157）", () => {
    saveOrgInfo("work", { members: [ALICE], workHours: { start: "09:00", end: "18:00" } });
    const org = readOrgInfo("work");
    expect(org).toEqual({ members: [ALICE], workHours: { start: "09:00", end: "18:00" } });
    expect(bgShouldNotify({ ...base, org, nowMin: 22 * 60 })).toBe(false); // 下班、同事寄的
    expect(bgShouldNotify({ ...base, org, nowMin: 10 * 60 })).toBe(true); // 上班時間
    expect(bgShouldNotify({ ...base, org, nowMin: 22 * 60, latest: { sender: "c".repeat(64), mentionsMe: false } })).toBe(true); // 不是同事
    const og = { ...base, org, nowMin: 22 * 60, latest: { sender: ALICE, group: "og", mentionsMe: false } };
    expect(bgShouldNotify({ ...og, orgGroups: new Set(["og"]) })).toBe(false); // 組織群組
  });

  it("🔴 通知水位：背景連線重建後重數到同一批，不重跳通知", () => {
    const marks: Record<string, number> = {};
    expect(advanceNotified(marks, "p", 1)).toBe(true);
    expect(advanceNotified(marks, "p", 2)).toBe(true);
    // 重建：從 1 重數
    expect(advanceNotified(marks, "p", 1)).toBe(false);
    expect(advanceNotified(marks, "p", 2)).toBe(false);
    expect(advanceNotified(marks, "p", 3)).toBe(true);
  });
});
