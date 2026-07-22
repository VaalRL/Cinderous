import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { NostrEvent } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import type { RelayFilter } from "./protocol.js";
import { MAX_QUERY_ROWS } from "./message-store.js";
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

  it("放寬上限（ADR-0160 企業站 MAX_TTL_DAYS）：30 天章在 90 天上限站不被截；仍截超過站方上限者", () => {
    const s = new SqlMessageStore(nodeSqlExec(), { maxTtlSeconds: 90 * 86_400 });
    s.put(ev("m30", { p: ["a"], expiration: 1000 + 30 * 86_400 }), 1000);
    s.put(ev("huge", { p: ["b"], expiration: 999_999_999 }), 1000);
    // 30 天章：第 29 天仍在、第 31 天收走（未被舊的 7 天上限截斷）。
    expect(s.query(f({ "#p": ["a"] }), 1000 + 29 * 86_400).map((e) => e.id)).toEqual(["m30"]);
    expect(s.query(f({ "#p": ["a"] }), 1000 + 31 * 86_400)).toEqual([]);
    // 超長章仍被截到站方上限（90 天）——站方上限恆為權威。
    expect(s.query(f({ "#p": ["b"] }), 1000 + 89 * 86_400).map((e) => e.id)).toEqual(["huge"]);
    expect(s.query(f({ "#p": ["b"] }), 1000 + 91 * 86_400)).toEqual([]);
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

describe("SQL 可尋址事件（NIP-33，ADR-0071 快照）", () => {
  const snap = (opts: { d?: string; content?: string; createdAt?: number; pubkey?: string; id?: string } = {}): NostrEvent =>
    ({
      id: opts.id ?? `snap-${opts.d ?? "dev1"}-${opts.createdAt ?? 1000}`,
      pubkey: opts.pubkey ?? "author",
      created_at: opts.createdAt ?? 1000,
      kind: 30078,
      tags: [["d", opts.d ?? "dev1"]],
      content: opts.content ?? "密文快照",
      sig: "",
    }) as NostrEvent;

  it("取代語意：同 (kind,pubkey,d) 只留最新；purge（空 content）刪除", () => {
    const s = new SqlMessageStore(nodeSqlExec());
    expect(s.putAddressable(snap({ createdAt: 1000, content: "v1" }), 1000)).toBe(true);
    expect(s.putAddressable(snap({ createdAt: 2000, content: "v2" }), 2000)).toBe(true);
    expect(s.putAddressable(snap({ createdAt: 500, content: "stale" }), 2100)).toBe(false);
    let got = s.query(f({ kinds: [30078], authors: ["author"] }), 2000);
    expect(got).toHaveLength(1);
    expect(got[0]?.content).toBe("v2");
    expect(s.putAddressable(snap({ createdAt: 3000, content: "" }), 3000)).toBe(true); // purge
    got = s.query(f({ kinds: [30078], authors: ["author"] }), 3000);
    expect(got).toHaveLength(0);
  });

  it("配額：每 (pubkey,kind) 至多 5 個 d、單顆 256KB；30 天到期 prune 收走", () => {
    const MONTH = 30 * 86_400;
    const s = new SqlMessageStore(nodeSqlExec());
    for (let i = 1; i <= 5; i++) expect(s.putAddressable(snap({ d: `dev${i}` }), 1000)).toBe(true);
    expect(s.putAddressable(snap({ d: "dev6" }), 1000)).toBe(false);
    expect(s.putAddressable(snap({ d: "dev1", createdAt: 2000 }), 2000)).toBe(true); // 既有位址可更新
    expect(s.putAddressable(snap({ d: "dev2", createdAt: 3000, content: "x".repeat(300_000) }), 3000)).toBe(false);
    s.prune(1000 + MONTH + 1);
    expect(s.query(f({ kinds: [30078], authors: ["author"] }), 1000)).toHaveLength(1); // 只剩 2000 寫入的 dev1
  });
});

// ADR-0235 C2：查詢條件下推 SQL。
//
// 修正前，`query()` 在沒有 `#p` 時執行 `SELECT json FROM offline_msgs WHERE expiration > ?`
// ——**整張表**（所有使用者的離線留言）撈進記憶體、逐筆 JSON.parse，再於 JS 端 matchFilter。
// 而 relay-core 的 `scoped()` 明文允許「沒有 `#p`、但有 authors」的訂閱（快照查詢就是這個
// 形狀），連 `authors: []` 都放行。於是 `{"authors":[]}` 是零成本 payload：匹配不到任何事件，
// 卻完整跑一次全表掃描。DO 記憶體上限 128MB，重複送幾次就 OOM——而這是單一全域房間。
describe("SqlMessageStore — 查詢下推與筆數上限（ADR-0235 C2）", () => {
  /** 記錄所有 SELECT 語句，用來證明過濾**發生在 SQL 而非 JS**。 */
  function spyExec(): { exec: SqlExec; selects: string[] } {
    const inner = nodeSqlExec();
    const selects: string[] = [];
    return {
      selects,
      exec: (query, ...bindings) => {
        if (/^\s*select/i.test(query)) selects.push(query);
        return inner(query, ...bindings);
      },
    };
  }

  const authored = (id: string, pubkey: string, createdAt = 1000): NostrEvent =>
    ({ ...ev(id, { p: ["r"], createdAt }), pubkey }) as NostrEvent;

  it("authors 下推到 SQL：WHERE 帶 pubkey 條件，不是撈全表再過濾", () => {
    const { exec, selects } = spyExec();
    const s = new SqlMessageStore(exec);
    s.put(authored("m1", "alice"), 1000);
    s.put(authored("m2", "bob"), 1000);
    selects.length = 0;

    expect(s.query(f({ authors: ["alice"] }), 1000).map((e) => e.id)).toEqual(["m1"]);
    expect(selects.some((q) => /pubkey\s+IN/i.test(q))).toBe(true);
  });

  it("kinds 下推到 SQL", () => {
    const { exec, selects } = spyExec();
    const s = new SqlMessageStore(exec);
    s.put(ev("g", { p: ["r"], kind: 1059 }), 1000);
    s.put(ev("o", { p: ["r"], kind: 1060 }), 1000);
    selects.length = 0;

    expect(s.query(f({ authors: ["author"], kinds: [1060] }), 1000).map((e) => e.id)).toEqual(["o"]);
    expect(selects.some((q) => /kind\s+IN/i.test(q))).toBe(true);
  });

  it("authors 為空陣列：直接回空，完全不打 DB（最便宜的消防水管 payload）", () => {
    const { exec, selects } = spyExec();
    const s = new SqlMessageStore(exec);
    s.put(authored("m1", "alice"), 1000);
    selects.length = 0;

    expect(s.query(f({ authors: [] }), 1000)).toEqual([]);
    expect(selects).toEqual([]);
  });

  it("ids 下推到 SQL", () => {
    const { exec, selects } = spyExec();
    const s = new SqlMessageStore(exec);
    s.put(authored("m1", "alice"), 1000);
    s.put(authored("m2", "alice"), 1000);
    selects.length = 0;

    expect(s.query(f({ ids: ["m2"] }), 1000).map((e) => e.id)).toEqual(["m2"]);
    expect(selects.some((q) => /\bid\s+IN/i.test(q))).toBe(true);
  });

  // 「訂閱必須具名」是 relay-core `scoped()` 的職責（ADR-0123），不放在儲存層——儲存層若也
  // 擋，「Ephemeral 不入庫」那類**否定斷言**會變成恆真的空轉測試。這一層保證的是「有界」。
  it("不具名的 filter 仍可查（不改語意），但一律帶 LIMIT——代價有界", () => {
    const { exec, selects } = spyExec();
    const s = new SqlMessageStore(exec, { maxPerRecipient: 10_000 });
    for (let i = 0; i < 2000; i++) s.put(ev(`m${i}`, { p: ["r"], createdAt: 1000 + i }), 1000);
    selects.length = 0;

    const got = s.query(f({ kinds: [1059] }), 1000);
    expect(got.length).toBeLessThanOrEqual(MAX_QUERY_ROWS);
    expect(selects.every((q) => /LIMIT \?/.test(q))).toBe(true);
  });

  it("回傳筆數有硬上限，且取最新的", () => {
    const s = new SqlMessageStore(nodeSqlExec(), { maxPerRecipient: 10_000 });
    for (let i = 0; i < 60; i++) s.put(ev(`m${i}`, { p: ["r"], createdAt: 1000 + i }), 1000);
    const got = s.query(f({ "#p": ["r"], limit: 10 }), 1000);
    expect(got).toHaveLength(10);
    // 最新的 10 筆（created_at 1050–1059）
    expect(got.map((e) => e.created_at).sort((a, b) => a - b)[0]).toBe(1050);
  });

  it("filter.limit 超過硬上限時被夾住", () => {
    const s = new SqlMessageStore(nodeSqlExec(), { maxPerRecipient: 10_000 });
    for (let i = 0; i < 1200; i++) s.put(ev(`m${i}`, { p: ["r"], createdAt: 1000 + i }), 1000);
    expect(s.query(f({ "#p": ["r"], limit: 999_999 }), 1000).length).toBeLessThanOrEqual(MAX_QUERY_ROWS);
  });

  it("舊資料（升級前寫入、無 pubkey/kind 欄）也查得到——遷移有回填", () => {
    const db = nodeSqlExec();
    // 模擬舊 schema：先由舊版建表寫入，再以新版開啟同一個 DB。
    db(`CREATE TABLE IF NOT EXISTS offline_msgs (
      id TEXT NOT NULL, recipient TEXT NOT NULL, expiration INTEGER,
      created_at INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (id, recipient))`);
    db(
      `INSERT INTO offline_msgs (id, recipient, expiration, created_at, json) VALUES (?, ?, ?, ?, ?)`,
      "old1",
      "r",
      9_999_999,
      1000,
      JSON.stringify(authored("old1", "alice")),
    );
    const s = new SqlMessageStore(db);
    expect(s.query(f({ authors: ["alice"] }), 1000).map((e) => e.id)).toEqual(["old1"]);
  });
});
