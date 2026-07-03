// 混合式引導路由（ADR-0039）：簽章的 relay 清單、驗簽、pool 合併與去重。
//
// 清單由維護者金鑰簽章（NIP-01 事件，kind RELAY_LIST），信任根＝維護者公鑰。
// 傳播以 Nostr 帶內為主、GitHub HTTP 為後備；採用前驗簽 + 防清空 + 較新才取代。
// 純函式（無網路、無 I/O），供 core 測試與 client/worker 共用。

import { RELAY_LIST_KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import { finalizeEvent, verifyEvent } from "./sign.js";
import type { PubkeyHex, SecretKey } from "./keys.js";

/** relay 清單文件（簽章事件的 content JSON）。 */
export interface RelayListDoc {
  /** WebSocket 網址陣列（wss:// 或 ws://）。 */
  relays: string[];
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

/** 建立並簽章一份 relay 清單事件（維護者金鑰）。 */
export function signRelayList(doc: RelayListDoc, maintainerSk: SecretKey): NostrEvent {
  const relays = dedupeRelays(doc.relays);
  return finalizeEvent(
    {
      kind: RELAY_LIST_KIND,
      created_at: doc.updatedAt,
      tags: [],
      content: JSON.stringify({ relays, updatedAt: doc.updatedAt }),
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
  return { relays, updatedAt: doc.updatedAt };
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
