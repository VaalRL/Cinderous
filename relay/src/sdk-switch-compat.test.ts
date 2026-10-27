// 錨點切到 SDK 中繼的 DO SQLite 相容性（ADR-0370）。
//
// 部署那一刻，**同一顆** Durable Object 的 SQLite 會從「最後部署的錨點中繼（5137079c，ADR-0394）的建構子建的 schema」
// 直接被 SDK 的 `RelayRoom` 建構子打開——中間沒有任何人工遷移。任何一個 `CREATE`／`ALTER` 不等冪，
// 症狀就是 DO 在建構子裡丟例外（整片斷線）；兩邊從零建的 schema 不同，就是一次沒人寫過的遷移。
// 回滾（重新部署舊版）時方向相反，也要照常讀寫。
//
// 舊的儲存程式原樣打包在 `fixtures/main-5137079c-stores.mjs`（`node relay/src/fixtures/gen-main-stores.mjs` 產生）。
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { NostrEvent } from "@cinderous/core";
import { FILE_WRAP_KIND, type SqlExec, SqlMessageStore } from "@cinderous/client/relay";
import { RelayRoom, type Env } from "@cinderous/client/relay/worker";
import { describe, expect, it } from "vitest";
import * as main from "./fixtures/main-5137079c-stores.mjs";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

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

/** 舊的 `RelayRoom` 建構子會開的兩樣東西：store 與 `ws_subs` 溢位表（ADR-0373）。 */
function openLikeAnchor(exec: SqlExec): void {
  new main.SqlMessageStore(exec, {});
  new main.ConnPersistence(exec);
}

/** SDK 的 `RelayRoom` 建構子本身（假的 DurableObjectState，只撐起 storage）。 */
function openLikeSdk(exec: SqlExec): void {
  const kv = new Map<string, unknown>();
  const ctx = {
    storage: {
      sql: { exec: (query: string, ...bindings: (string | number | null)[]) => ({ toArray: () => exec(query, ...bindings) }) },
      get: async (key: string) => kv.get(key),
      put: async (key: string, value: unknown) => void kv.set(key, value),
      getAlarm: async () => null,
      setAlarm: async () => undefined,
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [],
  };
  new RelayRoom(ctx as unknown as DurableObjectState, {} as Env);
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

describe("錨點切到 SDK 中繼：DO SQLite 不需要遷移（ADR-0370）", () => {
  it("🔴 從零建的 schema 逐字相同（舊錨點的建構子 vs. SDK 的 RelayRoom）", () => {
    const anchor = openDb();
    openLikeAnchor(anchor.exec);
    const sdk = openDb();
    openLikeSdk(sdk.exec);
    expect(schemaOf(anchor.db).length).toBeGreaterThan(0);
    expect(schemaOf(sdk.db)).toEqual(schemaOf(anchor.db));
  });

  it("🔴 SDK 打開錨點建的 DB：不丟例外、重跑不丟例外（每次喚醒都跑）、schema 不變", () => {
    const { db, exec } = openDb();
    openLikeAnchor(exec);
    const before = schemaOf(db);
    expect(() => openLikeSdk(exec)).not.toThrow();
    expect(() => openLikeSdk(exec)).not.toThrow();
    expect(schemaOf(db)).toEqual(before);
  });

  it("🔴 錨點寫下的離線留言與可尋址事件，SDK 讀得回來", () => {
    const { exec } = openDb();
    const old = new main.SqlMessageStore(exec, {});
    for (let i = 1; i <= 3; i += 1) expect(old.put(chunk(i), NOW)).toBe(true);
    expect(old.putAddressable({ ...chunk(9), kind: 30_078, tags: [["d", "snap"]] }, NOW)).toBe(true);
    openLikeSdk(exec);
    const store = new SqlMessageStore(exec, {});
    expect(store.query({ "#p": [ALICE] }, NOW).map((e) => e.id)).toEqual(old.query({ "#p": [ALICE] }, NOW).map((e) => e.id));
    expect(store.query({ "#p": [ALICE] }, NOW)).toHaveLength(3);
    expect(store.query({ kinds: [30_078], authors: ["b".repeat(64)] }, NOW)).toHaveLength(1);
  });

  it("🔴 回滾：舊錨點的程式打開 SDK 建的 DB、讀得回 SDK 寫的列", () => {
    const { exec } = openDb();
    openLikeSdk(exec);
    const store = new SqlMessageStore(exec, {});
    for (let i = 1; i <= 2; i += 1) expect(store.put(chunk(i), NOW)).toBe(true);
    expect(() => openLikeAnchor(exec)).not.toThrow();
    const old = new main.SqlMessageStore(exec, {});
    expect(old.query({ "#p": [ALICE] }, NOW)).toHaveLength(2);
    expect(old.put(chunk(3), NOW)).toBe(true);
    expect(store.query({ "#p": [ALICE] }, NOW)).toHaveLength(3);
  });
});
