// 封裝的在線狀態（ADR-0129）：把 `{s, m, np}`（狀態／自訂文字／正在聽的音樂）以 NIP-59 封裝，
// 定址送給**在線但沒有 P2P 通道**的聯絡人——只在改變時與對方剛上線時發，不是每則心跳。
//
// ## 為什麼要封裝
//
// 在線心跳（kind 20000）原本一則事件同時做兩件事、而且明文：存活信標（靠到達時間判離線）＋
// 狀態內容。於是 relay 每 60 秒就明文看到「這個 pubkey 在聽某首歌、狀態寫著某句話」。
//
// ADR-0129 把兩者拆開：心跳降為**無內容存活信標**（relay 只剩「何時在線」的時序）；狀態內容
// 改走這裡——**外層一次性臨時金鑰簽名、`#p` 定址、內容全密文**，relay 看到的和一則 Gift Wrap
// 一樣（臨時作者＋指名收件人）。樣板同 ADR-0120 的 typing/nudge。

import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { openWrap, sealAndWrap } from "./nip59.js";
import type { PresencePayload } from "./presence-status.js";

/** 封裝在線狀態的 ephemeral kind（21000–21999，NIP-59 包封；21004＝presence 狀態）。 */
export const PRESENCE_SIGNAL_KIND = 21004;

/** 封裝的狀態酬載：`{s,m,np}` ＋ 自報心跳節奏 `hb`（供收端算容忍窗，與 P2P/心跳一致）。 */
export interface PresenceStateSignal extends PresencePayload {
  /** 自報的心跳節奏（毫秒）；供收端 2.5× 容忍窗判離線（ADR-0109）。 */
  hb?: number;
}

/** 把在線狀態封成 NIP-59 ephemeral 事件（kind 21004），定址給某聯絡人。 */
export function wrapPresenceState(
  state: PresenceStateSignal,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { now?: number } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return sealAndWrap(
    { kind: PRESENCE_SIGNAL_KIND, created_at: nowSec, tags: [], content: JSON.stringify(state) },
    senderSk,
    recipientPk,
    { kind: PRESENCE_SIGNAL_KIND, tags: [["p", recipientPk]] },
  );
}

/** 解開封裝的在線狀態，回傳**經身分驗證的**寄件人與狀態；解不開或格式非法時拋錯。 */
export function readPresenceState(
  event: NostrEvent,
  recipientSk: SecretKey,
): { sender: PubkeyHex; state: PresenceStateSignal } {
  const { sender, rumor } = openWrap(event, recipientSk);
  const value: unknown = JSON.parse(rumor.content);
  if (typeof value !== "object" || value === null) throw new Error("presence 狀態格式錯誤");
  const v = value as Record<string, unknown>;
  const state: PresenceStateSignal = {
    s: (typeof v.s === "string" ? v.s : "online") as PresencePayload["s"],
    m: typeof v.m === "string" ? v.m : "",
    np: typeof v.np === "string" ? v.np : "",
    ...(typeof v.hb === "number" ? { hb: v.hb } : {}),
  };
  return { sender, state };
}
