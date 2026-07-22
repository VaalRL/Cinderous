import type { NostrEvent } from "@cinderous/core";
import { matchFilter } from "./filters.js";
import {
  ADDRESSABLE_MAX_BYTES,
  ADDRESSABLE_MAX_PER_AUTHOR,
  ADDRESSABLE_TTL_SECONDS,
  DEFAULT_FILE_PER_RECIPIENT,
  DEFAULT_MAX_TTL_SECONDS,
  dedupById,
  FILE_WRAP_KIND,
  dTagOf,
  effectiveExpiration,
  getExpiration,
  MAX_QUERY_ROWS,
  type MessageStoreOptions,
  type OfflineStore,
  queryLimit,
  recipientsOf,
  shouldReplace,
} from "./message-store.js";
import type { RelayFilter } from "./protocol.js";

/**
 * 最小同步 SQL 執行介面（ADR-0056）。產線包 Durable Object 的 `ctx.storage.sql.exec()`
 * （同步）；測試以 `node:sqlite` 包出真 SQLite。回傳每列為欄名→值的物件陣列。
 */
export type SqlExec = (query: string, ...bindings: (string | number | null)[]) => Record<string, unknown>[];

/** 把值陣列轉成 `IN (?,?,…)` 佔位字串。 */
const placeholders = (values: readonly unknown[]): string => values.map(() => "?").join(",");

