// DO SQLite 遷移相容性（ADR-0379；SDK ADR 0029／0042 的 schema-compat.test.ts 對應）。
//
// ## 為什麼要有這個檔案
//
// 容量功能的移植在 DO SQLite 加了兩個欄位、兩個部分索引與一張表（SDK ADR 0042 §8）。部署那一刻，**同一顆**
// Durable Object 的 SQLite 會從「移植前（origin/main 22e3860c）的建構子建的 schema」直接被新的建構子打開——
// 中間沒有任何人工遷移。任何一個 `CREATE`／`ALTER` 不等冪，症狀就是 DO 在建構子裡丟例外（整片斷線）。
//
// 另一個要求：PR #9 會讓錨點改跑 SDK 的中繼，兩邊**從零建的 schema 必須逐字相同**，否則切換時又是一次遷移。
// 所以 {@link SDK_0042_ADDITIONS} 逐字抄自 SDK（cinderous-sdk-dev 6c36ebd 的 tests/relay/schema-compat.test.ts），
// 移植前的 schema 逐字抄自 SDK 同一份檔案（SDK 以 22e3860c 重抄比對過），這裡再用移植前的 store 原樣
//（`fixtures/main-22e3860c-stores.mjs`）實際建一次確認。

import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { NostrEvent } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import { ConnPersistence } from "./conn-persistence.js";
import { FILE_WRAP_KIND } from "./message-store.js";
import { type SqlExec, SqlMessageStore } from "./sql-message-store.js";
import * as main from "./fixtures/main-22e3860c-stores.mjs";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

/** 移植前（origin/main 22e3860c，ADR-0371／0372／0373／0375／0376／0377）建構子跑完後的 schema——逐字。 */
const CINDEROUS_MAIN_SCHEMA = [
  `CREATE TABLE addressable (
        kind INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        d TEXT NOT NULL,
        id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expiration INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (kind, pubkey, d)
      )`,
  `CREATE TABLE offline_msgs (
        id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        expiration INTEGER,
        created_at INTEGER NOT NULL,
        json TEXT NOT NULL, pubkey TEXT, kind INTEGER, bytes INTEGER,
        PRIMARY KEY (id, recipient)
      )`,
  "CREATE INDEX idx_addressable_expiration ON addressable(expiration)",
  "CREATE INDEX idx_addressable_pubkey ON addressable(pubkey)",
  "CREATE INDEX idx_offline_bucket ON offline_msgs(recipient, kind, created_at, expiration, bytes)",
  "CREATE INDEX idx_offline_bytes_missing ON offline_msgs(id) WHERE bytes IS NULL",
  "CREATE INDEX idx_offline_expiration ON offline_msgs(expiration)",
  "CREATE INDEX idx_offline_kind ON offline_msgs(kind)",
  "CREATE INDEX idx_offline_pubkey ON offline_msgs(pubkey)",
  `CREATE TABLE ws_subs (
        conn_id TEXT NOT NULL,
        sub_id  TEXT NOT NULL,
        filters TEXT NOT NULL,
        PRIMARY KEY (conn_id, sub_id)
      )`,
];

/**
 * SDK ADR 0042（v0.34.0）在 Cinderous 的 schema 之上加的東西——**逐字**（與 SDK 的 `SDK_0042_ADDITIONS` 相同）。
 * 全部是相容遷移：兩個 `ADD COLUMN`（有預設值）、兩個只收借用列的部分索引、一張丟棄計數表與它的索引。
 */
