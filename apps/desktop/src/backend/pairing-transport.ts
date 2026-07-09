// 配對傳輸（D4a，ADR-0072）：拋棄式信令會合＋WebRTC 資料通道。
//
// 信令：兩端以「房間金鑰」（自一次性金鑰決定性導出，roomKeyFrom）簽發 ephemeral
// kind 21003 事件、`p` tag 指向自己——relay 只見一把拋棄 pubkey 自我收發，與正式
// 身分不可連結；內容以一次性金鑰 AEAD 密封（sealSignal）。生產 relay 的 NIP-42
// AUTH 以房間金鑰回應（證明鑰匙持有即可，無需身分）。
//
// 資料：WebRTC 資料通道之上以 4-byte 長度前綴分塊組回，包成 core `PairTransport`
// 交給 runPairingSource/Target。RTCPeerConnection 於 node 測試環境不可用——
// 信令會合層以記憶體 relay 全量測試，RTC 接線維持最薄（實機/Playwright 驗證）。

import {
  buildAuthEvent,
  finalizeEvent,
  openSignal,
  PAIR_SIGNAL_KIND,
  type PairTransport,
  roomKeyFrom,
  sealSignal,
} from "@cinder/core";
import type { RelayConnector } from "./relay-backend.js";

/** 8-byte 隨機 hex（Web Crypto；瀏覽器/webview/node 皆可用）。 */
function randomHex8(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 資料通道單塊上限（保守低於常見 message 上限）。 */
const CHUNK_BYTES = 60_000;
/** 建立連線逾時。 */
const CONNECT_TIMEOUT_MS = 60_000;

export interface PairingSignal {
  send(msg: Record<string, unknown>): void;
  close(): void;
}

/**
 * 信令會合通道：訂閱房間收件匣、密封收發 JSON；自己的訊息（sid）自動忽略。
 * 可測（記憶體 relay）；`relayUrl` 供 NIP-42 AUTH 挑戰回應（測試可空字串）。
 */
export function createPairingSignal(opts: {
  key: Uint8Array;
  relayUrl: string;
  connector: RelayConnector;
  onMessage: (msg: Record<string, unknown>) => void;
}): PairingSignal {
  const room = roomKeyFrom(opts.key);
  const sid = randomHex8();
  const subscribe = (client: { subscribe: (id: string, filters: never[]) => void }) => {
    client.subscribe("pair", [{ kinds: [PAIR_SIGNAL_KIND], "#p": [room.pk] } as never]);
  };
  const client = opts.connector({
    onEvent: (_sub, event) => {
      if (event.kind !== PAIR_SIGNAL_KIND || event.pubkey !== room.pk) return;
      const msg = openSignal(opts.key, event.content);
      if (!msg || msg.sid === sid) return; // 解不開（非本房）或自己的回音
      opts.onMessage(msg);
    },
    authSigner: (challenge) => buildAuthEvent(challenge, opts.relayUrl, room.sk),
    onAuthenticated: (client) => subscribe(client),
  });
  subscribe(client);
  return {
    send(msg) {
      const nowSec = Math.floor(Date.now() / 1000);
      client.publish(
        finalizeEvent(
          {
            kind: PAIR_SIGNAL_KIND,
            created_at: nowSec,
            tags: [["p", room.pk]],
            content: sealSignal(opts.key, { ...msg, sid }),
          },
          room.sk,
        ),
      );
    },
    close() {
      (client as { close?: () => void }).close?.();
    },
  };
}

/** 把資料通道包成 PairTransport：送端 4-byte 長度前綴＋分塊，收端組回完整訊息。 */
function channelTransport(dc: RTCDataChannel, onClosed: () => void): PairTransport {
  let buffer = new Uint8Array(0);
  let handler: ((data: Uint8Array) => void) | undefined;
  const pending: Uint8Array[] = [];
  dc.binaryType = "arraybuffer";
  dc.onmessage = (e) => {
    const chunk = new Uint8Array(e.data as ArrayBuffer);
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;
    for (;;) {
      if (buffer.length < 4) return;
      const len = ((buffer[0]! << 24) | (buffer[1]! << 16) | (buffer[2]! << 8) | buffer[3]!) >>> 0;
      if (buffer.length < 4 + len) return;
      const msg = buffer.slice(4, 4 + len);
      buffer = buffer.slice(4 + len);
      if (handler) handler(msg);
      else pending.push(msg);
    }
  };
  return {
    send(data) {
      const framed = new Uint8Array(4 + data.length);
      framed[0] = (data.length >>> 24) & 0xff;
      framed[1] = (data.length >>> 16) & 0xff;
      framed[2] = (data.length >>> 8) & 0xff;
      framed[3] = data.length & 0xff;
      framed.set(data, 4);
      for (let i = 0; i < framed.length; i += CHUNK_BYTES) {
        dc.send(framed.subarray(i, Math.min(i + CHUNK_BYTES, framed.length)));
      }
    },
    onMessage(h) {
      handler = h;
      for (const m of pending.splice(0)) h(m);
    },
    close() {
      try {
        dc.close();
      } catch {
        /* 忽略 */
      }
      onClosed();
    },
  };
}

/**
 * 建立配對用 P2P 傳輸：新機（target）為 offerer、舊機（source）為 answerer；
 * SDP/ICE 經信令會合交換，資料通道開啟即解析為 PairTransport。
 */
export function openPairingTransport(opts: {
  key: Uint8Array;
  role: "source" | "target";
  relayUrl: string;
  connectorFor: (url: string) => RelayConnector;
  rtcConfig?: RTCConfiguration;
  timeoutMs?: number;
}): Promise<PairTransport> {
  return new Promise((resolve, reject) => {
    const pc = new RTCPeerConnection(opts.rtcConfig);
    let settled = false;
    let offerSeen = false; // 一次性房間：只接第一個 offer
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      signal.close();
      try {
        pc.close();
      } catch {
        /* 忽略 */
      }
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail("配對連線逾時"), opts.timeoutMs ?? CONNECT_TIMEOUT_MS);
    const ready = (dc: RTCDataChannel) => {
      dc.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.close(); // 已直連：會合通道功成身退
        resolve(
          channelTransport(dc, () => {
            try {
              pc.close();
            } catch {
              /* 忽略 */
            }
          }),
        );
      };
    };
    const signal = createPairingSignal({
      key: opts.key,
      relayUrl: opts.relayUrl,
      connector: opts.connectorFor(opts.relayUrl),
      onMessage: (msg) => {
        void (async () => {
          try {
            if (opts.role === "source" && msg.t === "offer" && typeof msg.sdp === "string" && !offerSeen) {
              offerSeen = true;
              await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              signal.send({ t: "answer", sdp: answer.sdp });
            } else if (opts.role === "target" && msg.t === "answer" && typeof msg.sdp === "string") {
              await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
            } else if (msg.t === "cand" && msg.c) {
              await pc.addIceCandidate(msg.c as RTCIceCandidateInit);
            }
          } catch (e) {
            fail(`配對信令處理失敗：${String(e)}`);
          }
        })();
      },
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) signal.send({ t: "cand", c: e.candidate.toJSON() });
    };
    if (opts.role === "target") {
      ready(pc.createDataChannel("pair"));
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signal.send({ t: "offer", sdp: offer.sdp });
        } catch (e) {
          fail(`建立 offer 失敗：${String(e)}`);
        }
      })();
    } else {
      pc.ondatachannel = (e) => ready(e.channel);
    }
  });
}