/** 附加一條 WHERE 子句與其繫結值。 */
const push2 = (where: string[], bind: (string | number)[], clause: string, values: readonly (string | number)[]): void => {
  where.push(clause);
  bind.push(...values);
};


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
    // ADR-0235 C2 遷移：新增 `pubkey`／`kind` 欄與索引，讓 authors/kinds 過濾能下推到 SQL。
    // 舊 DB 沒有這兩欄；`ADD COLUMN` 已存在時會拋，吞掉即可（等冪）。回填由 json 抽出。
    for (const ddl of [
      `ALTER TABLE offline_msgs ADD COLUMN pubkey TEXT`,
      `ALTER TABLE offline_msgs ADD COLUMN kind INTEGER`,
    ]) {
      try {
        this.sql(ddl);
      } catch {
        /* 欄位已存在 */
      }
    }
    this.sql(
      `UPDATE offline_msgs SET pubkey = json_extract(json, '$.pubkey'), kind = json_extract(json, '$.kind')
       WHERE pubkey IS NULL OR kind IS NULL`,
    );
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_pubkey ON offline_msgs(pubkey)`);
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_kind ON offline_msgs(kind)`);
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
        `INSERT OR IGNORE INTO offline_msgs (id, recipient, expiration, created_at, json, pubkey, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        recipient,
        effExp,
        event.created_at,
        json,
        event.pubkey,
        event.kind,
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

  /**
   * 查詢符合 filter 且未過期的留言。
   *
   * ## 為什麼過濾條件必須下推到 SQL（ADR-0235 C2）
   *
   * 修正前，沒有 `#p` 的 filter 會走
   * `SELECT json FROM offline_msgs WHERE expiration > ?`——**整張表**（所有使用者的離線留言）
   * 撈進記憶體、逐筆 `JSON.parse`，再於 JS 端 `matchFilter` 過濾。
   *
   * 而 `relay-core` 的 `scoped()` 明文允許「沒有 `#p`、但有 `authors`」的訂閱（ADR-0071 的
   * 快照查詢正是這個形狀），連 `authors: []` 都放行——它匹配不到任何事件，卻會完整跑一次
   * 全表掃描。也就是說 `{"authors":[]}` 是一個**零成本、零收穫、全代價**的 payload。
   * Durable Object 記憶體上限 128MB，而這是**單一全域房間**：重複送幾次就 OOM，全站掉線。
   *
   * 現在 `#p`／`authors`／`ids`／`kinds`／`since`／`until` 全部進 WHERE（有索引），並一律帶
   * `LIMIT`。`matchFilter` 仍是最終權威（`#e` 等標籤 filter 只能在 JS 判），但它現在跑在
   * **有界且已縮小**的候選集上。
   *
   * 「訂閱必須具名」則**不**在這一層——那是 `relay-core.scoped()` 的職責（ADR-0123）。
   * 儲存層若也擋，會讓「Ephemeral 不入庫」這類**否定斷言**變成恆真的空轉測試。
   * 這裡只負責一件事：**任何查詢的代價都有界**。
   */
  query(filter: RelayFilter, nowSec: number): NostrEvent[] {
    const pValues = filter["#p"];
    const { authors, ids, kinds } = filter;
    // 空陣列＝匹配不到任何事件（`matchFilter` 語意）。提前回傳，連 DB 都不用打
    // ——`{"authors":[]}` 正是最便宜的消防水管 payload。
    if ((pValues && pValues.length === 0) || (authors && authors.length === 0) || (ids && ids.length === 0)) {
      return [];
    }

    const where: string[] = [];
    const bind: (string | number)[] = [];
    const push = (clause: string, values: readonly (string | number)[]): void => {
      where.push(clause);
      bind.push(...values);
    };
    if (pValues && pValues.length > 0) push(`recipient IN (${placeholders(pValues)})`, pValues);
    if (authors && authors.length > 0) push(`pubkey IN (${placeholders(authors)})`, authors);
    if (ids && ids.length > 0) push(`id IN (${placeholders(ids)})`, ids);
    if (kinds && kinds.length > 0) push(`kind IN (${placeholders(kinds)})`, kinds);
    if (filter.since !== undefined) push(`created_at >= ?`, [filter.since]);
    if (filter.until !== undefined) push(`created_at <= ?`, [filter.until]);
    where.push(`(expiration IS NULL OR expiration > ?)`);
    bind.push(nowSec);

    const limit = queryLimit(filter.limit);
    let rows = this.sql(
      `SELECT json FROM offline_msgs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      ...bind,
      limit,
    );

    // 快照（可尋址）走 authors+kinds 查詢、不帶 `#p`——它是獨立的表，同樣把條件下推＋LIMIT。
    if (!(pValues && pValues.length > 0)) {
      const aWhere: string[] = [`expiration > ?`];
      const aBind: (string | number)[] = [nowSec];
      if (authors && authors.length > 0) push2(aWhere, aBind, `pubkey IN (${placeholders(authors)})`, authors);
      if (ids && ids.length > 0) push2(aWhere, aBind, `id IN (${placeholders(ids)})`, ids);
      if (kinds && kinds.length > 0) push2(aWhere, aBind, `kind IN (${placeholders(kinds)})`, kinds);
      rows = rows.concat(
        this.sql(
          `SELECT json FROM addressable WHERE ${aWhere.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
          ...aBind,
          limit,
        ),
      );
    }

    const events = dedupById(rows.map((r) => JSON.parse(r.json as string) as NostrEvent));
    return events.filter((e) => matchFilter(filter, e)).slice(0, limit);
  }

  prune(nowSec: number): void {
    this.sql(`DELETE FROM offline_msgs WHERE expiration IS NOT NULL AND expiration <= ?`, nowSec);
    this.sql(`DELETE FROM addressable WHERE expiration <= ?`, nowSec);
  }

  private enforceCap(recipients: string[]): void {
    const cap = this.opts.maxPerRecipient;
    const fileCap = this.opts.filePerRecipient ?? DEFAULT_FILE_PER_RECIPIENT;
    for (const recipient of recipients) {
      // ADR-0162：檔案塊（1060）與聊天留言分桶計數（kind 以 json_extract 取，免 schema 遷移）。
      const trim = (where: string, limit: number): void => {
        const rows = this.sql(
          `SELECT id FROM offline_msgs WHERE recipient = ? AND ${where} ORDER BY created_at ASC`,
          recipient,
        );
        if (rows.length <= limit) return;
        for (const row of rows.slice(0, rows.length - limit)) {
          this.sql(`DELETE FROM offline_msgs WHERE recipient = ? AND id = ?`, recipient, row.id as string);
        }
      };
      if (cap !== undefined) trim(`json_extract(json, '$.kind') != ${FILE_WRAP_KIND}`, cap);
      trim(`json_extract(json, '$.kind') = ${FILE_WRAP_KIND}`, fileCap);
    }
  }
}
