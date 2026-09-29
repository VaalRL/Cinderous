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

/**
 * 「`column` 是這些值之一」的 SQL 片段——**整個陣列只佔一個綁定參數**（ADR-0372）。
 *
 * 🔴 為什麼不是 `IN (?, ?, …)`：Durable Object 的 SQLite 每次查詢**最多 100 個綁定參數**
 * （Cloudflare 官方 Limits 頁），超過時 `sql.exec()` 直接拋例外。`relay-core.scoped()` 允許
 * `authors` 到 1024 把，`ids`／`kinds`／標籤值也沒有個別上限 ⇒ 一個 99 把作者的 REQ 就會
 * 讓查詢失敗、客戶端只收到 NOTICE「內部錯誤」、連 EOSE 都沒有。本機測試用的 node:sqlite
 * 上限是 32766，所以單元測試永遠看不出來。
 *
 * 改成把陣列序列化成**一個** JSON 字串，SQL 端用 `json_each(?)` 展開：值的數量與綁定參數
 * 脫鉤，查詢語意（IN）、排序、`LIMIT`、位元組預算全部不變，也不需要分批再在應用層合併。
 * `json_each` 本來就在用（標籤下推，ADR-0366 P1 #5），DO 上已驗證可用。
 *
 * 非陣列（惡意／錯誤的 filter）照舊拋例外——與修正前 `values.map` 拋錯的行為一致，
 * 由 `RelayCore.handle` 的例外圍籬轉成 NOTICE。
 */
function inJson(column: string, values: readonly unknown[]): { clause: string; binding: string } {
  if (!Array.isArray(values)) throw new TypeError("filter 值必須是陣列");
  return { clause: `${column} IN (SELECT value FROM json_each(?))`, binding: JSON.stringify(values) };
}

/**
 * 從 filter 取出**非 `#p`** 的標籤條件（ADR-0366 P1 #5）。
 *
 * `#p` 不在此列：它有自己的 `recipient` 欄與索引（也是配額與 NIP-62 清除的鍵），
 * 走既有那條路比多存一份重複的標籤列划算。
 */
function tagFiltersOf(filter: RelayFilter): { name: string; values: readonly string[] }[] {
  const out: { name: string; values: readonly string[] }[] = [];
  for (const key in filter) {
    if (key.charCodeAt(0) !== 35 /* '#' */ || key === "#p") continue;
    const values = filter[key as `#${string}`];
    if (values) out.push({ name: key.slice(1), values });
  }
  return out;
}

/**
 * 把標籤條件組成 SQL 的 `EXISTS(json_each(...))` 子句（ADR-0366 P1 #5）。
 *
 * ## 為什麼一定要下推，而不是留在 JS 端
 *
 * 修正前，`#t`／`#d`／`#w` 這類標籤 filter **只在 `matchFilter` 判**，而那發生在
 * `ORDER BY created_at DESC LIMIT ?` **之後**。於是「一萬顆同 kind 事件裡找某個標籤」
 * 會先取最新的 N 顆、再過濾 → **匹配不到就回空陣列**，而目標明明還在庫裡。
 * 那不是效能問題，是**正確性**問題：查詢回報「沒有」，但答案是「有，只是不在最新 N 顆裡」。
 *
 * 記憶體版（{@link MessageStore}）一直都是「先 `matchFilter` 再 limit」＝正確；
 * 兩個實作共用同一份 `OfflineStore` 契約，分歧會讓記憶體版寫的測試保證不了產線的 SQL 版。
 *
 * ## 為什麼是 `json_each` 而不是另建標籤索引表
 *
 * 索引表要在 `put`／`putAddressable`／`enforceCap`／`prune`／`vanish`／取代 這六條路徑上
 * 同步刪乾淨，漏一條就是 ADR-0065 最在意的那種孤兒列。`json_each` 是**掃描**，但它掃的是
 * **已經被 kind／pubkey／since／expiration 索引縮小過**的候選集，而每顆 DO 的資料受 7 天 TTL
 * 有界。⇒ 先把正確性補上、把代價維持有界；真的量到慢再談索引表（列為後續）。
 */
