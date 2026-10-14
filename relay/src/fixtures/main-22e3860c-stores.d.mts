// `main-22e3860c-stores.mjs` 的型別（ADR-0379）：容量功能移植前的兩個 store，形狀就是當時的 `OfflineStore`。
import type { NostrEvent } from "@cinderous/core";
import type { MessageStoreOptions } from "../message-store.js";
import type { RelayFilter } from "../protocol.js";
import type { SqlExec } from "../sql-message-store.js";

export interface MainStore {
  put(event: NostrEvent, nowSec: number): boolean;
  putAddressable(event: NostrEvent, nowSec: number): boolean;
  query(filter: RelayFilter, nowSec: number, maxBytes?: number): NostrEvent[];
  prune(nowSec: number): void;
  vanish(pubkey: string, nowSec: number): number;
}
export declare const MessageStore: new (opts?: MessageStoreOptions) => MainStore;
export declare const SqlMessageStore: new (sql: SqlExec, opts?: MessageStoreOptions) => MainStore;
