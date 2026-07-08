import type { NostrEvent } from "@cinder/core";
import { matchFilter } from "./filters.js";
import {
  dedupById,
  getExpiration,
  type MessageStoreOptions,
  type OfflineStore,
  recipientsOf,
} from "./message-store.js";
import type { RelayFilter } from "./protocol.js";

/**
 * 最小同步 SQL 執行介面（ADR-0056）。產線包 Durable Object 的 `ctx.storage.sql.exec()`
 * （同步）；測試以 `node:sqlite` 包出真 SQLite。回傳每列為欄名→值的物件陣列。
 */
export type SqlExec = (query: string, ...bindings: (string | number | null)[]) => Record<string, unknown>[];

/**
 * 離線留言持久層的 SQL 版（ADR-0056）：以 DO 內建 SQLite 落地，行為對齊記憶體版
 * {@link MessageStore}（NIP-40 過期、每收件人配額、`#p` 索引），但同步、可持久。
 *
 * schema：每個 `p` 標籤一列（`(id, recipient)` 為主鍵）；無 `p` 者以 `recipient=''` 存。
 */
export class SqlMessageStore implements OfflineStore {
  constructor(
    private readonly sql: SqlExec,
    private readonly opts: MessageStoreOptions = {},
  ) {
    this.sql(
      `CREATE TABLE IF NOT EXISTS offline_msgs (
        id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        expiration INTEGER,
        created_at INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (id, recipient)
      )`,
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_recipient ON offline_msgs(recipient)`);
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_expiration ON offline_msgs(expiration)`);
  }

  put(event: NostrEvent, nowSec: number): boolean {
    const exp = getExpiration(event);
    if (exp !== undefined && exp <= nowSec) return false;
    const recipients = recipientsOf(event);
    const targets = recipients.length > 0 ? recipients : [""];
    const json = JSON.stringify(event);
    for (const recipient of targets) {
      this.sql(
        `INSERT OR IGNORE INTO offline_msgs (id, recipient, expiration, created_at, json) VALUES (?, ?, ?, ?, ?)`,
        event.id,
        recipient,
        exp ?? null,
        event.created_at,
        json,
      );
    }
    if (this.opts.maxPerRecipient !== undefined) this.enforceCap(targets);
    return true;
  }

  query(filter: RelayFilter, nowSec: number): NostrEvent[] {
    const pValues = filter["#p"];
    let rows: Record<string, unknown>[];
    if (pValues && pValues.length > 0) {
      const placeholders = pValues.map(() => "?").join(",");
      rows = this.sql(
        `SELECT json FROM offline_msgs WHERE recipient IN (${placeholders}) AND (expiration IS NULL OR expiration > ?)`,
        ...pValues,
        nowSec,
      );
    } else {
      rows = this.sql(`SELECT json FROM offline_msgs WHERE (expiration IS NULL OR expiration > ?)`, nowSec);
    }
    const events = dedupById(rows.map((r) => JSON.parse(r.json as string) as NostrEvent));
    return events.filter((e) => matchFilter(filter, e));
  }

  prune(nowSec: number): void {
    this.sql(`DELETE FROM offline_msgs WHERE expiration IS NOT NULL AND expiration <= ?`, nowSec);
  }

  private enforceCap(recipients: string[]): void {
    const cap = this.opts.maxPerRecipient;
    if (cap === undefined) return;
    for (const recipient of recipients) {
      const rows = this.sql(
        `SELECT id FROM offline_msgs WHERE recipient = ? ORDER BY created_at ASC`,
        recipient,
      );
      if (rows.length <= cap) continue;
      for (const row of rows.slice(0, rows.length - cap)) {
        this.sql(`DELETE FROM offline_msgs WHERE recipient = ? AND id = ?`, recipient, row.id as string);
      }
    }
  }
}
