import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { WebRtcTransfer } from "./webrtc.js";

// 最小 RTCPeerConnection 樁：捕捉最後建立的 pc/dc，供測試手動觸發開/關/失敗（node 無真實 WebRTC）。
let lastDc: FakeDc | undefined;
let lastPc: FakePc | undefined;
class FakeDc {
  readyState = "connecting";
  binaryType = "";
  onmessage: ((e: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    lastDc = this;
  }
  send(): void {}
  close(): void {}
}
class FakePc {
  onicecandidate: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: unknown = null;
  connectionState = "new";
  constructor() {
    lastPc = this;
  }
  createDataChannel(): FakeDc {
    return new FakeDc();
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "" };
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "" };
  }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {}
}

describe("WebRtcTransfer 直連狀態回報（ADR-0213）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mk = () => {
    vi.stubGlobal("RTCPeerConnection", FakePc);
    lastDc = undefined;
    lastPc = undefined;
    const events: Array<[string, boolean]> = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const t = new WebRtcTransfer(sk, {
      publishSignal: () => {},
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: () => {},
      onConnectionState: (pk, c) => events.push([pk, c]),
    });
    // connect() → startOffer 同步建立資料通道並掛好 onopen/onclose 與 pc.onconnectionstatechange。
    t.connect(peer);
    return { peer, events };
  };

  it("資料通道開啟 → onConnectionState(peer, true)（直連可用）", () => {
    const { peer, events } = mk();
    lastDc!.readyState = "open";
    lastDc!.onopen!();
    expect(events).toContainEqual([peer, true]);
  });

  it("資料通道關閉 → onConnectionState(peer, false)（直連中斷）", () => {
    const { peer, events } = mk();
    lastDc!.onclose!();
    expect(events).toContainEqual([peer, false]);
  });

  it("連線失敗（pc connectionState=failed）→ onConnectionState(peer, false)（降級走 relay）", () => {
    const { peer, events } = mk();
    lastPc!.connectionState = "failed";
    lastPc!.onconnectionstatechange!();
    expect(events).toContainEqual([peer, false]);
  });
});
