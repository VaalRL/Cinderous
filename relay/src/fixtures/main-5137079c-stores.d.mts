// `main-5137079c-stores.mjs` 的型別（ADR-0370）：錨點切到 SDK 中繼之前最後部署的儲存程式。
import type { NostrEvent } from "@cinderous/core";
import type { MessageStoreOptions, RelayFilter, SqlExec } from "@cinderous/client/relay";

export interface MainStore {
  put(event: NostrEvent, nowSec: number): boolean;
  putAddressable(event: NostrEvent, nowSec: number): boolean;
  query(filter: RelayFilter, nowSec: number, maxBytes?: number): NostrEvent[];
  prune(nowSec: number): void;
}
export declare const MessageStore: new (opts?: MessageStoreOptions) => MainStore;
export declare const SqlMessageStore: new (sql: SqlExec, opts?: MessageStoreOptions) => MainStore;
export declare const ConnPersistence: new (sql: SqlExec) => unknown;
