import type { NostrEvent } from "@nostr-buddy/core";
import type { RelayFilter } from "./protocol.js";

/** 判斷事件是否符合單一 filter（NIP-01：欄位間為 AND，陣列內為 OR）。 */
export function matchFilter(filter: RelayFilter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  return true;
}
