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
  /** 供審查 #3 的迴歸測試斷言「相機真的被停掉」。 */
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
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
  /** 真實瀏覽器：進了 SDP（協商過）才有 mid；自己 `addTransceiver` 卻沒被 offer 採用的那條恆為 null。 */
  mid: string | null = null;
  /** 真實瀏覽器：`stop()` 之後方向變成 "stopped"，`addTrack` 也不會再重用它。 */
  stop(): void {
    this.direction = "stopped";
  }
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
    // ⚠ 照 Chrome 實測（2026-11-17）：挑的是**第一條**同 kind、沒上軌的——就算它已經停了，
    // 然後丟 InvalidAccessError「The existing transceiver is stopping」，不會跳過去找下一條。
    const reuse = this.transceivers.find((t) => t.kind === track.kind && t.sender.track === null);
    if (reuse?.direction === "stopped") throw new Error("InvalidAccessError: The existing transceiver is stopping");
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
    auto.mid = "0"; // 瀏覽器為 offer 的 m-line 建的：協商過，有 mid
    call.accept();
    await flush();
    // exec("set-remote", kind:"offer") 之後統一校正方向——不校正就永遠送不出視訊。
    expect(auto.direction).toBe("sendrecv");
    expect(pc.transceivers.filter((t) => t.kind === "video" && t.mid !== null).every((t) => t.direction === "sendrecv")).toBe(
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

  it("🔴 審查 #3：換軌失敗必須停掉已取得的相機軌（否則指示燈留著亮）", async () => {
    const c = setup("audio", ["audio", "video"]);
    const { call, published } = c;
    await activate(call, c);
    const pc = lastPc as unknown as NegoPc;
    const sender = pc.transceivers.find((t) => t.kind === "video")!.sender;
    sender.replaceTrack = async () => {
      throw new Error("replaceTrack failed");
    };
    // 換上自己的取媒體樁，好抓住「發出去的那條軌」有沒有被停掉。
    const handed: FakeTrack[] = [];
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          const t = new FakeTrack("video");
          handed.push(t);
          return {
            getTracks: () => [t],
            getVideoTracks: () => [t],
            getAudioTracks: () => [],
            addTrack: () => {},
            removeTrack: () => {},
          };
        },
      },
    });
    published.length = 0;
    call.setLocalMedia("video");
    await flush();
    // ADR-0340 的整個主張就是「指示燈要誠實」——取到相機後任何失敗都得把它停掉。
    expect(handed.length, "應該有取過相機").toBeGreaterThan(0);
    expect(handed.filter((t) => !t.stopped), "失敗後不得留著沒停的相機軌").toEqual([]);
    expect(published, "失敗就不該通知對端").toEqual([]);
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

// ── 切換鏡頭（ADR-0339）────────────────────────────────────────────────────

