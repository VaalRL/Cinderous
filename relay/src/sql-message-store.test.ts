import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { NostrEvent } from "@cinder/core";
import { describe, expect, it } from "vitest";
import type { RelayFilter } from "./protocol.js";
import { type SqlExec, SqlMessageStore } from "./sql-message-store.js";

// node:sqlite 太新、vite 的內建模組表尚未收錄 → 靜態 import 會解析失敗（找 "sqlite"）。
// 改以 createRequire 動態載入（繞過 vite 靜態解析），型別走 type-only import（會被抹除）。
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

/** 以 Node 內建 SQLite 實作 SqlExec（模擬 DO 的 ctx.storage.sql.exec，同步）。 */
function nodeSqlExec(): SqlExec {
  const db = new DatabaseSync(":memory:");
  return (query, ...bindings) => {
    const stmt = db.prepare(query);
    if (/^\s*select/i.test(query)) return stmt.all(...bindings) as Record<string, unknown>[];
    stmt.run(...bindings);
    return [];
  };
}

function ev(
  id: string,
  opts: { p?: string[]; kind?: number; createdAt?: number; expiration?: number } = {},
): NostrEvent {
  const tags: string[][] = (opts.p ?? []).map((r) => ["p", r]);
  if (opts.expiration !== undefined) tags.push(["expiration", String(opts.expiration)]);
  return {
    id,
    pubkey: "author",
    created_at: opts.createdAt ?? 1000,
    kind: opts.kind ?? 1059,
    tags,
    content: "",
    sig: "",
  } as NostrEvent;
}

const f = (filter: Partial<RelayFilter>): RelayFilter => filter as RelayFilter;

describe("SqlMessageStore（DO SQLite 離線留言，ADR-0056）", () => {
  it("put + 依 #p 查回；其他收件人不返回", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    expect(s.put(ev("m1", { p: ["alice"] }), 1000)).toBe(true);
    s.put(ev("m2", { p: ["bob"] }), 1000);
    expect(s.query(f({ "#p": ["alice"] }), 1000).map((e) => e.id)).toEqual(["m1"]);
  });

  it("NIP-40 過期：已過期不 put；未來過期可查、到期後不返回", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    expect(s.put(ev("old", { p: ["a"], expiration: 500 }), 1000)).toBe(false);
    s.put(ev("live", { p: ["a"], expiration: 2000 }), 1000);
    expect(s.query(f({ "#p": ["a"] }), 1000).map((e) => e.id)).toEqual(["live"]);
    expect(s.query(f({ "#p": ["a"] }), 2001).map((e) => e.id)).toEqual([]);
  });

  it("per-recipient cap 逐出最舊", () => {
    const s = new SqlMessageStore(nodeSqlExec(), { maxPerRecipient: 2 });
    s.put(ev("a", { p: ["r"], createdAt: 1 }), 1000);
    s.put(ev("b", { p: ["r"], createdAt: 2 }), 1000);
    s.put(ev("c", { p: ["r"], createdAt: 3 }), 1000);
    expect(
      s
        .query(f({ "#p": ["r"] }), 1000)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["b", "c"]); // 最舊的 a 被逐出
  });

  it("prune 刪除已過期留言", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    s.put(ev("live", { p: ["a"], expiration: 5000 }), 1000);
    s.put(ev("willexpire", { p: ["a"], expiration: 1500 }), 1000);
    s.prune(2000); // willexpire 已過期
    expect(s.query(f({ "#p": ["a"] }), 1000).map((e) => e.id)).toEqual(["live"]);
  });

  it("matchFilter：依 kinds 過濾", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    s.put(ev("g", { p: ["a"], kind: 1059 }), 1000);
    s.put(ev("other", { p: ["a"], kind: 1 }), 1000);
    expect(s.query(f({ "#p": ["a"], kinds: [1059] }), 1000).map((e) => e.id)).toEqual(["g"]);
  });

  it("多 p 標籤：兩收件人查詢皆回且去重", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    s.put(ev("m", { p: ["a", "b"] }), 1000);
    expect(s.query(f({ "#p": ["a", "b"] }), 1000).map((e) => e.id)).toEqual(["m"]);
  });
});

describe("壽命上限（ADR-0065：孤兒資料不可能）", () => {
  const WEEK = 7 * 86_400;

  it("無 expiration 的事件套預設 TTL：7 天後 prune/query 都收走（修正前會永存）", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    s.put(ev("noexp", { p: ["a"] }), 1000);
    expect(s.query(f({ "#p": ["a"] }), 1000).map((e) => e.id)).toEqual(["noexp"]);
    const after = 1000 + WEEK + 1;
    expect(s.query(f({ "#p": ["a"] }), after)).toEqual([]);
    s.prune(after);
    expect(s.query(f({ "#p": ["a"] }), 1000)).toEqual([]); // 真的刪了，不是只被過濾
  });

  it("惡意超長 expiration 被截到上限（7 天）", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    s.put(ev("huge", { p: ["a"], expiration: 999_999_999 }), 1000);
    expect(s.query(f({ "#p": ["a"] }), 1000 + WEEK + 1)).toEqual([]);
  });

  it("遷移：修正前殘留的 NULL 到期列，重啟（重建 store）後補上有界壽命", () => {
    const sql = nodeSqlExec();
    new SqlMessageStore(sql); // 建表
    sql(
      `INSERT INTO offline_msgs (id, recipient, expiration, created_at, json) VALUES (?, ?, NULL, ?, ?)`,
      "legacy",
      "a",
      1000,
      JSON.stringify(ev("legacy", { p: ["a"] })),
    );
    const s = new SqlMessageStore(sql); // 重啟：constructor 遷移 NULL → created_at + TTL
    s.prune(1000 + WEEK + 1);
    expect(s.query(f({ "#p": ["a"] }), 1000)).toEqual([]);
  });
});