const SDK_0042_ADDITIONS = [
  `ALTER TABLE offline_msgs ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE addressable ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX idx_offline_borrowed ON offline_msgs(recipient, pubkey, expiration, bytes, created_at) WHERE borrowed = 1`,
  `CREATE INDEX idx_addressable_borrowed ON addressable(pubkey, expiration) WHERE borrowed = 1`,
  `CREATE TABLE inbox_drops (
        recipient TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        since INTEGER,
        until INTEGER,
        mark INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
  `CREATE INDEX idx_inbox_drops_updated ON inbox_drops(updated_at)`,
];

function openDb(): { db: DatabaseSyncType; exec: SqlExec } {
  const db = new DatabaseSync(":memory:");
  const exec: SqlExec = (query, ...bindings) => {
    const stmt = db.prepare(query);
    if (/^\s*select/i.test(query)) return stmt.all(...bindings) as Record<string, unknown>[];
    stmt.run(...bindings);
    return [];
  };
  return { db, exec };
}

function schemaOf(db: DatabaseSyncType): { type: string; name: string; sql: string }[] {
  return db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as { type: string; name: string; sql: string }[];
}

/** `RelayRoom` 建構子會開的兩樣東西：store 與 `ws_subs` 溢位表（ADR-0373）。 */
function openLikeRoom(exec: SqlExec): void {
  new SqlMessageStore(exec, {});
  new ConnPersistence(exec);
}

/** 移植前的 `RelayRoom` 建構子（store 用 22e3860c 原樣；`ConnPersistence` 這次沒有改）。 */
function openLikeMainRoom(exec: SqlExec): void {
  new main.SqlMessageStore(exec, {});
  new ConnPersistence(exec);
}

const NOW = 1_800_000_000;
const ALICE = "a".repeat(64);

function chunk(n: number): NostrEvent {
  return {
    id: n.toString(16).padStart(64, "0"),
    pubkey: "b".repeat(64),
    created_at: NOW - 100 + n,
    kind: FILE_WRAP_KIND,
    tags: [["p", ALICE]],
    content: "x".repeat(1000),
    sig: "c".repeat(128),
  };
}

describe("DO SQLite：從移植前（22e3860c）的 schema 升上來（ADR-0379；SDK ADR 0042 §8）", () => {
  it("夾具自我檢查：移植前的建構子建出來的就是 CINDEROUS_MAIN_SCHEMA（逐字）", () => {
    const viaMain = openDb();
    openLikeMainRoom(viaMain.exec);
    const literal = openDb();
    for (const ddl of CINDEROUS_MAIN_SCHEMA) literal.exec(ddl);
    expect(schemaOf(viaMain.db)).toEqual(schemaOf(literal.db));
  });

  it("🔴 新建構子打開移植前的 DB：不丟例外、重跑不丟例外（每次喚醒都跑）、收斂到從零建的 schema", () => {
    const { db, exec } = openDb();
    openLikeMainRoom(exec);
    expect(() => openLikeRoom(exec)).not.toThrow();
    const once = schemaOf(db);
    expect(() => openLikeRoom(exec)).not.toThrow();
    expect(schemaOf(db)).toEqual(once);
    const fresh = openDb();
    openLikeRoom(fresh.exec);
    expect(once).toEqual(schemaOf(fresh.db));
  });

  it("🔴 從零建的 schema＝移植前的＋SDK ADR 0042 的相容遷移（逐字；與 SDK 中繼從零建的相同，PR #9 切換不必再遷移）", () => {
    const expected = openDb();
    for (const ddl of [...CINDEROUS_MAIN_SCHEMA, ...SDK_0042_ADDITIONS]) expected.exec(ddl);
    const fresh = openDb();
    openLikeRoom(fresh.exec);
    expect(schemaOf(fresh.db)).toEqual(schemaOf(expected.db));
  });

  it("移植前寫下的列升級後是正常列（borrowed＝0）、讀得回來、用量照舊算進天花板", () => {
    const { db, exec } = openDb();
    const old = new main.SqlMessageStore(exec, {});
    for (let i = 1; i <= 3; i += 1) expect(old.put(chunk(i), NOW)).toBe(true);
    expect(old.putAddressable({ ...chunk(9), kind: 30_078, tags: [["d", "snap"]] }, NOW)).toBe(true);
    const size = JSON.stringify(chunk(1)).length;
    // 天花板剛好只容得下既有的 3 顆（拒收制、沒有溢位帶＝錨點 ADR-0379 的設定）⇒ 第 4 顆被拒
    const store = new SqlMessageStore(exec, { offlineMaxTotalBytes: size * 3 + 10, nearFullPercent: 80, countDrops: true });
    const flags = db.prepare("SELECT borrowed FROM offline_msgs").all() as { borrowed: number }[];
    expect(flags.map((f) => f.borrowed)).toEqual([0, 0, 0]);
    expect((db.prepare("SELECT borrowed FROM addressable").get() as { borrowed: number }).borrowed).toBe(0);
    expect(store.query({ "#p": [ALICE] }, NOW)).toHaveLength(3);
    expect(store.query({ kinds: [30_078], authors: ["b".repeat(64)] }, NOW)).toHaveLength(1);
    expect(store.putResult!(chunk(4), NOW)).toMatchObject({ ok: false, reason: "ceiling" });
  });
});