describe("切換鏡頭（ADR-0339）", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 記錄取媒體的約束與軌道生命週期。 */
  const setup = () => {
    order = [];
    const asked: Array<{ video?: { facingMode?: { ideal: string }; deviceId?: { exact: string } } }> = [];
    const madeTracks: FakeTrack[] = [];
    vi.stubGlobal("RTCPeerConnection", NegoPc);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: { video?: unknown; audio?: unknown }) => {
          asked.push(c as never);
          const kinds = c.video ? (c.audio ? ["audio", "video"] : ["video"]) : ["audio"];
          const list = kinds.map((k) => {
            const t = new FakeTrack(k);
            if (k === "video") madeTracks.push(t);
            return t;
          });
          return {
            getTracks: () => list,
            getVideoTracks: () => list.filter((t) => t.kind === "video"),
            getAudioTracks: () => list.filter((t) => t.kind === "audio"),
            addTrack: () => {},
            removeTrack: () => {},
          };
        },
      },
    });
    lastPc = undefined;
    const mySk = generateSecretKey();
    const peerSk = generateSecretKey();
    const facings: Array<string | null> = [];
    const call = new WebRtcCall(mySk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onCamera: (f) => facings.push(f),
      onError: () => {},
      onFailed: () => {},
    });
    call.startCall(getPublicKey(peerSk), "video");
    return { call, asked, madeTracks, facings, mySk, peerSk };
  };

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  const activate = async (c: { call: WebRtcCall; mySk: Uint8Array; peerSk: Uint8Array }): Promise<void> => {
    await flush();
    const callId = (c.call as unknown as { session: { activeCallId: string } }).session.activeCallId;
    c.call.onCallSignalEvent(
      createCallSignal({ type: "call-accept", callId, sdp: "a" }, c.peerSk, getPublicKey(c.mySk)),
    );
    await flush();
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
    await flush();
  };

  it("切鏡頭時把選擇帶進 getUserMedia 的約束", async () => {
    const c = setup();
    await activate(c);
    c.asked.length = 0;
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    expect(c.asked[0]?.video?.facingMode).toEqual({ ideal: "environment" });
  });

  it("桌面選裝置：deviceId 以 exact 帶入", async () => {
    const c = setup();
    await activate(c);
    c.asked.length = 0;
    c.call.setCamera({ deviceId: "cam-2" });
    await flush();
    expect(c.asked[0]?.video?.deviceId).toEqual({ exact: "cam-2" });
  });

  it("🔴 換鏡頭必須停掉舊軌——不停就是兩個相機同時開著、指示燈全亮", async () => {
    const c = setup();
    await activate(c);
    const old = c.madeTracks[0]!;
    let stopped = false;
    old.stop = () => void (stopped = true);
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    expect(stopped).toBe(true);
  });

  it("🔴 順序：先取新軌 → replaceTrack → **才**停舊軌", async () => {
    const c = setup();
    await activate(c);
    const pc = lastPc as unknown as NegoPc;
    const sender = pc.transceivers.find((t) => t.kind === "video")!.sender;
    const old = c.madeTracks[0]!;
    const seq: string[] = [];
    old.stop = () => void seq.push("stop-old");
    const origReplace = sender.replaceTrack.bind(sender);
    sender.replaceTrack = async (t) => {
      seq.push("replace");
      await origReplace(t);
    };
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    // 反過來會有一段沒有畫面的空窗，而且新軌取失敗時就回不去了。
    expect(seq).toEqual(["replace", "stop-old"]);
  });

  it("換上去的是新軌，不是原本那條", async () => {
    const c = setup();
    await activate(c);
    const pc = lastPc as unknown as NegoPc;
    const sender = pc.transceivers.find((t) => t.kind === "video")!.sender;
    const old = sender.track;
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    expect(sender.track).not.toBe(old);
    expect(sender.track?.kind).toBe("video");
  });

  it("🔴 取新軌失敗 → 舊軌留著不動（不能把使用者的畫面弄不見）", async () => {
    const c = setup();
    await activate(c);
    const pc = lastPc as unknown as NegoPc;
    const sender = pc.transceivers.find((t) => t.kind === "video")!.sender;
    const old = sender.track!;
    let stopped = false;
    old.stop = () => void (stopped = true);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => { throw new Error("NotFoundError"); } },
    });
    c.call.setCamera({ deviceId: "unplugged" });
    await flush();
    expect(sender.track, "失敗後仍是舊軌").toBe(old);
    expect(stopped, "失敗時不得停掉舊軌").toBe(false);
  });

  // 🔴 實機發現（2026-11-17，moto edge 20 pro）：前鏡頭開著時開後鏡頭 → NotReadableError。
  // 多數 Android 手機不能同時開兩顆鏡頭，「先取新軌」在那些手機上**永遠**切不過去。
  const busy = (): Error => Object.assign(new Error("Could not start video source"), { name: "NotReadableError" });

  /** 只有在 `old` 停掉之後才開得了新鏡頭；`deny(sel)` 為真的選擇一律開不了。 */
  const oneCameraAtATime = (old: FakeTrack, made: FakeTrack[], deny: (c: { video?: { facingMode?: unknown } }) => boolean): void => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: { video?: { facingMode?: unknown } }) => {
          if (!old.stopped || deny(c)) throw busy();
          const t = new FakeTrack("video");
          made.push(t);
          return { getTracks: () => [t], getVideoTracks: () => [t], getAudioTracks: () => [] };
        },
      },
    });
  };

  it("🔴 鏡頭忙碌（不能同時開兩顆）→ 改成先停舊軌再開新軌，切得過去", async () => {
    const c = setup();
    await activate(c);
    const sender = (lastPc as unknown as NegoPc).transceivers.find((t) => t.kind === "video")!.sender;
    const old = sender.track!;
    const made: FakeTrack[] = [];
    oneCameraAtATime(old, made, () => false);
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    await flush();
    expect(old.stopped).toBe(true);
    expect(made).toHaveLength(1);
    expect(sender.track).toBe(made[0]);
  });

  it("🔴 停了舊軌、新鏡頭還是開不了 → 用原本的鏡頭重開，畫面不能就此消失", async () => {
    const c = setup();
    await activate(c);
    const sender = (lastPc as unknown as NegoPc).transceivers.find((t) => t.kind === "video")!.sender;
    const old = sender.track!;
    const made: FakeTrack[] = [];
    oneCameraAtATime(old, made, (k) => JSON.stringify(k.video?.facingMode ?? null).includes("environment"));
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    await flush();
    expect(made).toHaveLength(1); // 重開的是原本那顆
    expect(sender.track).toBe(made[0]);
    expect(c.call.localMedia).toBe("video");
  });

  it("連原本的鏡頭都開不了 → 正式降級成語音（通知對方），而不是送一條死掉的軌", async () => {
    const c = setup();
    await activate(c);
    const sender = (lastPc as unknown as NegoPc).transceivers.find((t) => t.kind === "video")!.sender;
    const old = sender.track!;
    oneCameraAtATime(old, [], () => true);
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    await flush();
    expect(sender.track).toBeNull();
    expect(c.call.localMedia).toBe("audio");
  });

  it("🔴 朝向以**實際取得的軌**回報，不是以我要求了什麼（facingMode 是偏好非保證）", async () => {
    const c = setup();
    await activate(c);
    c.facings.length = 0;
    // 裝置只有前鏡頭：要求 environment，實際仍給 user。
    const t = new FakeTrack("video");
    (t as unknown as { getSettings(): unknown }).getSettings = () => ({ facingMode: "user" });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [t],
          getVideoTracks: () => [t],
          getAudioTracks: () => [],
          addTrack: () => {},
          removeTrack: () => {},
        }),
      },
    });
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    expect(c.facings.at(-1)).toBe("user");
  });

  it("裝置不回報朝向 → null（UI 據此當作前鏡頭）", async () => {
    const c = setup();
    await activate(c);
    c.facings.length = 0;
    c.call.setCamera({ facingMode: "user" });
    await flush();
    expect(c.facings.at(-1)).toBeNull();
  });

  it("沒在送視訊時切鏡頭不做事（沒有軌可換）", async () => {
    const c = setup();
    await activate(c);
    c.call.setLocalMedia("audio");
    await flush();
    c.asked.length = 0;
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    expect(c.asked).toEqual([]);
  });

  it("選擇會沿用到下次開視訊（升級時不必再選一次）", async () => {
    const c = setup();
    await activate(c);
    c.call.setCamera({ facingMode: "environment" });
    await flush();
    c.call.setLocalMedia("audio");
    await flush();
    c.asked.length = 0;
    c.call.setLocalMedia("video");
    await flush();
    expect(c.asked[0]?.video?.facingMode).toEqual({ ideal: "environment" });
  });
});

