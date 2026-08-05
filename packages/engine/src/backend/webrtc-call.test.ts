import type { CallFailureReason, PubkeyHex } from "@cinderous/core";
import { createCallSignal, generateSecretKey, getPublicKey } from "@cinderous/core";
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
  async replaceTrack(t: FakeTrack | null): Promise<void> {
    this.track = t;
  }
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

// ── 通話中語音↔視訊升降級（ADR-0338）──────────────────────────────────────

/**
 * 忠於真實 `RTCRtpTransceiver`：**恆有 `receiver.track`**（即使本端還沒送任何東西），
 * 而 `sender.track` 在預先協商但未上軌時是 `null`。實作正是靠這個差別找到視訊 transceiver。
 */
class Transceiver {
  direction = "recvonly";
  receiver: { track: { kind: string } };
  constructor(
    public kind: string,
    public sender: FakeSender,
  ) {
    this.receiver = { track: { kind } };
  }
}

class NegoPc extends FakePc {
  transceivers: Transceiver[] = [];
  senders: FakeSender[] = [];
  /** 依規格：`addTrack` 會**重用**同 kind、尚未上軌的 transceiver，不是無腦新增。 */
  override addTrack(track: FakeTrack): FakeSender {
    const reuse = this.transceivers.find((t) => t.kind === track.kind && t.sender.track === null);
    if (reuse) {
      reuse.sender.track = track;
      return reuse.sender;
    }
    const s = new FakeSender(track);
    this.senders.push(s);
    this.transceivers.push(new Transceiver(track.kind, s));
    return s;
  }
  addTransceiver(kind: string, init?: { direction?: string }): Transceiver {
    const s = new FakeSender(null);
    const t = new Transceiver(kind, s);
    if (init?.direction) t.direction = init.direction;
    this.transceivers.push(t);
    this.senders.push(s);
    return t;
  }
  getTransceivers(): Transceiver[] {
    return this.transceivers;
  }
  override getSenders(): FakeSender[] {
    return this.senders;
  }
}

