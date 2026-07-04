// 發送外送匣（Outbox，ADR-0041）：節流 + OK 感知重試 + 重連補送。
//
// 群組扇出會對每位成員各發一個 Gift Wrap（ADR-0027），原本是同步 for 迴圈即發即忘。
// 本模組把發送改為排隊：以 maxInflight 控制併發（節流，避免對第三方 relay 突發），
// 依 relay 的 OK 回覆確認/分類重試，重連時補送未確認者。純狀態機，時鐘可注入以利測試。
//
// 設計原則：絕不「誤判失敗」。觀察不到 OK 的路徑（例如未接 OK 的座）在 inflightTtl 後
// 靜默視為已送達（不回報失敗）；只有 relay 明確拒收（或超過重試上限）才回報 onDrop。

import type { NostrEvent } from "./event.js";

/** relay OK 回覆的分類。 */
export type OkVerdict = "confirmed" | "retry" | "permanent";

/**
 * 依 NIP-01 OK 機器可讀前綴分類：
 * - accepted 或 `duplicate:` → 已確認（成功）。
 * - `rate-limited`/`error`/未知 → 暫時性，退避重試。
 * - `blocked`/`invalid`/`pow`/`restricted`/`mute` → 永久性，放棄並回報。
 */
export function classifyOk(accepted: boolean, message: string): OkVerdict {
  const m = message.trim().toLowerCase();
  if (accepted || m.startsWith("duplicate")) return "confirmed";
  if (/^(blocked|invalid|pow|restricted|mute)\b/.test(m)) return "permanent";
  return "retry";
}

export interface OutboxOptions {
  /** 實際送出（路由/多座發布由呼叫端封裝於此）。 */
  send: (event: NostrEvent) => void;
  /** 永久失敗或超過重試上限時回報（供 UI 呈現「未送達」）。 */
  onDrop?: (event: NostrEvent, reason: string) => void;
  /** 同時在途（未確認）上限；節流的主要旋鈕。預設 4。 */
  maxInflight?: number;
  /** 單一事件的重試上限；超過即 onDrop。預設 4。 */
  maxRetries?: number;
  /** 退避基數（毫秒），退避＝base × 2^(attempts-1)。預設 800。 */
  backoffBaseMs?: number;
  /** 在途未收到 OK 超過此時間即靜默丟棄（假設已送達，不回報失敗）。預設 30000。 */
  inflightTtlMs?: number;
  /** 可注入時鐘（測試用）。預設 Date.now。 */
  now?: () => number;
}

interface Entry {
  event: NostrEvent;
  attempts: number;
  status: "queued" | "inflight";
  /** queued：最早可送時間；inflight：送出時間。 */
  at: number;
}

/** 發送外送匣：enqueue → pump（節流送出）→ onOk（確認/重試）→ onReconnect（補送）。 */
export class Outbox {
  private readonly entries = new Map<string, Entry>();
  private readonly opts: {
    send: (event: NostrEvent) => void;
    onDrop?: ((event: NostrEvent, reason: string) => void) | undefined;
    maxInflight: number;
    maxRetries: number;
    backoffBaseMs: number;
    inflightTtlMs: number;
    now: () => number;
  };

  constructor(options: OutboxOptions) {
    this.opts = {
      send: options.send,
      onDrop: options.onDrop,
      maxInflight: options.maxInflight ?? 4,
      maxRetries: options.maxRetries ?? 4,
      backoffBaseMs: options.backoffBaseMs ?? 800,
      inflightTtlMs: options.inflightTtlMs ?? 30_000,
      now: options.now ?? Date.now,
    };
  }

  /** 排入一個事件（重複 id 忽略，避免同一事件被重排）。 */
  enqueue(event: NostrEvent): void {
    if (this.entries.has(event.id)) return;
    this.entries.set(event.id, { event, attempts: 0, status: "queued", at: 0 });
  }

  /** 待處理（queued + inflight）數量。 */
  get size(): number {
    return this.entries.size;
  }

  /** 目前在途（已送、未確認）數量。 */
  get inflight(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.status === "inflight") n++;
    return n;
  }

  /** 節流送出：丟棄逾時在途、在併發上限內把到期的 queued 送出。 */
  pump(): void {
    const now = this.opts.now();
    // 1) 在途逾時：靜默丟棄（假設已送達，不回報失敗）。
    for (const [id, e] of this.entries) {
      if (e.status === "inflight" && now - e.at >= this.opts.inflightTtlMs) this.entries.delete(id);
    }
    // 2) 在併發上限內送出到期的 queued（插入序即優先序）。
    let inflight = this.inflight;
    for (const e of this.entries.values()) {
      if (inflight >= this.opts.maxInflight) break;
      if (e.status !== "queued" || e.at > now) continue;
      e.status = "inflight";
      e.at = now;
      inflight++;
      this.opts.send(e.event);
    }
  }

  /** 處理 relay 的 OK 回覆。 */
  onOk(eventId: string, accepted: boolean, message: string): void {
    const e = this.entries.get(eventId);
    if (!e) return;
    const verdict = classifyOk(accepted, message);
    if (verdict === "confirmed") {
      this.entries.delete(eventId);
      return;
    }
    if (verdict === "permanent") {
      this.entries.delete(eventId);
      this.opts.onDrop?.(e.event, message || "rejected");
      return;
    }
    // retry：退避重排；超過上限即放棄回報。
    e.attempts++;
    if (e.attempts > this.opts.maxRetries) {
      this.entries.delete(eventId);
      this.opts.onDrop?.(e.event, message || "max-retries");
      return;
    }
    e.status = "queued";
    e.at = this.opts.now() + this.opts.backoffBaseMs * 2 ** (e.attempts - 1);
  }

  /** 重連後：把所有未確認的在途事件改回 queued，下次 pump 立即補送。 */
  onReconnect(): void {
    const now = this.opts.now();
    for (const e of this.entries.values()) {
      if (e.status === "inflight") {
        e.status = "queued";
        e.at = now;
      }
    }
  }

  /** 清空（停用時呼叫）。 */
  clear(): void {
    this.entries.clear();
  }
}
