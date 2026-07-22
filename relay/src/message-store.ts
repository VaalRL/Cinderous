import type { NostrEvent } from "@cinderous/core";
import { matchFilter } from "./filters.js";
import type { RelayFilter } from "./protocol.js";

/** 讀取事件的 NIP-40 過期時間（unix 秒）；無或非法時回 undefined。 */
export function getExpiration(event: NostrEvent): number | undefined {
  const tag = event.tags.find((t) => t[0] === "expiration");
  if (!tag || tag[1] === undefined) return undefined;
  const seconds = Number(tag[1]);
  return Number.isFinite(seconds) ? seconds : undefined;
}

export interface MessageStoreOptions {
  /** 每位收件人（`p` 標籤）保留的最大留言數，超量丟棄最舊。 */
  maxPerRecipient?: number;
  /**
   * 檔案塊（FILE_WRAP=1060，ADR-0162）每收件人配額——與聊天留言**分桶**，
   * 檔案塊絕不把聊天訊息擠出 FIFO。預設 {@link DEFAULT_FILE_PER_RECIPIENT}。
   */
  filePerRecipient?: number;
  /**
   * 留言壽命上限（秒；預設 7 天）。無 `expiration` 標籤的事件以此為預設 TTL、
   * 有標籤者也不得超過此上限——任何一列的壽命都有界，孤兒資料在數學上不可能（ADR-0065）。
   */
  maxTtlSeconds?: number;
}

/** 預設留言壽命上限：7 天（對齊 client 端 gift wrap 的預設 TTL）。 */
export const DEFAULT_MAX_TTL_SECONDS = 7 * 86_400;

/**
 * 單次查詢的回傳筆數硬上限（ADR-0235 C2）。客戶端每收件人最多 500 則
 * （`MAX_PER_RECIPIENT`），1024 已是兩倍餘裕。**這是把「一次 REQ 撈爆 DO 記憶體」
 * 變成不可能的那一行**——`OfflineStore` 的兩個實作都必須遵守。
 */
export const MAX_QUERY_ROWS = 1024;

/** 有效筆數上限：尊重 `filter.limit`（NIP-01），但一律夾在 {@link MAX_QUERY_ROWS} 之內。 */
export function queryLimit(requested?: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return MAX_QUERY_ROWS;
  return Math.min(Math.floor(requested), MAX_QUERY_ROWS);
}

/** 檔案塊外層 kind（ADR-0162）；**必須鏡射 core `KIND.FILE_WRAP`**（relay 不依賴 core runtime）。 */
export const FILE_WRAP_KIND = 1060;
/** 檔案塊每收件人預設配額（≈500MB 密文；企業站自己的儲存自己決策）。 */
export const DEFAULT_FILE_PER_RECIPIENT = 4000;
/** 單顆檔案塊事件的大小 sanity 上限（48KB 明文 ×2 膨脹之上留餘裕）。 */
export const FILE_EVENT_MAX_BYTES = 200_000;

/**
 * 有效到期時間（ADR-0065）：`min(標籤值, now + 上限)`；無標籤即 `now + 上限`。
 * 防兩種永存縫隙：無 expiration 的事件、以及惡意超長 expiration。
 */
export function effectiveExpiration(event: NostrEvent, nowSec: number, maxTtlSeconds = DEFAULT_MAX_TTL_SECONDS): number {
  const cap = nowSec + maxTtlSeconds;
  const tagged = getExpiration(event);
  return tagged === undefined ? cap : Math.min(tagged, cap);
}

// ── 可取代／可尋址事件（取代語意；ADR-0035／0071） ─────────────────────────

/** NIP-33 可尋址範圍：每 (kind, pubkey, d) 只保留最新一顆（取代語意）。 */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/**
 * NIP-01 可取代範圍（ADR-0035）：kind 0／3／10000–19999——每 (kind, pubkey) 只保留最新一顆。
 *
 * Cinderous 用到：`RELAY_LIST_KIND`(10037)、`ORG_ROSTER_KIND`(10038)、`NODE_ATTEST_KIND`(10039)。
 * 過去這些走一般 `put` 而**不斷累積**：health-check cron 每小時發佈一次簽章清單，7 天 TTL 內
 * 就囤了上百份重複——客戶端每次連線都得全部下載一遍。
 */
export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}

/**
 * 需要「取代語意」的事件（可取代 ∪ 可尋址）。
 *
 * 實作上兩者共用同一條路徑：**NIP-01 的可取代 ≡ `d` 為空字串的可尋址**——`dTagOf` 對沒有
 * `d` 標籤的事件正好回空字串，故 key `(kind, pubkey, "")` 天然就是「每 (kind, pubkey) 一顆」。
 */
export function isReplaceableOrAddressable(kind: number): boolean {
  return isReplaceableKind(kind) || isAddressableKind(kind);
}

