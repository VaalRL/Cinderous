// 雙方同時發起直連（ADR-0384）：兩人同時打開對話 → 兩邊都 connect() → 兩顆 offer 在路上交錯。
//
// 修正前：各自把對方的 offer 套進「自己已送出 offer」的狀態，瀏覽器丟 InvalidStateError／
// 「Failed to set SSL role for the transport」，對話裡多一行「⚠️ 信令處理失敗」，直連也沒建立。
import type { NostrEvent } from "@cinderous/core";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebRtcTransfer } from "./webrtc.js";

type Desc = { type: string; sdp?: string };

class FakeDc {
  readyState = "connecting";
  binaryType = "";
  bufferedAmountLowThreshold = 0;
  onmessage: ((e: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly owner: StrictPc) {}
  send(): void {}
  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

/** 照瀏覽器的規則檢查狀態轉換，不合法就丟錯（沒有隱式 rollback——舊版 WebView 也是這樣） */
class StrictPc {
  static all: StrictPc[] = [];
  signalingState = "stable";
  remoteDescription: Desc | null = null;
  connectionState = "new";
  onicecandidate: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: FakeDc }) => void) | null = null;
  readonly channels: FakeDc[] = [];
  constructor() {
    StrictPc.all.push(this);
  }
  createDataChannel(): FakeDc {
    const dc = new FakeDc(this);
    this.channels.push(dc);
    return dc;
  }
  async createOffer(): Promise<Desc> {
    return { type: "offer", sdp: "o" };
  }
  async createAnswer(): Promise<Desc> {
    if (this.signalingState !== "have-remote-offer") throw new Error("InvalidStateError: createAnswer");
    return { type: "answer", sdp: "a" };
  }
  async setLocalDescription(d: Desc): Promise<void> {
    const s = this.signalingState;
    if (d.type === "offer" && s === "stable") this.signalingState = "have-local-offer";
    else if (d.type === "answer" && s === "have-remote-offer") this.signalingState = "stable";
    else if (d.type === "rollback" && s === "have-local-offer") this.signalingState = "stable";
    else throw new Error(`InvalidStateError: setLocalDescription(${d.type}) in ${s}`);
  }
  async setRemoteDescription(d: Desc): Promise<void> {
    const s = this.signalingState;
    if (d.type === "offer" && s === "stable") this.signalingState = "have-remote-offer";
    else if (d.type === "answer" && s === "have-local-offer") this.signalingState = "stable";
    else throw new Error(`InvalidAccessError: Failed to set SSL role for the transport (${d.type} in ${s})`);
    this.remoteDescription = d;
  }
  async addIceCandidate(): Promise<void> {
    if (!this.remoteDescription) throw new Error("InvalidStateError: no remote description");
  }
  close(): void {}
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("雙方同時發起直連（ADR-0384）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("兩顆 offer 交錯：不報錯，雙方各自停在 stable、各有一份對方的描述（一條連線談成）", async () => {
    vi.stubGlobal("RTCPeerConnection", StrictPc);
    StrictPc.all = [];
    const skA = generateSecretKey();
    const skB = generateSecretKey();
    const pkA = getPublicKey(skA);
    const pkB = getPublicKey(skB);
    const errors: string[] = [];
    const toA: NostrEvent[] = [];
    const toB: NostrEvent[] = [];
    const handlers = (outbox: NostrEvent[]) => ({
      publishSignal: (e: NostrEvent) => outbox.push(e),
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: (_pk: string, reason: string) => errors.push(reason),
    });
    const a = new WebRtcTransfer(skA, handlers(toB));
    const b = new WebRtcTransfer(skB, handlers(toA));

    a.connect(pkB);
    b.connect(pkA);
    await settle(); // 兩邊的 offer 都已送出、還沒收到對方的
    // 信令來回送到沒有新信令為止（交錯：一次把雙方佇列都送出去）
    for (let round = 0; round < 10 && (toA.length > 0 || toB.length > 0); round++) {
      const forA = toA.splice(0);
      const forB = toB.splice(0);
      for (const e of forA) a.onSignalEvent(e);
      for (const e of forB) b.onSignalEvent(e);
      await settle();
    }

    expect(errors).toEqual([]);
    const [pcA, pcB] = StrictPc.all;
    expect(pcA!.signalingState).toBe("stable");
    expect(pcB!.signalingState).toBe("stable");
    expect(pcA!.remoteDescription).not.toBeNull();
    expect(pcB!.remoteDescription).not.toBeNull();
    // 只有一顆 offer 被採用：一邊的描述是 offer、另一邊是 answer
    expect(new Set([pcA!.remoteDescription!.type, pcB!.remoteDescription!.type])).toEqual(new Set(["offer", "answer"]));
  });

  it("過期的 answer（已經不在等 answer）→ 安靜略過，不在對話裡報錯", async () => {
    vi.stubGlobal("RTCPeerConnection", StrictPc);
    StrictPc.all = [];
    const skA = generateSecretKey();
    const skB = generateSecretKey();
    const errors: string[] = [];
    const toA: NostrEvent[] = [];
    const sink: NostrEvent[] = [];
    const a = new WebRtcTransfer(skA, {
      publishSignal: (e) => sink.push(e),
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: (_pk, reason) => errors.push(reason),
    });
    const b = new WebRtcTransfer(skB, {
      publishSignal: (e) => toA.push(e),
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: () => {},
    });
    // B 收到一顆 A 的 offer 並回 answer，但 A 從沒送過 offer（例如重開 App 之後）→ A 收到的是過期 answer
    const offerFromA = new WebRtcTransfer(skA, {
      publishSignal: (e) => b.onSignalEvent(e),
      onOutgoingProgress: () => {},
      onIncoming: () => {},
      onError: () => {},
    });
    offerFromA.connect(getPublicKey(skB));
    await settle();
    const answers = toA.splice(0);
    expect(answers.length).toBeGreaterThan(0);
    for (const e of answers) a.onSignalEvent(e);
    await settle();
    expect(errors).toEqual([]);
  });
});