describe("通話中媒體升降級（ADR-0338）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = (media: "audio" | "video", tracks: string[]) => {
    order = [];
    const published: unknown[] = [];
    const errors: string[] = [];
    let gumFails = false;
    vi.stubGlobal("RTCPeerConnection", NegoPc);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: { video?: unknown }) => {
          if (gumFails) throw new Error("NotAllowedError");
          const kinds = c.video ? tracks : tracks.filter((k) => k !== "video");
          const list = kinds.map((k) => new FakeTrack(k));
          return {
            getTracks: () => list,
            getVideoTracks: () => list.filter((t) => t.kind === "video"),
            getAudioTracks: () => list.filter((t) => t.kind === "audio"),
          };
        },
      },
    });
    lastPc = undefined;
    const mySk = generateSecretKey();
    const peerSk = generateSecretKey();
    const call = new WebRtcCall(mySk, {
      publishCallSignal: (e) => published.push(e),
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: (r) => errors.push(r),
      onFailed: () => {},
    });
    call.startCall(getPublicKey(peerSk), media);
    return { call, published, errors, mySk, peerSk, failGum: () => void (gumFails = true) };
  };

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  /**
   * 推進到 active（主叫視角）。
   *
   * ⚠ 必須先收到對端的 `call-accept`——否則 session 停在 `outgoing`，
   * `onConnected()` 依設計回傳空動作，狀態機正確地擋掉一切型態變更。
   */
  const activate = async (
    call: WebRtcCall,
    ctx: { mySk: Uint8Array; peerSk: Uint8Array },
  ): Promise<void> => {
    await flush();
    call.onCallSignalEvent(
      createCallSignal(
        { type: "call-accept", callId: callIdOf(call), sdp: "remote-answer" },
        ctx.peerSk,
        getPublicKey(ctx.mySk),
      ),
    );
    await flush();
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
    await flush();
  };

  /** 取這通的 callId（由執行期產生，測試不預先知道）。 */
  const callIdOf = (call: WebRtcCall): string =>
    (call as unknown as { session: { activeCallId: string } }).session.activeCallId;

  it("🔴 語音通話也要預先協商視訊 transceiver——否則之後升不了級", async () => {
    setup("audio", ["audio", "video"]);
    await flush();
    const pc = lastPc as unknown as NegoPc;
    const video = pc.transceivers.filter((t) => t.kind === "video");
    expect(video).toHaveLength(1);
    // sendrecv 而非 recvonly：兩個方向都要能送（ADR-0338 §3）。
    expect(video[0]!.direction).toBe("sendrecv");
  });

  it("語音通話**不取用相機**——預先協商不等於開鏡頭", async () => {
    const c = setup("audio", ["audio", "video"]);
    const { call } = c;
    await activate(call, c);
    const pc = lastPc as unknown as NegoPc;
    const withTrack = pc.transceivers.filter((t) => t.kind === "video" && t.sender.track !== null);
    expect(withTrack).toEqual([]);
  });

  it("🔴 答方套用遠端 offer 後必須把視訊 transceiver 設成 sendrecv（否則永遠送不出視訊）", async () => {
    // 走真正的被叫路徑：收 invite → accept → exec("set-remote", kind:"offer")。
    order = [];
    vi.stubGlobal("RTCPeerConnection", NegoPc);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          const list = [new FakeTrack("audio")];
          return { getTracks: () => list, getVideoTracks: () => [], getAudioTracks: () => list };
        },
      },
    });
    lastPc = undefined;
    const mySk = generateSecretKey();
    const callerSk = generateSecretKey();
    const call = new WebRtcCall(mySk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: () => {},
    });
    call.onCallSignalEvent(
      createCallSignal(
        { type: "call-invite", callId: "c1", media: "audio", sdp: "remote-offer" },
        callerSk,
        getPublicKey(mySk),
      ),
    );
    await flush();
    const pc = lastPc as unknown as NegoPc;
    // 模擬瀏覽器於 setRemoteDescription(offer) 自動建立的 recvonly transceiver。
    const auto = pc.addTransceiver("video", { direction: "recvonly" });
    call.accept();
    await flush();
    // exec("set-remote", kind:"offer") 之後統一校正方向——不校正就永遠送不出視訊。
    expect(auto.direction).toBe("sendrecv");
    expect(pc.transceivers.filter((t) => t.kind === "video").every((t) => t.direction === "sendrecv")).toBe(
      true,
    );
  });

  it("升級：取視訊軌 → replaceTrack 到既有 sender → 通知對端", async () => {
    const c = setup("audio", ["audio", "video"]);
    const { call, published, errors } = c;
    await activate(call, c);
    published.length = 0;
    call.setLocalMedia("video");
    await flush();
    const pc = lastPc as unknown as NegoPc;
    const vs = pc.transceivers.find((t) => t.kind === "video")!.sender;
    expect(errors).toEqual([]);
    expect(vs.track?.kind).toBe("video"); // 換上去了
    expect(published).toHaveLength(1); // 通知對端
    expect(call.localMedia).toBe("video");
  });

  it("降級：replaceTrack(null) 並**真的停掉相機**（與 ADR-0337 的關鏡頭不同）", async () => {
    const c = setup("video", ["audio", "video"]);
    const { call } = c;
    await activate(call, c);
    const pc = lastPc as unknown as NegoPc;
    const before = pc.transceivers.find((t) => t.kind === "video")!.sender.track!;
    let stopped = false;
    before.stop = () => void (stopped = true);
    call.setLocalMedia("audio");
    await flush();
    expect(pc.transceivers.find((t) => t.kind === "video")!.sender.track).toBeNull();
    expect(stopped, "降級要 stop() 相機，不只是送黑畫面").toBe(true);
  });

  it("🔴 取媒體失敗（不給相機權限）→ 不通知對端，型態退回語音", async () => {
    const c = setup("audio", ["audio", "video"]);
    const { call, published, failGum } = c;
    await activate(call, c);
    published.length = 0;
    failGum();
    call.setLocalMedia("video");
    await flush();
    // 先宣告後失敗會讓對端等一個永遠不會來的畫面（ADR-0338 §6-3）。
    expect(published).toEqual([]);
    expect(call.localMedia).toBe("audio");
  });

  it("沒有視訊 sender（舊版對端）→ canChangeMedia 為 false，UI 據此不顯示入口", async () => {
    const c = setup("audio", ["audio", "video"]);
    const { call } = c;
    await activate(call, c);
    const pc = lastPc as unknown as NegoPc;
    pc.transceivers = pc.transceivers.filter((t) => t.kind !== "video");
    pc.senders = pc.senders.filter((s) => s.track?.kind !== "video" && s.track !== null);
    expect(call.canChangeMedia()).toBe(false);
  });

  it("有視訊 sender → canChangeMedia 為 true", async () => {
    const c = setup("audio", ["audio", "video"]);
    const { call } = c;
    await activate(call, c);
    expect(call.canChangeMedia()).toBe(true);
  });

  it("非 active 時改型態無效（狀態機擋掉，執行期不動軌道）", async () => {
    const { call, published } = setup("audio", ["audio", "video"]);
    await flush(); // 尚未 connected ⇒ outgoing
    published.length = 0;
    call.setLocalMedia("video");
    await flush();
    expect(published).toEqual([]);
  });
});
