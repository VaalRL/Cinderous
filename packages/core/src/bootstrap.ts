// 混合式引導路由（ADR-0039）：簽章的 relay 清單、驗簽、pool 合併與去重。
//
// 清單由維護者金鑰簽章（NIP-01 事件，kind RELAY_LIST），信任根＝維護者公鑰。
// 傳播以 Nostr 帶內為主、GitHub HTTP 為後備；採用前驗簽 + 防清空 + 較新才取代。
// 純函式（無網路、無 I/O），供 core 測試與 client/worker 共用。

import { RELAY_LIST_KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import { finalizeEvent, verifyEvent } from "./sign.js";
import type { PubkeyHex, SecretKey } from "./keys.js";

/** 一座 relay 的營運狀態（ADR-0069）。 */
export type RelayStatus = "ok" | "draining" | "retired";

/**
 * 清單中一座 relay 的營運資訊（ADR-0069）：缺欄位＝預設
 * `accepting: true`、`weight: 1`、`status: "ok"`（舊清單零欄位即全預設）。
 */
export interface RelayEntry {
  url: string;
  /** 是否接受新帳號自動分配（額度吃緊時關閉；既有用戶不受影響）。 */
  accepting?: boolean;
  /** 自動分配的加權隨機權重（>0）。 */
  weight?: number;
  /** ok＝正常；draining＝計劃退役（既有用戶分批撤離）；retired＝已退役。 */
  status?: RelayStatus;
}

/** relay 清單文件（簽章事件的 content JSON）。 */
export interface RelayListDoc {
  /** WebSocket 網址陣列（wss:// 或 ws://）；舊客戶端相容欄位。 */
  relays: string[];
  /** 每座營運資訊（ADR-0069）；未提供時新客戶端以 relays 物化預設值。 */
  entries?: RelayEntry[];
  /** 發佈時間（unix 秒）；用於「較新才取代」。 */
  updatedAt: number;
}

/** 採用清單所需的最小節點數（防自動化腳本清空 JSON）。 */
export const MIN_LIST = 1;

/** 正規化 relay URL（trim、去尾斜線、小寫 scheme+host）；非 ws(s) 回傳 undefined。 */
export function normalizeRelay(url: string): string | undefined {
  const u = url.trim().replace(/\/+$/, "");
  if (!/^wss?:\/\//i.test(u)) return undefined;
  try {
    const parsed = new URL(u);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** 正規化並驗證 entries（ADR-0069）：非法項濾除、URL 正規化去重；空集回 undefined。 */
function normalizeEntries(value: unknown): RelayEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: RelayEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const url = typeof e.url === "string" ? normalizeRelay(e.url) : undefined;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      ...(e.accepting === false ? { accepting: false } : {}),
      ...(typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight > 0 && e.weight !== 1
        ? { weight: e.weight }
        : {}),
      ...(e.status === "draining" || e.status === "retired" ? { status: e.status } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** 建立並簽章一份 relay 清單事件（維護者金鑰）。 */
export function signRelayList(doc: RelayListDoc, maintainerSk: SecretKey): NostrEvent {
  const relays = dedupeRelays(doc.relays);
  const entries = normalizeEntries(doc.entries);
  return finalizeEvent(
    {
      kind: RELAY_LIST_KIND,
      created_at: doc.updatedAt,
      tags: [],
      content: JSON.stringify({ relays, ...(entries ? { entries } : {}), updatedAt: doc.updatedAt }),
    },
    maintainerSk,
  );
}

/**
 * 驗證清單事件並取出文件；任一條件不符回傳 null：
 * 簽章無效、作者非指定維護者、kind 不符、內容非法、節點數不足。
 */
export function verifyRelayList(event: NostrEvent, maintainerPubkey: PubkeyHex): RelayListDoc | null {
  if (event.kind !== RELAY_LIST_KIND) return null;
  if (event.pubkey !== maintainerPubkey) return null;
  if (!verifyEvent(event)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<RelayListDoc>;
  if (!Array.isArray(doc.relays) || typeof doc.updatedAt !== "number") return null;
  const relays = dedupeRelays(doc.relays.filter((r): r is string => typeof r === "string"));
  if (relays.length < MIN_LIST) return null;
  const entries = normalizeEntries(doc.entries);
  return { relays, ...(entries ? { entries } : {}), updatedAt: doc.updatedAt };
}

/**
 * 決定是否以候選清單取代目前的 last-known-good（ADR-0039 防清空）：
 * 僅當候選較新（updatedAt 更大）且節點數達標時取代。
 */
export function shouldAdoptList(current: RelayListDoc | null, candidate: RelayListDoc): boolean {
  if (candidate.relays.length < MIN_LIST) return false;
  if (!current) return true;
  return candidate.updatedAt > current.updatedAt;
}

/** 正規化並去重一組 relay URL（保留首次出現順序）。 */
export function dedupeRelays(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const norm = normalizeRelay(url);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/** 物化後的營運資訊（預設值全部補齊）。 */
export interface ResolvedRelayEntry {
  url: string;
  accepting: boolean;
  weight: number;
  status: RelayStatus;
}

/** 物化清單的營運資訊（ADR-0069）：有 entries 用 entries，否則以 relays 補預設值。 */
export function listEntries(doc: { relays: string[]; entries?: RelayEntry[]; updatedAt?: number }): ResolvedRelayEntry[] {
  const source: RelayEntry[] = doc.entries ?? doc.relays.map((url) => ({ url }));
  return source.map((e) => ({
    url: e.url,
    accepting: e.accepting !== false,
    weight: typeof e.weight === "number" && e.weight > 0 ? e.weight : 1,
    status: e.status ?? "ok",
  }));
}

/**
 * 新帳號自動分配（ADR-0069 I4）：在 `accepting` 且 `ok` 的座中加權隨機。
 * `rand` ∈ [0,1) 由呼叫端注入（可測）；無候選回 undefined。
 */
export function pickWeighted(entries: readonly ResolvedRelayEntry[], rand: number): string | undefined {
  const pool = entries.filter((e) => e.accepting && e.status === "ok");
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return undefined;
  let x = Math.min(Math.max(rand, 0), 1 - Number.EPSILON) * total;
  for (const e of pool) {
    x -= e.weight;
    if (x < 0) return e.url;
  }
  return pool[pool.length - 1]?.url;
}

/**
 * 搬家目標（ADR-0069 I2/I3）：清單序**第一個** `accepting` 且 `ok` 且非排除座——
 * 決定性選座讓同帳號多台裝置各自搬也會選到同一座（緩解 split-brain）。
 */
export function migrationTarget(entries: readonly ResolvedRelayEntry[], excludeUrl?: string): string | undefined {
  return entries.find((e) => e.accepting && e.status === "ok" && e.url !== excludeUrl)?.url;
}

/**
 * 合併出「引導 pool」（ADR-0039）：錨點 ∪ 簽章清單 ∪ 額外（home/hint）。
 * 錨點永遠在前（保底優先），全體正規化去重。
 */
export function mergeBootstrapPool(
  anchors: readonly string[],
  listRelays: readonly string[],
  extra: readonly string[] = [],
): string[] {
  return dedupeRelays([...anchors, ...listRelays, ...extra]);
}