// ── ADR-0344：通話的 ICE 路徑判定 ──────────────────────────────────────────
//
// 通話正是 ADR-0243 成本論證的主體——「少數通話 × 小頻寬 = 很小」成立的前提，是它真的
// 只有走 TURN 的那幾通才計費；而在此之前程式從來不知道是哪幾通。

const CALL_RELAY_STATS = [
  { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
  { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
  { id: "L1", type: "local-candidate", candidateType: "relay" },
  { id: "R1", type: "remote-candidate", candidateType: "srflx" },
];

const CALL_DIRECT_STATS = [
  { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
  { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
  { id: "L1", type: "local-candidate", candidateType: "srflx" },
  { id: "R1", type: "remote-candidate", candidateType: "srflx" },
];

class CallStatsPc extends FakePc {
  static stats: unknown[] = CALL_DIRECT_STATS;
  getStats(): Promise<unknown[]> {
    return Promise.resolve(CallStatsPc.stats);
  }
}

describe("WebRtcCall ICE 路徑判定（ADR-0344）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    vi.stubGlobal("RTCPeerConnection", CallStatsPc);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    lastPc = undefined;
    const paths: Array<[PubkeyHex, string]> = [];
    const sk = generateSecretKey();
    const peer = getPublicKey(generateSecretKey());
    const call = new WebRtcCall(sk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: () => {},
      onIcePath: (p, path) => paths.push([p, path]),
    });
    call.startCall(peer, "audio");
    return { call, peer, paths };
  };

  /** 讓 pc 進入 connected（同 ADR-0243 既有測試的手法）。 */
  const connect = () => {
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
  };

  it("尚未連上 → icePath 為 unknown", () => {
    CallStatsPc.stats = CALL_RELAY_STATS;
    const { call } = setup();
    expect(call.icePath()).toBe("unknown");
  });

  it("連上且走 TURN → onIcePath(peer, 'relay')，icePath() 查得到", async () => {
    CallStatsPc.stats = CALL_RELAY_STATS;
    const { call, peer, paths } = setup();
    connect();
    expect(await call.refreshIcePath()).toBe("relay");
    expect(call.icePath()).toBe("relay");
    expect(paths).toEqual([[peer, "relay"]]);
  });

  it("連上且為直連 → onIcePath(peer, 'direct')", async () => {
    CallStatsPc.stats = CALL_DIRECT_STATS;
    const { call, peer, paths } = setup();
    connect();
    expect(await call.refreshIcePath()).toBe("direct");
    expect(paths).toEqual([[peer, "direct"]]);
  });

  it("結果沒變不重複回報", async () => {
    CallStatsPc.stats = CALL_RELAY_STATS;
    const { call, paths } = setup();
    connect();
    await call.refreshIcePath();
    await call.refreshIcePath();
    expect(paths).toHaveLength(1);
  });

  it("連上後自動探測（排程），不必手動 refresh", async () => {
    vi.useFakeTimers();
    try {
      CallStatsPc.stats = CALL_RELAY_STATS;
      const { peer, paths } = setup();
      connect();
      await vi.advanceTimersByTimeAsync(50);
      expect(paths).toEqual([[peer, "relay"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("掛斷後路徑歸零，且排程中的探測不再回報（不得把這通的判定帶到下一通）", async () => {
    vi.useFakeTimers();
    try {
      CallStatsPc.stats = CALL_RELAY_STATS;
      const { call, paths } = setup();
      connect();
      call.hangup();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(paths).toEqual([]);
      expect(call.icePath()).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("連線失敗（走既有的掛斷收尾路徑）同樣歸零", async () => {
    CallStatsPc.stats = CALL_RELAY_STATS;
    const { call } = setup();
    connect();
    await call.refreshIcePath();
    lastPc!.connectionState = "failed";
    lastPc!.onconnectionstatechange!();
    expect(call.icePath()).toBe("unknown");
  });

  it("沒有 getStats 的舊 webview → unknown，不當機", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePc); // 無 getStats
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    const sk = generateSecretKey();
    const call = new WebRtcCall(sk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: () => {},
    });
    call.startCall(getPublicKey(generateSecretKey()), "audio");
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
    expect(await call.refreshIcePath()).toBe("unknown");
  });
});

// ── 實機發現（2026-11-17，桌面 ↔ Android 實測）────────────────────────────
// 這三個都是 FakePc 照「我們對規格的理解」寫、所以測不出來的地方：
//   1. 預先鋪的視訊 transceiver 沒有綁 stream ⇒ 對端 `ontrack` 的 `ev.streams` 是空的；
//   2. 答方自己 `addTransceiver` 的那條**不會**被 offer 採用（JSEP：只有 addTrack 建的會被重用），
//      於是答方有兩條視訊 transceiver，第一條 mid=null、沒進 SDP；
//   3. 升級是對**同一個** localStream 加軌，畫面元件收不到「換了」的訊號。
describe("通話視訊實機發現（2026-11-17）", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 真實 MediaStream 的最小替身：建構時帶軌、`getTracks` 回傳。 */
  class FakeStream {
    constructor(private tracks: FakeTrack[] = []) {}
    getTracks(): FakeTrack[] {
      return [...this.tracks];
    }
    getVideoTracks(): FakeTrack[] {
      return this.tracks.filter((t) => t.kind === "video");
    }
    getAudioTracks(): FakeTrack[] {
      return this.tracks.filter((t) => t.kind === "audio");
    }
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  const stubMedia = (): void => {
    vi.stubGlobal("RTCPeerConnection", NegoPc);
    vi.stubGlobal("MediaStream", FakeStream);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: { video?: unknown }) =>
          new FakeStream(c.video ? [new FakeTrack("video")] : [new FakeTrack("audio")]),
      },
    });
  };

  /** 被叫：收 invite → 模擬瀏覽器為 offer 的視訊 m-line 建的 transceiver（mid 已指派）→ 接聽 → 連上。 */
  const answerer = async () => {
    stubMedia();
    lastPc = undefined;
    const mySk = generateSecretKey();
    const callerSk = generateSecretKey();
    const locals: MediaStream[] = [];
    const remotes: MediaStream[] = [];
    const call = new WebRtcCall(mySk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: (s) => void (s && locals.push(s)),
      onRemoteStream: (s) => void (s && remotes.push(s)),
      onError: () => {},
      onFailed: () => {},
    });
    call.onCallSignalEvent(
      createCallSignal({ type: "call-invite", callId: "c1", media: "audio", sdp: "remote-offer" }, callerSk, getPublicKey(mySk)),
    );
    await flush();
    const pc = lastPc as unknown as NegoPc;
    const own = pc.transceivers.find((t) => t.kind === "video")!; // ensurePc 自己鋪的（沒進 SDP）
    const fromOffer = pc.addTransceiver("video", { direction: "recvonly" });
    fromOffer.mid = "0";
    call.accept();
    await flush();
    pc.connectionState = "connected";
    pc.onconnectionstatechange!();
    await flush();
    return { call, pc, own, fromOffer, locals, remotes };
  };

  it("🔴 答方開視訊要換到**協商過**的那條 transceiver——換到自己鋪的那條，對方永遠收不到", async () => {
    const { call, own, fromOffer } = await answerer();
    call.setLocalMedia("video");
    await flush();
    expect(fromOffer.sender.track?.kind).toBe("video");
    expect(own.sender.track).toBeNull();
  });

  it("🔴 對方的視訊軌沒有帶 stream（升級用的 transceiver）也要放進遠端串流", async () => {
    const { pc, remotes } = await answerer();
    const audio = new FakeTrack("audio");
    const video = new FakeTrack("video");
    const ontrack = pc.ontrack as (ev: { track: FakeTrack; streams: FakeStream[] }) => void;
    ontrack({ track: video, streams: [] }); // 預先鋪的視訊：msid 是 "-"
    ontrack({ track: audio, streams: [new FakeStream([audio])] });
    const last = remotes[remotes.length - 1]!;
    expect(last.getTracks().map((t) => t.kind).sort()).toEqual(["audio", "video"]);
  });

  it("🔴 開視訊後送出**新的**本地串流物件（同一個物件加軌，畫面元件不會重新接上）", async () => {
    const { call, locals } = await answerer();
    const before = locals[locals.length - 1]!;
    call.setLocalMedia("video");
    await flush();
    const after = locals[locals.length - 1]!;
    expect(after).not.toBe(before);
    expect(after.getTracks().map((t) => t.kind).sort()).toEqual(["audio", "video"]);
  });

  it("🔴 一開始就是視訊通話：答方的鏡頭要放在協商過的那條（以前 addTrack 重用了自己鋪的那條，對方看不到）", async () => {
    stubMedia();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: { video?: unknown }) =>
          new FakeStream(c.video ? [new FakeTrack("audio"), new FakeTrack("video")] : [new FakeTrack("audio")]),
      },
    });
    lastPc = undefined;
    const mySk = generateSecretKey();
    const call = new WebRtcCall(mySk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: () => {},
    });
    call.onCallSignalEvent(
      createCallSignal({ type: "call-invite", callId: "c2", media: "video", sdp: "remote-offer" }, generateSecretKey(), getPublicKey(mySk)),
    );
    await flush();
    const pc = lastPc as unknown as NegoPc;
    const own = pc.transceivers.find((t) => t.kind === "video")!;
    const fromOffer = pc.addTransceiver("video", { direction: "recvonly" });
    fromOffer.mid = "0";
    call.accept();
    await flush();
    await flush();
    expect(fromOffer.sender.track?.kind).toBe("video");
    expect(own.sender.track).toBeNull();
  });

  it("對方的 offer 沒有視訊（舊版）→ 不顯示升級入口，而不是一顆按了沒反應的按鈕", async () => {
    stubMedia();
    lastPc = undefined;
    const mySk = generateSecretKey();
    const call = new WebRtcCall(mySk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: () => {},
      onFailed: () => {},
    });
    call.onCallSignalEvent(
      createCallSignal({ type: "call-invite", callId: "c3", media: "audio", sdp: "old-offer" }, generateSecretKey(), getPublicKey(mySk)),
    );
    await flush();
    call.accept();
    await flush();
    expect(call.canChangeMedia()).toBe(false);
  });

  it("關視訊後本地串流只剩音訊，且也是新物件", async () => {
    const { call, locals } = await answerer();
    call.setLocalMedia("video");
    await flush();
    const withVideo = locals[locals.length - 1]!;
    call.setLocalMedia("audio");
    await flush();
    const after = locals[locals.length - 1]!;
    expect(after).not.toBe(withVideo);
    expect(after.getTracks().map((t) => t.kind)).toEqual(["audio"]);
  });
});

