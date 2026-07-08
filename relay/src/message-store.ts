import type { NostrEvent } from "@cinder/core";
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
}

/**
 * 離線留言持久層的行為契約（ADR-0056）。記憶體版（{@link MessageStore}）與
 * Worker 端 DO SQLite 版（`SqlMessageStore`）皆實作，`RelayCore` 依此介面接。
 */
export interface OfflineStore {
  /** 寫入一筆留言；已過期則拒絕並回 false。 */
  put(event: NostrEvent, nowSec: number): boolean;
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

  constructor(private readonly opts: MessageStoreOptions = {}) {}

  /** 寫入一筆留言；若已過期則拒絕並回 false。 */
  put(event: NostrEvent, nowSec: number): boolean {
    if (this.isExpired(event, nowSec)) return false;
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

  /** 查詢符合 filter 且未過期的留言。 */
  query(filter: RelayFilter, nowSec: number): NostrEvent[] {
    const candidates = this.candidatesFor(filter);
    return candidates.filter((e) => !this.isExpired(e, nowSec) && matchFilter(filter, e));
  }

  /** 清除所有已過期留言。 */
  prune(nowSec: number): void {
    for (const [recipient, bucket] of this.byRecipient) {
      const kept = bucket.filter((e) => !this.isExpired(e, nowSec));
      if (kept.length > 0) this.byRecipient.set(recipient, kept);
      else this.byRecipient.delete(recipient);
    }
    this.noRecipient = this.noRecipient.filter((e) => !this.isExpired(e, nowSec));
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
    return dedupById(all);
  }

  private isExpired(event: NostrEvent, nowSec: number): boolean {
    const exp = getExpiration(event);
    return exp !== undefined && exp <= nowSec;
  }

  private enforceCap(recipients: string[]): void {
    const cap = this.opts.maxPerRecipient;
    if (cap === undefined) return;
    for (const recipient of recipients) {
      const bucket = this.byRecipient.get(recipient);
      if (!bucket || bucket.length <= cap) continue;
      bucket.sort((a, b) => a.created_at - b.created_at);
      bucket.splice(0, bucket.length - cap);
    }
  }
}