/** 事件的 `d` 標籤（可尋址事件的位址元件）；無則空字串（＝NIP-01 可取代事件的隱含位址）。 */
export function dTagOf(event: NostrEvent): string {
  return event.tags.find((t) => t[0] === "d")?.[1] ?? "";
}

/**
 * 新事件是否應**取代**既有那顆（NIP-01）：較新者勝；`created_at` 相同時**保留 id 字典序較小者**
 * ——這是 NIP-01 指定的決勝規則，確保所有中繼站對同一組事件收斂到**同一顆**。
 */
export function shouldReplace(existing: NostrEvent, incoming: NostrEvent): boolean {
  if (incoming.created_at !== existing.created_at) return incoming.created_at > existing.created_at;
  return incoming.id < existing.id;
}

/** 單顆可尋址事件上限（序列化後字元數；ADR-0071 快照 256KB）。 */
export const ADDRESSABLE_MAX_BYTES = 262_144;
/** 每 (pubkey, kind) 的位址（d 值）數上限（ADR-0071：每人 5 台裝置）。 */
export const ADDRESSABLE_MAX_PER_AUTHOR = 5;
/** 可尋址事件壽命上限：30 天、每次備份刷新——活躍者永不過期、棄用帳號自動回收（ADR-0071）。 */
export const ADDRESSABLE_TTL_SECONDS = 30 * 86_400;

/**
 * 離線留言持久層的行為契約（ADR-0056）。記憶體版（{@link MessageStore}）與
 * Worker 端 DO SQLite 版（`SqlMessageStore`）皆實作，`RelayCore` 依此介面接。
 */
export interface OfflineStore {
  /** 寫入一筆留言；已過期則拒絕並回 false。 */
  put(event: NostrEvent, nowSec: number): boolean;
  /**
   * 寫入可尋址事件（ADR-0071）：以 (kind, pubkey, d) 取代舊顆、只留 created_at 最新；
   * `content === ""` ＝刪除既有（purge）。較舊、超額（大小/位址數）或已過期回 false。
   */
  putAddressable(event: NostrEvent, nowSec: number): boolean;
  /** 查詢符合 filter 且未過期的留言。 */
  query(filter: RelayFilter, nowSec: number): NostrEvent[];
  /** 清除所有已過期留言。 */
  prune(nowSec: number): void;
}

/** 取事件的收件人（`p` 標籤值）清單；供記憶體與 SQL 版共用。 */
export function recipientsOf(event: NostrEvent): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "p" && tag[1] !== undefined) out.push(tag[1]);
  }
  return out;
}

