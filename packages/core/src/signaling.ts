import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { openWrap, sealAndWrap } from "./nip59.js";

/** WebRTC 信令使用的 ephemeral kind（21000-21999，NIP-59 包封）。 */
export const SDP_SIGNAL_KIND = 21000;

export interface OfferAnswerSignal {
  type: "offer" | "answer";
  sdp: string;
}

export interface CandidateSignal {
  type: "candidate";
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

/** WebRTC 信令內容（SDP offer/answer 或 ICE candidate）。 */
export type Signal = OfferAnswerSignal | CandidateSignal;

export interface ReceivedSignal {
  /** 經身分驗證的寄件人公鑰。 */
  sender: PubkeyHex;
  signal: Signal;
}

/**
 * 將 WebRTC 信令封成 NIP-59 ephemeral 事件（kind 21000）。
 * 以 Gift Wrap 隱藏收發雙方，避免中繼站得知「誰在呼叫誰」；
 * 不帶 NIP-40 過期，僅供即時記憶體轉發。
 */
export function createSignal(
  signal: Signal,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: { now?: number } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return sealAndWrap(
    { kind: SDP_SIGNAL_KIND, created_at: nowSec, tags: [], content: JSON.stringify(signal) },
    senderSk,
    recipientPk,
    { kind: SDP_SIGNAL_KIND, tags: [["p", recipientPk]] },
  );
}

/** 解開並驗證信令事件，回傳寄件人與信令內容。 */
export function readSignal(event: NostrEvent, recipientSk: SecretKey): ReceivedSignal {
  const { sender, rumor } = openWrap(event, recipientSk);
  return { sender, signal: JSON.parse(rumor.content) as Signal };
}
