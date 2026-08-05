import type { CallFailureReason, PubkeyHex } from "@cinderous/core";
import { generateSecretKey, getPublicKey } from "@cinderous/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebRtcCall } from "./webrtc-call.js";

// 最小 RTCPeerConnection 樁：捕捉最後建立的 pc，供測試手動觸發連上/失敗（node 無真實 WebRTC）。
let lastPc: FakePc | undefined;
class FakePc {
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = "new";
  constructor() {
    lastPc = this;
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
  addTrack(_track?: unknown): unknown {
    return undefined;
  }
  getSenders(): unknown[] {
    return [];
  }
  close(): void {}
}

describe("WebRtcCall 通話失敗提示（ADR-0243）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    vi.stubGlobal("RTCPeerConnection", FakePc);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    lastPc = undefined;
    const failed: Array<[PubkeyHex, CallFailureReason]> = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const call = new WebRtcCall(sk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: (p, reason) => failed.push([p, reason]),
    });
    call.startCall(peer, "audio"); // ensurePc 同步建立 pc 並掛好 onconnectionstatechange
    return { peer, failed };
  };

  it("連線從未打通就失敗 → onFailed(peer, 'unreachable')（限制網路提示）", () => {
    const { peer, failed } = setup();
    lastPc!.connectionState = "failed";
    lastPc!.onconnectionstatechange!();
    expect(failed).toEqual([[peer, "unreachable"]]);
  });

  it("已連上後中途斷線 → onFailed(peer, 'lost')", () => {
    const { peer, failed } = setup();
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
    lastPc!.connectionState = "failed";
    lastPc!.onconnectionstatechange!();
    expect(failed).toEqual([[peer, "lost"]]);
  });

  it("連上但未失敗 → 不提示", () => {
    const { failed } = setup();
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
    expect(failed).toEqual([]);
  });
});

// ── 視訊畫質三檔（ADR-0337）────────────────────────────────────────────────

/** 記錄呼叫順序：ADR-0337 §2 要求「先降 bitrate 再降解析度」。 */
let order: string[] = [];

class FakeTrack {
  kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  enabled = true;
  stop(): void {}
  async applyConstraints(c: unknown): Promise<void> {
    order.push(`constraints:${JSON.stringify(c)}`);
  }
}

class FakeSender {
  params: Record<string, unknown> = { encodings: [{}] };
  constructor(public track: FakeTrack | null) {}
  getParameters(): Record<string, unknown> {
    return this.params;
  }
  async setParameters(p: Record<string, unknown>): Promise<void> {
    this.params = p;
    order.push(`bitrate:${(p.encodings as Array<{ maxBitrate?: number }>)[0]?.maxBitrate}`);
  }
}

class VideoPc extends FakePc {
  senders: FakeSender[] = [];
  override addTrack(track: FakeTrack): FakeSender {
    const s = new FakeSender(track);
    this.senders.push(s);
    return s;
  }
  override getSenders(): FakeSender[] {
    return this.senders;
  }
}

describe("視訊畫質三檔（ADR-0337）", () => {
  afterEach(() => vi.unstubAllGlobals());

  // `quality` 於 startCall **之前**設定——這正是實際用法：App 啟動時以裝置偏好設好，
  // 之後每通沿用。（在 startCall 之後設會與非同步的 acquireMedia 賽跑，那是另一條路徑。）
  const setup = (media: "audio" | "video", tracks: string[], quality?: "low" | "medium" | "high") => {
    order = [];
    let asked: unknown = null;
    vi.stubGlobal("RTCPeerConnection", VideoPc);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: unknown) => {
          asked = c;
          const list = tracks.map((k) => new FakeTrack(k));
          return { getTracks: () => list, getVideoTracks: () => list.filter((t) => t.kind === "video") };
        },
      },
    });
    lastPc = undefined;
    const call = new WebRtcCall(generateSecretKey(), {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: () => {},
    });
    if (quality) call.setVideoQuality(quality);
    call.startCall(getPublicKey(generateSecretKey()), media);
    return { call, asked: () => asked };
  };

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };

  it("視訊通話：getUserMedia 帶上該檔位的解析度約束，不是裸 true", async () => {
    const { asked } = setup("video", ["audio", "video"], "high");
    await flush();
    expect(asked()).toEqual({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  });

  it("視訊通話：加軌後對視訊 sender 套上 maxBitrate 與 degradationPreference", async () => {
    setup("video", ["audio", "video"], "low");
    await flush();
    const pc = lastPc as unknown as VideoPc;
    const vs = pc.senders.find((s) => s.track?.kind === "video")!;
    expect((vs.params.encodings as Array<{ maxBitrate?: number }>)[0]!.maxBitrate).toBe(150_000);
    // 視訊通話是看人臉：掉解析度比掉幀順眼（ADR-0337 §2）。
    expect(vs.params.degradationPreference).toBe("maintain-framerate");
  });

  it("語音通話不碰音訊 sender 的位元率", async () => {
    setup("audio", ["audio"]);
    await flush();
    const pc = lastPc as unknown as VideoPc;
    const as = pc.senders.find((s) => s.track?.kind === "audio")!;
    expect(as.params.degradationPreference).toBeUndefined();
    expect(order.filter((o) => o.startsWith("bitrate:"))).toEqual([]);
  });

  it("🔴 通話中改檔位：先降 bitrate、再降解析度（反過來會有一段高位元率低畫質的浪費）", async () => {
    const { call } = setup("video", ["audio", "video"]);
    await flush();
    order = [];
    call.setVideoQuality("low");
    await flush();
    const bitrateAt = order.findIndex((o) => o === "bitrate:150000");
    const constraintsAt = order.findIndex((o) => o.startsWith("constraints:"));
    expect(bitrateAt).toBeGreaterThanOrEqual(0);
    expect(constraintsAt).toBeGreaterThanOrEqual(0);
    expect(bitrateAt).toBeLessThan(constraintsAt);
  });

  it("通話中改檔位會真的改到擷取解析度", async () => {
    const { call } = setup("video", ["audio", "video"]);
    await flush();
    order = [];
    call.setVideoQuality("high");
    await flush();
    expect(order.some((o) => o.includes('"ideal":1280'))).toBe(true);
  });

  it("setParameters 失敗不得拖垮通話（畫質是加分項，不是通話前提）", async () => {
    const { call } = setup("video", ["audio", "video"]);
    await flush();
    const pc = lastPc as unknown as VideoPc;
    for (const s of pc.senders) s.setParameters = async () => { throw new Error("boom"); };
    expect(() => call.setVideoQuality("high")).not.toThrow();
    await flush();
  });
});
