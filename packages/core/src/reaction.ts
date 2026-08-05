import { KIND } from "./constants.js";
import { wrapForBoth, type WrappedMessage } from "./giftwrap.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/** 常用回應 emoji。 */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

/**
 * 以 NIP-25 對某訊息做 emoji 回應，包成 kind 1059 Gift Wrap（隱藏雙方）。
 * rumor 為 kind 7，`e` tag 指向目標訊息、content 為 emoji。
 *
 * 一併包一份**自封副本**（ADR-0107），讓自己的其他裝置也看得到自己按的回應。
 * 不需要 `to` 標記——目標訊息由 `e` tag 指定，收端據此定位，與對話無關。
 */
export function wrapReaction(
  emoji: string,
  senderSk: SecretKey,
  /** 收件人；群組傳成員清單（扇出），1:1 傳單一 pubkey。 */
  recipients: PubkeyHex | PubkeyHex[],
  targetEventId: string,
  opts: {
    now?: number;
    /**
     * FS retarget（ADR-0315 第 3 步；形狀同 ADR-0318／0320）：身分 pk → 其 EK；
     * 逐位收件人各自決定，不知道就退回身分。
     *
     * ⚠ 同樣**不帶 `ek` hint**——`wrapForBoth` 的 `id` 是 rumor 雜湊，群組扇出時跨成員一致，
     * 把每 7 天輪替的值放進 rumor 會讓它變成非決定性（ADR-0318 的同一條理由）。
     */
    encryptToFor?: (identityPk: PubkeyHex) => PubkeyHex;
  } = {},
): WrappedMessage {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return wrapForBoth(
    { kind: KIND.REACTION, created_at: nowSec, tags: [["e", targetEventId]], content: emoji },
    senderSk,
    recipients,
    nowSec + DEFAULT_TTL_SECONDS,
    opts.encryptToFor ? { encryptToFor: opts.encryptToFor } : {},
  );
}

/** 從回應 rumor 取出其指向的目標訊息 id（`e` tag）。 */
export function reactionTarget(rumor: Rumor): string | undefined {
  return rumor.tags.find((t) => t[0] === "e")?.[1];
}
