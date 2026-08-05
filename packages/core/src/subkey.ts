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

/** FS 能力宣告版本字串（ADR-0245）：寫進簽章個人檔的 `fs` 欄位供 TOFU 釘選/降級偵測。 */
export const FS_CAPABILITY = "ek-v1";

/**
 * **明示退場**的能力值（ADR-0306 D3.3）：宣告「我不再做 FS」。
 *
 * 為什麼需要一個明示值，而不是把欄位拿掉：欄位缺席與「刻意停止」在收件端**看起來一樣**，
 * 而後者會讓已釘選的對方永遠觸發降級警告（`fsWouldDowngrade`），
 * 那句警告的意思是「對方可能正在被攻擊」——**停用與被攻擊無法區分**。
 *
 * 安全性由 ADR-0245 §81 的既有性質保證：`fs` 寫在**簽章個人檔**內、**不可偽造**
 * ⇒ 攻擊者無法偽造退場宣告來剝奪你的 FS，只能扣住你的新個人檔，
 * 而那樣對方仍看到舊的 `ek-v1`、仍然警告 ⇒ **失敗方向落在安全側**。
 */
export const FS_RETIRED = "none";

/**
 * 能力字串的長度上限（**與 `profile.ts` 的實際限制對齊**）。
 *
 * ⚠ `parseProfile` 只收 `fs.length <= 16`，超過即**丟棄整個欄位** ⇒ 對方會被判為
 * `absent`（沒有宣告）而不是 `unknown`（宣告了我不認得的機制）——**靜默失效**，
 * 收件端完全看不出對方宣告過什麼。故**新增能力值時必須先過這一關**。
 */
export const FS_CAPABILITY_MAX_LEN = 16;

/**
 * 對方的 FS 能力宣告，解讀為四種**互斥**狀態（ADR-0306 D3.3c／ADR-0302 §1–2）。
 *
 * - `fs`：正在做我們支援的 FS（`ek-v1`）⇒ TOFU 釘選。
 * - `retired`：**明示停止**（硬退）⇒ 應解除釘選，不得再發降級警告。
 * - `unknown`：宣告了我們不認得的機制（例如日後的 `ek-v2`／`ratchet-v1`）
 *   ⇒ 對方是**升級**不是降級；⚠ 舊碼把它與 `absent` 混為一談（ADR-0302 §2 指出
 *   那個「碰巧安全但語意錯誤」的缺陷）。
 * - `absent`：沒有宣告（今天絕大多數聯絡人）。
 */
export type FsCapability = "fs" | "retired" | "unknown" | "absent";

/** 解讀簽章個人檔的 `fs` 欄位。不信任網路來源：非字串／空白一律當 `absent`。 */
export function readFsCapability(fs: unknown): FsCapability {
  if (typeof fs !== "string") return "absent";
  const v = fs.trim();
  if (!v) return "absent";
  if (v === FS_CAPABILITY) return "fs";
  if (v === FS_RETIRED) return "retired";
  return "unknown";
}

/** rumor 內嵌 EK hint 的 tag 名（比照 ADR-0035 relay hint；夾在**加密內層** rumor、中繼看不到）。 */
export const EK_HINT_TAG = "ek";

/**
 * EK grace 窗（毫秒）：預設 7 天。一把 EK 被更新的一把**取代**後，仍保留 grace 供解在途訊息；
 * 超窗即刪（刪除紀律＝FS 真正生效的下半場）。current（最新）永不刪。
 */
export const FS_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 自動輪替間隔（毫秒；ADR-0313）：預設 7 天，**與 grace 相同是刻意的**——
 * 每 7 天輪替 ＋ 舊把被取代 7 天後回收 ⇒ 穩態下手上恆為 2 把（current ＋ 一把 grace 內）。
 *
 * 為什麼需要自動：FS 來自「刪掉舊金鑰」，而 `pruneFsKeys` 保證 current 永不刪
 * ⇒ **從不輪替＝priv(EK) 永遠活著＝零 FS**。啟用卻不輪替的使用者以為自己受保護，
 * 那比沒開更糟。這個紀律不該外包給使用者的記性（ADR-0313）。
 */
export const FS_ROTATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 現在該不該輪替 EK（ADR-0313）：current（最大 `at`）的年齡達到間隔即回 true。
 *
 * 看的是**金鑰年齡**而非計時器，因為 App 大部分時間是關著的——計時器在關閉期間不跑，
 * 重啟又從零計時，一個每天開關 App 的使用者可能永遠輪不到。年齡把離線期間也算進去。
 *
 * 無金鑰（尚未啟用）回 false——生成第一把是 `enableFs` 的事，不是輪替。
 */
export function shouldRotateFs<T extends { at: number }>(
  keys: T[],
  now: number,
  intervalMs: number = FS_ROTATE_INTERVAL_MS,
): boolean {
  const newest = keys.reduce<number | undefined>((max, k) => (max === undefined || k.at > max ? k.at : max), undefined);
  return newest !== undefined && now - newest >= intervalMs;
}

