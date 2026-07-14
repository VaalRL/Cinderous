import { KIND, TYPING_TIMEOUT_MS } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { openWrap, sealAndWrap } from "./nip59.js";
import { LatestPerKey } from "./tracker.js";

/**
 * 建立一筆「正在輸入中」事件（kind 20001，Ephemeral、**NIP-59 封裝**）。
 *
 * ## 為什麼要封裝（ADR-0120）
 *
 * 過去這裡是 `createEphemeralEvent(sk, KIND.TYPING, { tags: [["p", recipientPk]] })`
 * ——**用真實金鑰簽名、收件人明文寫在 tag 裡**。中繼站看到的是一條有簽章、有時間戳、
 * 有方向的社交圖譜邊，而且不可否認。
 *
 * 但真正致命的不是圖譜，是它**反推得出 Gift Wrap 的寄件人**：
 *
 * | 時間 | 中繼看到 | 中繼學到 |
 * |---|---|---|
 * | T+0.0s | kind 20001，**author = Alice**，p = Bob | Alice 正在對 Bob 打字 |
 * | T+2.3s | kind 1059，author = 臨時金鑰，p = Bob | 有人寄了一則密文給 Bob |
 *
 * 兩者一關聯，那個「有人」就是 Alice。**我們花了整套 NIP-59 去隱藏寄件人，
 * 然後在它前面兩秒鐘，用真名廣播了同一件事。**
 *
 * 封裝後外層由一次性臨時金鑰簽名，中繼看到的 typing 事件與它看到的 kind 1059
 * **長得一模一樣**——時間相關性還在，但沒有真名可以錨定。
 *
 * `["p", 收件人]` 仍為明文：與 kind 1059 一致，中繼必須知道要轉發給誰。
 */
export function createTyping(
  sk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { created_at?: number } = {},
): NostrEvent {
  const nowSec = opts.created_at ?? Math.floor(Date.now() / 1000);
  return sealAndWrap({ kind: KIND.TYPING, created_at: nowSec, tags: [], content: "" }, sk, recipientPk, {
    kind: KIND.TYPING,
    tags: [["p", recipientPk]],
  });
}

/**
 * 解開一筆封裝的 typing 事件，回傳**經身分驗證的**寄件人。
 *
 * 非封裝格式（舊版明文）或解不開時**拋錯**——呼叫端自行決定要不要退回舊格式
 * （見 ADR-0120 決策 5：只收不發）。
 */
export function readTyping(event: NostrEvent, recipientSk: SecretKey): PubkeyHex {
  return openWrap(event, recipientSk).sender;
}

/**
 * 追蹤對方是否正在輸入：收到事件後於 {@link TYPING_TIMEOUT_MS} 內顯示，
 * 逾時自動清除（對方停止輸入即不再發送）。
 *
 * **時間戳要用 rumor 的**（`openWrap().rumor.created_at`），不是外層 wrap 的：
 * NIP-59 的 `jitteredPast()` 會把外層 `created_at` 隨機往前推最多 2 天（隱私設計），
 * 拿它來比逾時，打字指示燈永遠不會亮。
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
