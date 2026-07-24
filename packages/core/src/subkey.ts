// 前向保密的加密子鑰（EK）核心（ADR-0245／設計依 ADR-0238）——**純函式、可完整測試**。
//
// 機制：身分金鑰 IK（npub）不動；另生**隨機**加密子鑰 EK（非 nsec 導出）。寄件人把 Gift Wrap
// **retarget 到收件人當前 EK**（wrap＋seal 皆加密到 EK，`#p` 仍為收件人身分供路由）；收件人在
// grace 後刪 `priv(EK)` → 事後即使 nsec 失竊也解不開被側錄的密文（FS）。EK 是**傳輸金鑰**，與
// 本機 at-rest 儲存金鑰（nsec 導出）兩回事，故刪 EK 得 FS 又不弄丟本機歷史。
//
// 關鍵發現：`nip59.sealAndWrap`/`openWrap` 已完全參數化在 `recipientPk`/`recipientSk` 上，且 nip44
// 對話金鑰對稱 → **retarget 不需改 nip59**，只是呼叫端改傳 EK 金鑰。本檔提供：EK 生成、kind 10040
// 公告（IK 簽章、發現用）、rumor 內嵌 hint（即時免元資料學到對方 EK）、多鑰解封（試當前→grace 舊
// EK→退回 IK）。輪替觸發/排程/多裝置同步/刪除紀律屬引擎層（Phase 1），本檔只管純密碼學。

import { type NostrEvent } from "./event.js";
import { generateSecretKey, getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { type Opened, openWrap } from "./nip59.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

/** 64 位小寫十六進位公鑰。 */
const PK_RE = /^[0-9a-f]{64}$/;

/** EK 公告事件 kind（ADR-0245；接續 10037/10038/10039 的可取代事件範圍）。 */
export const EK_ANNOUNCE_KIND = 10040;

/** rumor 內嵌 EK hint 的 tag 名（比照 ADR-0035 relay hint；夾在**加密內層** rumor、中繼看不到）。 */
export const EK_HINT_TAG = "ek";

/**
 * EK grace 窗（毫秒）：預設 7 天。一把 EK 被更新的一把**取代**後，仍保留 grace 供解在途訊息；
 * 超窗即刪（刪除紀律＝FS 真正生效的下半場）。current（最新）永不刪。
 */
export const FS_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 依 grace 修剪 EK 金鑰（ADR-0245 刪除紀律）：保留 current（最大 `at`）＋「被取代未逾 grace」者；
 * 逾 grace 的舊 EK 回收（＝真正刪除，之後被側錄的密文再也解不開）。純函式；`now` 由呼叫端傳入。
 */
export function pruneFsKeys<T extends { at: number }>(keys: T[], now: number, graceMs: number = FS_GRACE_MS): T[] {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  // 索引 i 的金鑰於 sorted[i+1] 生成時被取代；current（最後一個）永遠保留。
  return sorted.filter((k, i) => i === sorted.length - 1 || now - (sorted[i + 1] as { at: number }).at <= graceMs);
}

/** 加密子鑰對（傳輸金鑰，非身分）。 */
export interface EncryptionKey {
  sk: SecretKey;
  pk: PubkeyHex;
}

/** 生成一把獨立隨機 EK（**不可**從 nsec 導出，否則無 FS）。 */
export function generateEncryptionKey(): EncryptionKey {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

/**
 * 建構 kind 10040 EK 公告（由 IK 簽章）：內容帶**當前**（`ek`）與可選**下一把**（`next`）公鑰。
 * 可取代事件＝每身分只留最新一顆；供「首次接觸/查詢」發現對方當前 EK。
 */
export function buildEkAnnounce(
  ikSk: SecretKey,
  ekPk: PubkeyHex,
  opts: { next?: PubkeyHex; now?: number } = {},
): NostrEvent {
  const content = JSON.stringify({ v: 1, ek: ekPk, ...(opts.next ? { next: opts.next } : {}) });
  return finalizeEvent(
    { kind: EK_ANNOUNCE_KIND, created_at: opts.now ?? Math.floor(Date.now() / 1000), tags: [], content },
    ikSk,
  );
}

/**
 * 驗證並解析 kind 10040 公告（不信任網路來源）：檢查 kind、簽章、內容格式與公鑰合法性。
 * 回 `{ ik, ek, next? }`（`ik`＝公告者身分＝`event.pubkey`）；任何不合法 → `null`。
 */
export function readEkAnnounce(event: NostrEvent): { ik: PubkeyHex; ek: PubkeyHex; next?: PubkeyHex } | null {
  if (event.kind !== EK_ANNOUNCE_KIND) return null;
  if (!verifyEvent(event)) return null;
  try {
    const c = JSON.parse(event.content) as { v?: unknown; ek?: unknown; next?: unknown };
    if (c.v !== 1 || typeof c.ek !== "string" || !PK_RE.test(c.ek)) return null;
    const out: { ik: PubkeyHex; ek: PubkeyHex; next?: PubkeyHex } = { ik: event.pubkey, ek: c.ek };
    if (typeof c.next === "string" && PK_RE.test(c.next)) out.next = c.next;
    return out;
  } catch {
    return null;
  }
}

/** 在 rumor tags 內設/換上「我的當前 EK」hint（送訊息時夾，對方解開即學到）。只留最新一個。 */
export function withEkHint(tags: string[][], ekPk: PubkeyHex): string[][] {
  return [...tags.filter((t) => t[0] !== EK_HINT_TAG), [EK_HINT_TAG, ekPk]];
}

/** 讀 rumor tags 內的 EK hint（合法 64-hex 才回，否則 undefined）。 */
export function ekHintOf(tags: string[][]): PubkeyHex | undefined {
  const v = tags.find((t) => t[0] === EK_HINT_TAG)?.[1];
  return typeof v === "string" && PK_RE.test(v) ? v : undefined;
}

/**
 * 以多把候選私鑰依序嘗試解封（ADR-0245）：候選＝`[當前 EK sk, …grace 內舊 EK sk, IK sk]`。
 * - EK sk 命中＝正常 FS 解密（訊息到達時解一次，之後走本機封存）。
 * - 退回 IK sk＝向後相容（非 FS 寄件人加密到收件人身分金鑰）。
 * - 全部失敗＝拋（呼叫端顯示未解、待 EK 同步後重試）。nip44 有 MAC，錯鑰必失敗、無假陽性。
 */
export function openWrapWithEks(wrapEvent: NostrEvent, candidateSks: SecretKey[]): Opened {
  let lastErr: unknown;
  for (const sk of candidateSks) {
    try {
      return openWrap(wrapEvent, sk);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("subkey：無可用金鑰解封");
}