/** 以 event id 去重（保留首次出現）；供記憶體與 SQL 版共用。 */
export function dedupById(events: NostrEvent[]): NostrEvent[] {
  const seen = new Set<string>();
  const out: NostrEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

/**
 * 離線留言的持久化行為（NIP-40 過期、每收件人配額）。
 *
 * 以收件人（`p` 標籤）為索引：NIP-17 私訊查詢一律帶 `#p`，因此常見路徑
 * 只掃該收件人的留言而非全體（O(該收件人) 而非 O(全部)）。無 `p` 標籤的
 * 事件與不帶 `#p` 的查詢走全掃備援。Worker 端接 D1 時應比照以
 * `p_tag`/`expiration` 建索引。
 */
export class MessageStore implements OfflineStore {
  /** 收件人 pubkey → 該收件人的留言。 */
  private readonly byRecipient = new Map<string, NostrEvent[]>();
  /** 無 `p` 標籤的事件。 */
  private noRecipient: NostrEvent[] = [];
  /** event id → 有效到期時間（ADR-0065：每列壽命必有界）。 */
  private readonly effExp = new Map<string, number>();
  /** 可尋址事件（ADR-0071）：`kind\0pubkey\0d` → 最新一顆。 */
  private readonly addressable = new Map<string, NostrEvent>();

  constructor(private readonly opts: MessageStoreOptions = {}) {}

  /** 寫入可取代／可尋址事件（取代語意＋配額；ADR-0035／0071）。可取代事件無 `d` → 每 (kind,pubkey) 一顆。 */
  putAddressable(event: NostrEvent, nowSec: number): boolean {
    const prefix = `${event.kind}\0${event.pubkey}\0`;
    const key = prefix + dTagOf(event);
    const existing = this.addressable.get(key);
    if (existing && !shouldReplace(existing, event)) return false; // 較舊（或同時但 id 較大）→ 不取代
    if (event.content === "") {
      // purge：關閉備份時「已關閉」必須立即為真（ADR-0071）。
      if (existing) {
        this.addressable.delete(key);
        this.effExp.delete(existing.id);
      }
      return true;
    }
    if (JSON.stringify(event).length > ADDRESSABLE_MAX_BYTES) return false;
    if (!existing) {
      let count = 0;
      for (const k of this.addressable.keys()) if (k.startsWith(prefix)) count++;
      if (count >= ADDRESSABLE_MAX_PER_AUTHOR) return false;
    }
    const eff = effectiveExpiration(event, nowSec, ADDRESSABLE_TTL_SECONDS);
    if (eff <= nowSec) return false;
    if (existing) this.effExp.delete(existing.id);
    this.addressable.set(key, event);
    this.effExp.set(event.id, eff);
    return true;
  }

  /** 寫入一筆留言；若已過期則拒絕並回 false。 */
  put(event: NostrEvent, nowSec: number): boolean {
    if (this.isExpired(event, nowSec)) return false;
    this.effExp.set(event.id, effectiveExpiration(event, nowSec, this.opts.maxTtlSeconds));
    const recipients = recipientsOf(event);
    if (recipients.length === 0) {
      this.noRecipient.push(event);
      return true;
    }
    for (const recipient of recipients) {
      const bucket = this.byRecipient.get(recipient) ?? [];
      bucket.push(event);
      this.byRecipient.set(recipient, bucket);
    }
    this.enforceCap(recipients);
    return true;
  }

  /**
   * 查詢符合 filter 且未過期的留言。
   *
   * 回傳筆數與 SQL 版一樣有界（ADR-0235 C2）——兩個實作共用同一份 `OfflineStore` 契約，
   * 行為分歧會讓「用記憶體版寫的測試」保證不了產線的 SQL 版。
   */
  query(filter: RelayFilter, nowSec: number): NostrEvent[] {
    const candidates = this.candidatesFor(filter);
    const hit = candidates.filter((e) => !this.isExpired(e, nowSec) && matchFilter(filter, e));
    const limit = queryLimit(filter.limit);
    if (hit.length <= limit) return hit;
    // 超量時取**最新**的（與 SQL 版的 `ORDER BY created_at DESC LIMIT ?` 一致）。
    return [...hit].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  }

  /** 清除所有已過期留言。 */
  prune(nowSec: number): void {
    const survivors = new Set<string>();
    for (const [recipient, bucket] of this.byRecipient) {
      const kept = bucket.filter((e) => !this.isExpired(e, nowSec));
      if (kept.length > 0) this.byRecipient.set(recipient, kept);
      else this.byRecipient.delete(recipient);
      for (const e of kept) survivors.add(e.id);
    }
    this.noRecipient = this.noRecipient.filter((e) => !this.isExpired(e, nowSec));
    for (const e of this.noRecipient) survivors.add(e.id);
    // 可尋址事件（ADR-0071）：過期即回收（棄用帳號的快照空間自動釋放）
    for (const [key, e] of this.addressable) {
      if (this.isExpired(e, nowSec)) this.addressable.delete(key);
      else survivors.add(e.id);
    }
    // 同步清 effExp（避免 id → 到期時間的殘留成為另一種孤兒）
    for (const id of this.effExp.keys()) {
      if (!survivors.has(id)) this.effExp.delete(id);
    }
  }

  /** 依 filter 縮小候選集合：帶 `#p` 時僅取相關收件人桶，否則全掃。 */
  private candidatesFor(filter: RelayFilter): NostrEvent[] {
    const pValues = filter["#p"];
    if (pValues && pValues.length > 0) {
      return dedupById(pValues.flatMap((r) => this.byRecipient.get(r) ?? []));
    }
    return this.allEvents();
  }

  private allEvents(): NostrEvent[] {
    const all: NostrEvent[] = [];
    for (const bucket of this.byRecipient.values()) all.push(...bucket);
    all.push(...this.noRecipient);
    all.push(...this.addressable.values()); // 快照走 authors+kinds 查詢（無 `#p`）
    return dedupById(all);
  }

  private isExpired(event: NostrEvent, nowSec: number): boolean {
    const exp = this.effExp.get(event.id) ?? getExpiration(event);
    return exp !== undefined && exp <= nowSec;
  }

  private enforceCap(recipients: string[]): void {
    const cap = this.opts.maxPerRecipient;
    const fileCap = this.opts.filePerRecipient ?? DEFAULT_FILE_PER_RECIPIENT;
    for (const recipient of recipients) {
      const bucket = this.byRecipient.get(recipient);
      if (!bucket) continue;
      // ADR-0162：檔案塊（1060）與聊天留言**分桶計數**——由新到舊各自保留至上限。
      const sorted = [...bucket].sort((a, b) => a.created_at - b.created_at);
      const keptReversed: NostrEvent[] = [];
      let chat = 0;
      let file = 0;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const e = sorted[i]!;
        if (e.kind === FILE_WRAP_KIND) {
          if (file >= fileCap) continue;
          file++;
        } else if (cap !== undefined) {
          if (chat >= cap) continue;
          chat++;
        }
        keptReversed.push(e);
      }
      this.byRecipient.set(recipient, keptReversed.reverse());
    }
  }
}