describe("程式碼審查（2026-11-18）：取麥克風／鏡頭晚回來、連按換鏡頭", () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeStream {
    constructor(private tracks: FakeTrack[] = []) {}
    getTracks(): FakeTrack[] {
      return [...this.tracks];
    }
    getVideoTracks(): FakeTrack[] {
      return this.tracks.filter((t) => t.kind === "video");
    }
    getAudioTracks(): FakeTrack[] {
      return this.tracks.filter((t) => t.kind === "audio");
    }
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  /** getUserMedia 可以「卡在權限提示」：hold() 之後的呼叫要等 release() 才回來 */
  const stubMedia = () => {
    const made: FakeTrack[] = [];
    let gate: Promise<void> | null = null;
    let open: () => void = () => {};
    vi.stubGlobal("RTCPeerConnection", NegoPc);
    vi.stubGlobal("MediaStream", FakeStream);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (c: { video?: unknown; audio?: unknown }) => {
          if (gate) await gate;
          const kinds = [...(c.audio ? ["audio"] : []), ...(c.video ? ["video"] : [])];
          const list = kinds.map((k) => new FakeTrack(k));
          made.push(...list);
          return new FakeStream(list);
        },
      },
    });
    return {
      made,
      live: () => made.filter((t) => !t.stopped),
      hold: () => {
        gate = new Promise<void>((r) => (open = r));
      },
      release: () => {
        gate = null;
        open();
      },
    };
  };

  const make = () => {
    lastPc = undefined;
    const mySk = generateSecretKey();
    const peerSk = generateSecretKey();
    const errors: string[] = [];
    const sent: Array<{ type: string; media?: string }> = [];
    const call = new WebRtcCall(mySk, {
      publishCallSignal: () => {},
      onState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
      onError: (m) => void errors.push(m),
      onFailed: () => {},
    });
    const peerSays = (signal: Record<string, unknown>) =>
      call.onCallSignalEvent(createCallSignal(signal as never, peerSk, getPublicKey(mySk)));
    return { call, mySk, peerSk, errors, sent, peerSays };
  };

  /** 撥出語音並讓對方接起、連上 */
  const activeAudio = async (m: ReturnType<typeof stubMedia>) => {
    const c = make();
    c.call.startCall(getPublicKey(c.peerSk), "audio");
    await flush();
    const callId = (c.call as unknown as { session: { activeCallId: string } }).session.activeCallId;
    c.peerSays({ type: "call-accept", callId, sdp: "a" });
    await flush();
    lastPc!.connectionState = "connected";
    lastPc!.onconnectionstatechange!();
    await flush();
    expect(m.live().map((t) => t.kind)).toEqual(["audio"]);
    return { ...c, callId };
  };

  it("🔴 接聽時還在等權限，對方就掛斷了：權限回來後麥克風與鏡頭都要關掉", async () => {
    const m = stubMedia();
    const c = make();
    c.peerSays({ type: "call-invite", callId: "c1", media: "video", sdp: "remote-offer" });
    await flush();
    m.hold();
    c.call.accept();
    await flush();
    c.peerSays({ type: "call-hangup", callId: "c1" });
    await flush();
    m.release();
    await flush();
    expect(m.made.length).toBeGreaterThan(0); // 真的取了（不是根本沒取）
    expect(m.live()).toEqual([]);
  });

  it("🔴 開視訊時還在等鏡頭，又按了關：鏡頭不能留著亮", async () => {
    const m = stubMedia();
    const c = await activeAudio(m);
    m.hold();
    c.call.setLocalMedia("video");
    await flush();
    c.call.setLocalMedia("audio");
    await flush();
    m.release();
    await flush();
    expect(m.live().map((t) => t.kind)).toEqual(["audio"]);
  });

  it("🔴 開視訊時還在等鏡頭，對方就掛斷了：鏡頭不能留著亮", async () => {
    const m = stubMedia();
    const c = await activeAudio(m);
    m.hold();
    c.call.setLocalMedia("video");
    await flush();
    c.peerSays({ type: "call-hangup", callId: c.callId });
    await flush();
    m.release();
    await flush();
    expect(m.live()).toEqual([]);
  });

  it("🔴 連按兩次換鏡頭：最後只有一顆鏡頭開著，送出去的就是那一顆", async () => {
    const m = stubMedia();
    const c = await activeAudio(m);
    c.call.setLocalMedia("video");
    await flush();
    m.hold();
    c.call.setCamera({ facingMode: "environment" });
    c.call.setCamera({ facingMode: "user" });
    await flush();
    m.release();
    for (let i = 0; i < 5; i++) await flush();
    const cams = m.live().filter((t) => t.kind === "video");
    expect(cams).toHaveLength(1);
    const pc = lastPc as unknown as NegoPc;
    expect(pc.senders.filter((s) => s.track?.kind === "video").map((s) => s.track)).toEqual(cams);
  });

  it("答方開機放鏡頭失敗（replaceTrack 丟例外）：鏡頭關掉、回報錯誤，通話照常（語音）", async () => {
    const m = stubMedia();
    const c = make();
    c.peerSays({ type: "call-invite", callId: "c1", media: "video", sdp: "remote-offer" });
    await flush();
    const pc = lastPc as unknown as NegoPc;
    const fromOffer = pc.addTransceiver("video", { direction: "recvonly" });
    fromOffer.mid = "0";
    fromOffer.sender.replaceTrack = async () => {
      throw new Error("InvalidStateError");
    };
    c.call.accept();
    for (let i = 0; i < 3; i++) await flush();
    expect(m.live().map((t) => t.kind)).toEqual(["audio"]);
    expect(c.errors.some((e) => e.includes("視訊"))).toBe(true);
  });
});
