// 自訂 emoji blob 的內容定址傳遞（backfill 協定，ADR-0223 Model B）。
//
// 收端見訊息裡的 `ref`（blob 的 contentHash）但快取無此 blob → 送 ASSET_REQUEST 給寄件者；
// 寄件者查得 blob → 以 ASSET_CHUNK 分塊回傳（大 blob 可跨多塊）。收端重組、驗 contentHash、入快取。
//
// - ASSET_REQUEST：小控制訊息，內層 kind 44、外層 Gift Wrap(1059)。
// - ASSET_CHUNK：可能大，內層 kind 45、外層 FILE_WRAP(1060)（獨立配額桶、與 FILE_CHUNK 區分）。
// blob `data` 為 `data:image/*` data URI 字串——直接切字串（已是 ASCII），不另 base64。

import { KIND } from "./constants.js";
import { contentHash } from "./event.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

/** 單塊字串上限；JSON 後仍在 NIP-44 單則 65535 明文上限內留餘裕。 */
export const ASSET_CHUNK_CHARS = 48_000;
/** 單 blob 塊數上限（收端防禦）；≈48 塊 × 48000 ≈ 2.3MB 原圖。 */
export const ASSET_CHUNK_MAX_TOTAL = 64;

/**
 * 單顆 blob 位元組（字元）上限（ADR-0226）：＝可在分塊上限內送達的最大長度。
 * 產生端超過即拒收、送端超過不送——讓產生端與傳輸能力對齊，消除「本機成功、對端靜默失敗」。
 */
export const BLOB_MAX_BYTES = ASSET_CHUNK_CHARS * ASSET_CHUNK_MAX_TOTAL;

const HASH_RE = /^[0-9a-f]{64}$/;

/** 解密後的 blob 分塊。 */
export interface AssetChunk {
  hash: string;
  /** 0-based 塊序。 */
  seq: number;
  total: number;
  data: string;
}

/** 把 blob data URI 字串切塊（最後一塊可短）。 */
export function splitAssetChunks(data: string): string[] {
  const out: string[] = [];
  for (let off = 0; off < data.length; off += ASSET_CHUNK_CHARS) {
    out.push(data.slice(off, off + ASSET_CHUNK_CHARS));
  }
  return out.length > 0 ? out : [""];
}

/** 送 blob 請求：內層 kind ASSET_REQUEST、外層 Gift Wrap。 */
export function wrapAssetRequest(
  hash: string,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { now?: number } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return sealAndWrap(
    { kind: KIND.ASSET_REQUEST, created_at: nowSec, tags: [], content: JSON.stringify({ hash }) },
    senderSk,
    recipientPk,
    { kind: KIND.OFFLINE_DM_GIFT_WRAP, tags: [["p", recipientPk]] },
  );
}

/** 解析 blob 請求 rumor；kind 不符或 hash 非法回 null。 */
export function parseAssetRequest(rumor: Rumor): { hash: string } | null {
  if (rumor.kind !== KIND.ASSET_REQUEST) return null;
  try {
    const p = JSON.parse(rumor.content) as { hash?: unknown };
    if (typeof p.hash !== "string" || !HASH_RE.test(p.hash)) return null;
    return { hash: p.hash };
  } catch {
    return null;
  }
}

/** 包一塊 blob：內層 kind ASSET_CHUNK、外層 Gift Wrap(1059)（與 ASSET_REQUEST 同路徑，經 receiveDm）。 */
export function wrapAssetChunk(
  chunk: AssetChunk,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { now?: number } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return sealAndWrap(
    {
      kind: KIND.ASSET_CHUNK,
      created_at: nowSec,
      tags: [],
      content: JSON.stringify({ hash: chunk.hash, seq: chunk.seq, total: chunk.total, data: chunk.data }),
    },
    senderSk,
    recipientPk,
    { kind: KIND.OFFLINE_DM_GIFT_WRAP, tags: [["p", recipientPk]] },
  );
}

/** 解析 blob 分塊 rumor；kind 不符、欄位非法、超過防禦上限一律回 null。 */
export function parseAssetChunk(rumor: Rumor): AssetChunk | null {
  if (rumor.kind !== KIND.ASSET_CHUNK) return null;
  try {
    const p = JSON.parse(rumor.content) as { hash?: unknown; seq?: unknown; total?: unknown; data?: unknown };
    if (typeof p.hash !== "string" || !HASH_RE.test(p.hash)) return null;
    if (!Number.isInteger(p.seq) || !Number.isInteger(p.total)) return null;
    const seq = p.seq as number;
    const total = p.total as number;
    if (total < 1 || total > ASSET_CHUNK_MAX_TOTAL || seq < 0 || seq >= total) return null;
    if (typeof p.data !== "string" || p.data.length > ASSET_CHUNK_CHARS) return null;
    return { hash: p.hash, seq, total, data: p.data };
  } catch {
    return null;
  }
}

/**
 * 重組某 hash 的所有分塊為完整 blob data URI。齊全（seq 0..total-1 皆到且 total 一致）且
 * **重組後 contentHash 等於 hash**（整合性）才回傳字串；否則回 null（不齊/不符/被掉包）。
 */
export function reassembleAssetChunks(chunks: AssetChunk[]): string | null {
  if (chunks.length === 0) return null;
  const first = chunks[0]!;
  const total = first.total;
  const hash = first.hash;
  const bySeq = new Map<number, string>();
  for (const c of chunks) {
    if (c.hash !== hash || c.total !== total) return null; // 混入不同 blob/總數
    bySeq.set(c.seq, c.data);
  }
  if (bySeq.size !== total) return null; // 不齊
  let data = "";
  for (let i = 0; i < total; i++) {
    const part = bySeq.get(i);
    if (part === undefined) return null;
    data += part;
  }
  return contentHash(data) === hash ? data : null; // 整合性驗證（ADR-0223）
}
