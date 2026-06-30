import { KIND, TYPING_TIMEOUT_MS } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { finalizeEvent } from "./sign.js";
import { LatestPerKey } from "./tracker.js";

/** 建立一筆指向對話對象的「正在輸入中」事件（Kind 20001，Ephemeral）。 */
export function createTyping(
  sk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { created_at?: number } = {},
): NostrEvent {
  return finalizeEvent(
    {
      kind: KIND.TYPING,
      created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
      tags: [["p", recipientPk]],
      content: "",
    },
    sk,
  );
}

/**
 * 追蹤對方是否正在輸入：收到事件後於 {@link TYPING_TIMEOUT_MS} 內顯示，
 * 逾時自動清除（對方停止輸入即不再發送）。
 */
export class TypingTracker {
  private readonly seen = new LatestPerKey();

  observe(pubkey: PubkeyHex, createdAtSec: number): void {
    this.seen.observe(pubkey, createdAtSec * 1000, undefined);
  }

  isTyping(pubkey: PubkeyHex, nowMs: number): boolean {
    const seen = this.seen.at(pubkey);
    if (seen === undefined) return false;
    return nowMs - seen <= TYPING_TIMEOUT_MS;
  }
}
