import type { NostrEvent } from "@nostr-buddy/core";
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
 * 離線留言的持久化行為（NIP-40 過期、每收件人配額）。
 *
 * 此為傳輸/儲存無關的純邏輯，定義 relay 的留言語意；Worker 端之後以
 * D1 為後備實作相同行為。Ephemeral 事件不會進入此處（見 RelayCore）。
 */
export class MessageStore {
  private events: NostrEvent[] = [];

  constructor(private readonly opts: MessageStoreOptions = {}) {}

  /** 寫入一筆留言；若已過期則拒絕並回 false。 */
  put(event: NostrEvent, nowSec: number): boolean {
    if (this.isExpired(event, nowSec)) return false;
    this.events.push(event);
    this.enforceCap(event);
    return true;
  }

  /** 查詢符合 filter 且未過期的留言。 */
  query(filter: RelayFilter, nowSec: number): NostrEvent[] {
    return this.events.filter(
      (e) => !this.isExpired(e, nowSec) && matchFilter(filter, e),
    );
  }

  /** 清除所有已過期留言。 */
  prune(nowSec: number): void {
    this.events = this.events.filter((e) => !this.isExpired(e, nowSec));
  }

  private isExpired(event: NostrEvent, nowSec: number): boolean {
    const exp = getExpiration(event);
    return exp !== undefined && exp <= nowSec;
  }

  private recipientOf(event: NostrEvent): string | undefined {
    return event.tags.find((t) => t[0] === "p")?.[1];
  }

  private enforceCap(event: NostrEvent): void {
    const cap = this.opts.maxPerRecipient;
    if (cap === undefined) return;
    const recipient = this.recipientOf(event);
    if (recipient === undefined) return;

    const forRecipient = this.events.filter((e) => this.recipientOf(e) === recipient);
    if (forRecipient.length <= cap) return;

    const drop = new Set(
      [...forRecipient]
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, forRecipient.length - cap),
    );
    this.events = this.events.filter((e) => !drop.has(e));
  }
}