function pushTagClauses(
  table: string,
  filter: RelayFilter,
  where: string[],
  bind: (string | number)[],
): void {
  for (const { name, values } of tagFiltersOf(filter)) {
    // 每個標籤鍵固定 2 個綁定參數（名稱＋整串值），與值的數量無關（ADR-0372）。
    const vals = inJson("json_extract(tg.value, '$[1]')", values);
    where.push(
      `EXISTS (SELECT 1 FROM json_each(${table}.json, '$.tags') AS tg
               WHERE json_extract(tg.value, '$[0]') = ?
                 AND ${vals.clause})`,
    );
    bind.push(name, vals.binding);
  }
}

/** 附加一條「欄位屬於這串值」的 WHERE 子句——整串值只佔一個綁定參數（ADR-0372）。 */
const pushIn = (where: string[], bind: (string | number)[], column: string, values: readonly unknown[]): void => {
  const { clause, binding } = inJson(column, values);
  where.push(clause);
  bind.push(binding);
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
    // 每作者總量查詢用（ADR-0366 §容量二）：主鍵是 (kind, pubkey, d)，前綴是 kind，
    // 所以 `WHERE pubkey = ?` 走不到主鍵 ⇒ 沒有這個索引就是每次寫入掃全表。
    this.sql(`CREATE INDEX IF NOT EXISTS idx_addressable_pubkey ON addressable(pubkey)`);
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
      // ADR-0371 §決策 5：每列的位元組數。總量與天花板改讀這一欄（有索引），
      // 不再 `SUM(LENGTH(json))`——後者要把每一列的 json 從溢位頁讀出來（實測 260MB 約 1.4 秒）。
      `ALTER TABLE offline_msgs ADD COLUMN bytes INTEGER`,
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
    // ADR-0371 §決策 5：分桶索引——分桶修剪、`#p` 查詢與總量加總都只讀索引，不碰 json。
    //
    // 🔴 為什麼要把欄位塞進索引：`kind`／`bytes` 是後來 `ADD COLUMN` 加的，在列裡排在 json
    // **後面**。一顆檔案塊的 json 約 131KB、落在溢位頁上，讀它後面的欄位就得把整串溢位頁走完
    // ——修正前每次寫入都對該收件人的每一列這樣做（實測 1500 列約 0.4 秒）。
    // 它以 `recipient` 開頭，取代原本的 `idx_offline_recipient`（少一個索引＝每次寫入少寫一列）。
    this.sql(
      `CREATE INDEX IF NOT EXISTS idx_offline_bucket ON offline_msgs(recipient, kind, created_at, expiration, bytes)`,
    );
    this.sql(`DROP INDEX IF EXISTS idx_offline_recipient`);
    // 回填升級前的列。部分索引只收 `bytes IS NULL` 的列（新列一律有值 ⇒ 它恆為空、不增加寫入），
    // 讓這條 UPDATE 在每次喚醒時都不必掃全表。
    this.sql(`CREATE INDEX IF NOT EXISTS idx_offline_bytes_missing ON offline_msgs(id) WHERE bytes IS NULL`);
    this.sql(`UPDATE offline_msgs SET bytes = LENGTH(json) WHERE bytes IS NULL`);
  }

  /**
   * 離線留言目前佔用的位元組（快取；`undefined`＝下次用到時重算一次）。ADR-0371 §決策 5。
   *
   * 🔴 為什麼要快取：天花板每次寫入都要問「現在用了多少」。就算改讀索引，`SUM` 仍要掃過
   * **每一列**的索引項，而 Cloudflare 以「讀取列數」計費（免費層每日 500 萬列）——一顆滿載的
   * 檔案車道 DO 有數千列，上傳一個 30MB 檔（656 塊）就會把一整天的額度讀光。
   * 寫入時加、刪除時減；刪除路徑算不出確切數字的（prune、vanish）直接作廢，下次重算。
   */
  private offlineUsed: number | undefined;
  /** 每個（收件人, 桶）目前的列數（快取，理由同上）。鍵見 {@link bucketKey}。 */
  private readonly bucketCounts = new Map<string, number>();

  /** 作廢所有快取（下次用到時從索引重算）。 */
  private invalidateUsage(): void {
    this.offlineUsed = undefined;
    this.bucketCounts.clear();
  }

  private usedOfflineBytes(): number {
    if (this.offlineUsed === undefined) {
      this.offlineUsed =
        Number(this.sql(`SELECT COALESCE(SUM(bytes), 0) AS n FROM offline_msgs`)[0]?.n ?? 0) || 0;
    }
    return this.offlineUsed;
  }

  put(event: NostrEvent, nowSec: number): boolean {
    const exp = getExpiration(event);
    if (exp !== undefined && exp <= nowSec) return false;
    // ADR-0065：一律存「有效到期時間」（無標籤給預設 TTL、超長標籤截到上限）——每列壽命必有界。
    const effExp = effectiveExpiration(event, nowSec, this.opts.maxTtlSeconds);
    const recipients = recipientsOf(event);
    // 去重：重複的 `p` 標籤在表裡只會是一列（主鍵 (id, recipient)），快取也只能算一份。
    const targets = [...new Set(recipients.length > 0 ? recipients : [""])];
    const json = JSON.stringify(event);
    const size = json.length;
    // 已經存過的那幾列不再計入（`INSERT OR IGNORE` 會略過它們；快取不能把它們算兩次）。
    const present = new Set(
      this.sql(`SELECT recipient FROM offline_msgs WHERE id = ?`, event.id).map((r) => r.recipient as string),
    );
    const fresh = targets.filter((r) => !present.has(r));
    if (fresh.length === 0) return true;
    // 天花板照「列」算：每位收件人各一列（無 `p` 者一列，`recipient = ''`）。
    if (!this.fitsOfflineCeiling(size * fresh.length)) return false;
    for (const recipient of fresh) {
      this.sql(
        `INSERT OR IGNORE INTO offline_msgs (id, recipient, expiration, created_at, json, pubkey, kind, bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        recipient,
        effExp,
        event.created_at,
        json,
        event.pubkey,
        event.kind,
        size,
      );
    }
    if (this.offlineUsed !== undefined) this.offlineUsed += size * fresh.length;
    const file = event.kind === FILE_WRAP_KIND;
    for (const recipient of fresh) {
      const key = bucketKey(recipient, file);
      const count = this.bucketCounts.get(key);
      if (count !== undefined) this.bucketCounts.set(key, count + 1);
    }
    // 無條件呼叫（與記憶體版一致）：聊天桶沒設上限時 `enforceCap` 自己略過，檔案桶恆有上限。
    this.enforceCap(fresh, file);
    return true;
  }

  /** 寫入可取代／可尋址事件（取代語意＋配額；ADR-0035／0071）。行為對齊記憶體版。 */
  putAddressable(event: NostrEvent, nowSec: number): boolean {
    const d = dTagOf(event); // 可取代事件無 `d` → 空字串 → 每 (kind,pubkey) 只留一顆
    const existing = this.sql(
      `SELECT id, created_at, LENGTH(json) AS len FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`,
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
    if (json.length > (this.opts.addressableMaxBytes ?? ADDRESSABLE_MAX_BYTES)) return false;
    if (!existing[0]) {
      const count = this.sql(`SELECT COUNT(*) AS n FROM addressable WHERE kind = ? AND pubkey = ?`, event.kind, event.pubkey);
      if (((count[0]?.n as number) ?? 0) >= (this.opts.addressablePerAuthor ?? ADDRESSABLE_MAX_PER_AUTHOR)) return false;
    }
    const budget = this.opts.addressableBytesPerAuthor;
    if (budget !== undefined) {
      // 取代既有位址算**差額**：把要被取代的那一列先排除掉（行為與記憶體版逐字對齊）。
      const used = this.sql(
        `SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable
         WHERE pubkey = ? AND NOT (kind = ? AND d = ?)`,
        event.pubkey,
        event.kind,
        d,
      );
      if (((used[0]?.n as number) ?? 0) + json.length > budget) return false;
    }
    const eff = effectiveExpiration(event, nowSec, this.opts.addressableTtlSeconds ?? ADDRESSABLE_TTL_SECONDS);
    if (eff <= nowSec) return false;
    if (!this.fitsAddressableCeiling(json.length, (prev?.len as number | undefined) ?? 0)) {
      return false;
    }
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
   * 這顆 DO 還放得下這筆離線留言嗎（ADR-0367 §決策 2）。行為與記憶體版逐字對齊。
   *
   * 🔴 為什麼 FIFO 不夠：`enforceCap` 只對**真正的收件人**執行，而沒有 `p` 標籤的事件
   * 落在 `recipient = ''` ⇒ 那個桶原本只被 TTL 壓著，而遊戲的房間事件正是這個形狀。
   */
  private fitsOfflineCeiling(size: number): boolean {
    const max = this.opts.offlineMaxTotalBytes;
    if (max === undefined) return true;
    if (size > max) return false;
    let used = this.usedOfflineBytes();
    if (used + size <= max) return true;
    if (this.opts.ceilingEvicts !== true) return false;
    const victims = this.sql(
      `SELECT rowid AS r, bytes FROM offline_msgs ORDER BY expiration ASC LIMIT 256`,
    );
    for (const row of victims) {
      if (used + size <= max) break;
      this.sql(`DELETE FROM offline_msgs WHERE rowid = ?`, row.r as number);
      used -= Number(row.bytes ?? 0);
    }
    // 淘汰會跨收件人、跨桶，逐一記帳不划算（它只在撞到天花板時發生）——總量記下、分桶作廢。
    this.bucketCounts.clear();
    this.offlineUsed = used;
    return used + size <= max;
  }

  /**
   * 這顆 DO 還放得下這筆可尋址事件嗎（ADR-0367 §決策 2）。行為與記憶體版逐字對齊：
   * 車道淘汰**最快到期**者直到騰出空間；嚴格平面直接拒收。
   *
   * `replacedLen` 是**即將被取代**的那一列的長度——它會被換掉，不該算進已用空間。
   */
  private fitsAddressableCeiling(size: number, replacedLen: number): boolean {
    const max = this.opts.addressableMaxTotalBytes;
    if (max === undefined) return true;
    if (size > max) return false; // 單顆就超過：淘汰也救不了，別把整顆 DO 清空
    const total =
      (this.sql(`SELECT COALESCE(SUM(LENGTH(json)), 0) AS n FROM addressable`)[0]?.n as number) ?? 0;
    let used = total - replacedLen;
    if (used + size <= max) return true;
    if (this.opts.ceilingEvicts !== true) return false;
    // 依到期時間由近而遠淘汰。一次取一批（而非逐列查），避免極端情況下打上百次查詢。
    const victims = this.sql(
      `SELECT kind, pubkey, d, LENGTH(json) AS len FROM addressable ORDER BY expiration ASC LIMIT 256`,
    );
    for (const row of victims) {
      if (used + size <= max) break;
      this.sql(
        `DELETE FROM addressable WHERE kind = ? AND pubkey = ? AND d = ?`,
        row.kind as number,
        row.pubkey as string,
        row.d as string,
      );
      used -= (row.len as number) ?? 0;
    }
    return used + size <= max;
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
  query(filter: RelayFilter, nowSec: number, maxBytes?: number): NostrEvent[] {
    const pValues = filter["#p"];
    const { authors, ids, kinds } = filter;
    // 空陣列＝匹配不到任何事件（`matchFilter` 語意）。提前回傳，連 DB 都不用打
    // ——`{"authors":[]}` 正是最便宜的消防水管 payload。
    if ((pValues && pValues.length === 0) || (authors && authors.length === 0) || (ids && ids.length === 0)) {
      return [];
    }
    // 標籤同理：`{"#t":[]}` 匹配不到任何東西（`matchFilter` 語意），連 DB 都不用打。
    if (tagFiltersOf(filter).some((t) => t.values.length === 0)) return [];

    const where: string[] = [];
    const bind: (string | number)[] = [];
    const push = (clause: string, values: readonly (string | number)[]): void => {
      where.push(clause);
      bind.push(...values);
    };
    // 綁定參數總數與 filter 陣列的長度無關（ADR-0372）：這裡最多 9 個，加上每個標籤鍵 2 個。
    if (pValues && pValues.length > 0) pushIn(where, bind, "recipient", pValues);
    if (authors && authors.length > 0) pushIn(where, bind, "pubkey", authors);
    if (ids && ids.length > 0) pushIn(where, bind, "id", ids);
    if (kinds && kinds.length > 0) pushIn(where, bind, "kind", kinds);
    if (filter.since !== undefined) push(`created_at >= ?`, [filter.since]);
    if (filter.until !== undefined) push(`created_at <= ?`, [filter.until]);
    pushTagClauses("offline_msgs", filter, where, bind);
    where.push(`(expiration IS NULL OR expiration > ?)`);
    bind.push(nowSec);

    const limit = queryLimit(filter.limit);
    const offline = this.boundedSelect(
      "offline_msgs",
      where.join(" AND "),
      bind,
      limit,
      "COALESCE(bytes, LENGTH(json))",
      maxBytes,
    );
    let rows = offline.rows;

    // 快照（可尋址）走 authors+kinds 查詢、不帶 `#p`——它是獨立的表，同樣把條件下推＋LIMIT。
    if (!(pValues && pValues.length > 0)) {
      const aWhere: string[] = [`expiration > ?`];
      const aBind: (string | number)[] = [nowSec];
      if (authors && authors.length > 0) pushIn(aWhere, aBind, "pubkey", authors);
      if (ids && ids.length > 0) pushIn(aWhere, aBind, "id", ids);
      if (kinds && kinds.length > 0) pushIn(aWhere, aBind, "kind", kinds);
      pushTagClauses("addressable", filter, aWhere, aBind);
      const remaining = maxBytes === undefined ? undefined : maxBytes - offline.spent;
      rows = rows.concat(
        this.boundedSelect("addressable", aWhere.join(" AND "), aBind, limit, "LENGTH(json)", remaining).rows,
      );
    }

    const events = dedupById(rows.map((r) => JSON.parse(r.json as string) as NostrEvent));
    return events.filter((e) => matchFilter(filter, e)).slice(0, limit);
  }

  /**
   * 取出最新的列，但**累計大小不超過 `budget`**（ADR-0371 §決策 6）。沒給預算＝與過去相同。
   *
   * 🔴 為什麼要分兩步：`toArray()` 一次把結果全部搬進記憶體，而 DO 的記憶體上限是 128MB。
   * 一位收件人名下的檔案塊可能有上千顆、每顆約 131KB——一次 REQ 就是上百 MB，DO 當場重置。
   * 先只讀大小（分桶索引上就有）算出放得下幾列，再取那幾列的 json。
   * 排序多一個 `rowid` 當決勝，兩步才保證挑中的是同一批列。
   */
  private boundedSelect(
    table: string,
    where: string,
    bind: (string | number)[],
    limit: number,
    sizeExpr: string,
    budget: number | undefined,
  ): { rows: Record<string, unknown>[]; spent: number } {
    const order = "ORDER BY created_at DESC, rowid DESC";
    if (budget === undefined) {
      return { rows: this.sql(`SELECT json FROM ${table} WHERE ${where} ${order} LIMIT ?`, ...bind, limit), spent: 0 };
    }
    const sizes = this.sql(`SELECT ${sizeExpr} AS n FROM ${table} WHERE ${where} ${order} LIMIT ?`, ...bind, limit);
    let take = 0;
    let spent = 0;
    for (const row of sizes) {
      const n = Number(row.n ?? 0);
      if (spent + n > budget) break;
      spent += n;
      take += 1;
    }
    if (take === 0) return { rows: [], spent: 0 };
    return { rows: this.sql(`SELECT json FROM ${table} WHERE ${where} ${order} LIMIT ?`, ...bind, take), spent };
  }

  prune(nowSec: number): void {
    this.invalidateUsage();
    this.sql(`DELETE FROM offline_msgs WHERE expiration IS NOT NULL AND expiration <= ?`, nowSec);
    this.sql(`DELETE FROM addressable WHERE expiration <= ?`, nowSec);
  }

  /**
   * NIP-62 清除（ADR-0260）：`pubkey = ?`（他發的）**或** `recipient = ?`（寄給他的
   * ——Gift Wrap 外層是一次性金鑰，`p` 是唯一能定位收件匣的鍵），外加他的可尋址事件。
   *
   * 兩欄都有索引（`idx_offline_pubkey`／`idx_offline_bucket` 的 recipient 前綴），故不是全表掃描。
   */
  vanish(pubkey: string, _nowSec: number): number {
    const rows = this.sql(
      `SELECT COUNT(DISTINCT id) AS n FROM offline_msgs WHERE pubkey = ? OR recipient = ?`,
      pubkey,
      pubkey,
    );
    const msgs = Number(rows[0]?.n ?? 0);
    const addr = Number(
      this.sql(`SELECT COUNT(*) AS n FROM addressable WHERE pubkey = ?`, pubkey)[0]?.n ?? 0,
    );
    this.invalidateUsage();
    this.sql(`DELETE FROM offline_msgs WHERE pubkey = ? OR recipient = ?`, pubkey, pubkey);
    this.sql(`DELETE FROM addressable WHERE pubkey = ?`, pubkey);
    return msgs + addr;
  }

  /**
   * 分桶修剪（ADR-0162：檔案塊與聊天留言各自計數、各自由舊到新丟棄）。
   *
   * 只修剪**這次寫入落到的那一桶**：另一桶的列數沒變，不需要看（修正前兩桶每次都掃）。
   * 列數走快取，只有超量時才讀出要刪的那幾列——而且只讀 `idx_offline_bucket` 的索引項。
   */
  private enforceCap(recipients: string[], file: boolean): void {
    const limit = file
      ? (this.opts.filePerRecipient ?? DEFAULT_FILE_PER_RECIPIENT)
      : this.opts.maxPerRecipient;
    if (limit === undefined) return;
    const bucket = file ? `kind = ${FILE_WRAP_KIND}` : `kind != ${FILE_WRAP_KIND}`;
    for (const recipient of recipients) {
      if (recipient === "") continue; // 無收件人的桶不做 FIFO（由天花板與 TTL 管）
      const key = bucketKey(recipient, file);
      let count = this.bucketCounts.get(key);
      if (count === undefined) {
        count = Number(
          this.sql(`SELECT COUNT(*) AS n FROM offline_msgs WHERE recipient = ? AND ${bucket}`, recipient)[0]?.n ?? 0,
        );
      }
      if (count > limit) {
        const rows = this.sql(
          `SELECT rowid AS r, bytes FROM offline_msgs WHERE recipient = ? AND ${bucket}
           ORDER BY created_at ASC LIMIT ?`,
          recipient,
          count - limit,
        );
        for (const row of rows) {
          this.sql(`DELETE FROM offline_msgs WHERE rowid = ?`, row.r as number);
          if (this.offlineUsed !== undefined) this.offlineUsed -= Number(row.bytes ?? 0);
        }
        count -= rows.length;
      }
      this.bucketCounts.set(key, count);
    }
  }
}

/** 分桶快取的鍵：收件人 ＋ 桶別（檔案塊／其他）。 */
function bucketKey(recipient: string, file: boolean): string {
  return `${file ? "f" : "c"}:${recipient}`;
}