/**
 * 依 grace 修剪 EK 金鑰（ADR-0245 刪除紀律）：保留 current（最大 `at`）＋「被取代未逾 grace」者；
 * 逾 grace 的舊 EK 回收（＝真正刪除，之後被側錄的密文再也解不開）。純函式；`now` 由呼叫端傳入。
 */
export function pruneFsKeys<T extends { at: number }>(keys: T[], now: number, graceMs: number = FS_GRACE_MS): T[] {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  // 索引 i 的金鑰於 sorted[i+1] 生成時被取代；current（最後一個）永遠保留。
  return sorted.filter((k, i) => i === sorted.length - 1 || now - (sorted[i + 1] as { at: number }).at <= graceMs);
}

/**
 * 解封失敗的觀測記錄（ADR-0316）。
 *
 * **桶名帶著不確定性是刻意的。** 密碼學上無法區分「我沒有正確的金鑰」與「這段密文是垃圾」——
 * NIP-44 兩者都是 MAC 驗證失敗。唯一確定的方向是**不對稱**的：從未持有過 EK 時的失敗
 * 確定與 FS 無關；有或曾有 EK 時則無法區分。把 `maybeEkLoss` 叫成 `ekLoss` 會讓下一個
 * 讀這段程式的人把猜測當成事實。
 */
export interface FsFailureLog {
  /** 從未持有過 EK 時的失敗＝**確定與 FS 無關**（畸形事件／不是給我的）。不對使用者顯示。 */
  notFs: number;
  /** 有或曾有 EK 時的失敗＝**可能**是 EK 已回收，也可能只是畸形事件。 */
  maybeEkLoss: number;
  /** 最後一次 `maybeEkLoss` 的時間（毫秒）；供 UI 顯示與比對最近一次輪替。 */
  lastEkLossAt?: number;
}

/** 空記錄（舊存檔缺欄位時的預設）。 */
export const EMPTY_FS_FAILURE_LOG: FsFailureLog = { notFs: 0, maybeEkLoss: 0 };

/**
 * 一顆**暫時解不開**、留著等 EK 同步回來再試的事件（ADR-0325）。
 *
 * `openWrapWithEks` 的註解一直寫著「全部失敗＝拋（呼叫端顯示未解、**待 EK 同步後重試**）」，
 * 但 ADR-0316 §決策-6 把保留列為獨立後續、當時不做——這裡把那件事補上。
 */
export interface PendingFsEvent {
  /** 外層 wrap 的事件 id（去重用）。 */
  id: string;
  /** 留下來的時間（毫秒）——TTL 從這裡算，不是事件的 `created_at`（那由寄件人控制）。 */
  at: number;
  /** 原始事件 JSON。 */
  json: string;
}

/**
 * 保留上限。
 *
 * 🔴 **這個清單是攻擊者填得進來的**：密碼學上分不出「缺 EK」與「垃圾密文」（ADR-0316），
 * 所以任何人朝我送 `#p` 垃圾都會被留下來。上限與 TTL 不是效能考量，是**濫用防線**。
 */
export const FS_PENDING_MAX = 50;

/** 保留期限：30 天。EK 若 30 天還沒同步回來，那台裝置多半也不會回來了。 */
export const FS_PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 丟掉逾期的。 */
export function prunePendingFs(list: PendingFsEvent[], now: number): PendingFsEvent[] {
  return list.filter((p) => now - p.at <= FS_PENDING_TTL_MS);
}

/**
 * 留下一顆解不開的事件。
 *
 * - **同一顆不重複留**（跨中繼會收到同一顆好幾次）——已在清單內就**原樣回傳**，
 *   呼叫端可據此跳過一次寫入（ADR-0316 已提醒過「每次失敗都寫一次儲存」）。
 * - 滿了**丟最舊的**。⚠ 這代表**灌爆可以把真的擠掉**——分不出真假就沒有更好的排序依據，
 *   已記在 ADR-0325〈買不到什麼〉。
 */
export function retainPendingFs(list: PendingFsEvent[], entry: PendingFsEvent, now: number): PendingFsEvent[] {
  if (list.some((p) => p.id === entry.id)) return list;
  const next = [...prunePendingFs(list, now), entry];
  return next.length > FS_PENDING_MAX ? next.slice(next.length - FS_PENDING_MAX) : next;
}

/**
 * 記一次解封失敗（純 reducer）。`hadEk`＝我現在有或曾經有過 EK。
 * 不變更輸入。
 */
export function recordFsFailure(log: FsFailureLog, at: number, hadEk: boolean): FsFailureLog {
  return hadEk
    ? { ...log, maybeEkLoss: log.maybeEkLoss + 1, lastEkLossAt: at }
    : { ...log, notFs: log.notFs + 1 };
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
