import type { NostrEvent } from "@cinder/core";
import { matchFilter } from "./filters.js";
import {
  ADDRESSABLE_MAX_BYTES,
  ADDRESSABLE_MAX_PER_AUTHOR,
  ADDRESSABLE_TTL_SECONDS,
  DEFAULT_MAX_TTL_SECONDS,
  dedupById,
  dTagOf,
  effectiveExpiration,
  getExpiration,
  type MessageStoreOptions,
  type OfflineStore,
  recipientsOf,
  shouldReplace,
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
    // 可尋址事件（NIP-33，ADR-0071 快照）：每 (kind, pubkey, d) 一列、新的取代舊的。
    this.sql(
      `CREATE TABLE IF NOT EXISTS addressable (
        kind INTEGER NOT NULL,
        pubkey TEXT NOT NULL,
        d TEXT NOT NULL,
        id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expiration INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (kind, pubkey, d)
      )`,
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_addressable_expiration ON addressable(expiration)`);
    // ADR-0065 遷移：修正前寫入的無到期列（NULL）補上有界壽命，讓 prune 能收走。
    this.sql(
      `UPDATE offline_msgs SET expiration = created_at + ? WHERE expiration IS NULL`,
      opts.maxTtlSeconds ?? DEFAULT_MAX_TTL_SECONDS,
    );
  }

  put(event: NostrEvent, nowSec: number): boolean {
    const exp = getExpiration(event);
    if (exp !== undefined && exp <= nowSec) return false;
    // ADR-0065：一律存「有效到期時間」（無標籤給預設 TTL、超長標籤截到上限）——每列壽命必有界。
    const effExp = effectiveExpiration(event, nowSec, this.opts.maxTtlSeconds);
    const recipients = recipientsOf(event);
    const targets = recipients.length > 0 ? recipients : [""];
    const json = JSON.stringify(event);
    for (const recipient of targets) {
      this.sql(
        `INSERT OR IGNORE INTO offline_msgs (id, recipient, expiration, created_at, json) VALUES (?, ?, ?, ?, ?)`,
        event.id,
        recipient,
        effExp,
        event.created_at,
        json,
      );
    }
    if (this.opts.maxPerRecipient !== undefined) this.enforceCap(targets);
    return true;
  }

  /** 寫入可取代／可尋址事件（取代語意＋配額；ADR-0035／0071）。行為對齊記憶體版。 */
  putAddressable(event: NostrEvent, nowSec: number): boolean {
    const d = dTagOf(event); // 可取代事件無 `d` → 空字串 → 每 (kind,pubkey) 只留一顆
    const existing = this.sql(
      `SELECT id, created_at FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`,
      event.kind,
      event.pubkey,
      d,
    );
    const prev = existing[0];
    if (prev) {
      // NIP-01 決勝：較新者勝；同時則保留 id 字典序較小者（各中繼站收斂到同一顆）。
      const prevEvent = { id: prev.id as string, created_at: prev.created_at as number } as NostrEvent;
      if (!shouldReplace(prevEvent, event)) return false;
    }
    if (event.content === "") {
      // purge：關閉備份時「已關閉」必須立即為真（ADR-0071）。
      this.sql(`DELETE FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`, event.kind, event.pubkey, d);
      return true;
    }
    const json = JSON.stringify(event);
    if (json.length > ADDRESSABLE_MAX_BYTES) return false;
    if (!existing[0]) {
      const count = this.sql(`SELECT COUNT(*) AS n FROM addressable WHERE kind = ? AND pubkey = ?`, event.kind, event.pubkey);
      if (((count[0]?.n as number) ?? 0) >= ADDRESSABLE_MAX_PER_AUTHOR) return false;
    }
    const eff = effectiveExpiration(event, nowSec, ADDRESSABLE_TTL_SECONDS);
    if (eff <= nowSec) return false;
    this.sql(
      `INSERT OR REPLACE INTO addressable (kind, pubkey, d, id, created_at, expiration, json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.kind,
      event.pubkey,
      d,
      event.id,
      event.created_at,
      eff,
      json,
    );
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
      // 快照走 authors+kinds 查詢（無 `#p`）：可尋址列一併納入候選。
      rows = rows.concat(this.sql(`SELECT json FROM addressable WHERE expiration > ?`, nowSec));
    }
    const events = dedupById(rows.map((r) => JSON.parse(r.json as string) as NostrEvent));
    return events.filter((e) => matchFilter(filter, e));
  }

  prune(nowSec: number): void {
    this.sql(`DELETE FROM offline_msgs WHERE expiration IS NOT NULL AND expiration <= ?`, nowSec);
    this.sql(`DELETE FROM addressable WHERE expiration <= ?`, nowSec);
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
