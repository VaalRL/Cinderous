import {
  CallSession,
  createCallSignal,
  readCallSignal,
  type CallAction,
  type CallMedia,
  type CallSignal,
  type CallState,
  type NostrEvent,
  type PubkeyHex,
  type SecretKey,
} from "@cinderous/core";

/** 通話執行期對外事件。 */
export interface CallHandlers {
  /** 送出通話信令事件（kind 21002）到中繼站。 */
  publishCallSignal: (event: NostrEvent) => void;
  /** 通話狀態變化（peer 為對象、null 表示無通話）。 */
  onState: (peer: PubkeyHex | null, state: CallState, media: CallMedia | null) => void;
  /** 本端媒體串流（供自我預覽；null 表示已結束）。 */
  onLocalStream: (stream: MediaStream | null) => void;
  /** 遠端媒體串流（供播放；null 表示已結束）。 */
  onRemoteStream: (stream: MediaStream | null) => void;
  onError: (reason: string) => void;
}

/**
 * 把 core 的 {@link CallSession} 政策狀態機接上真實 `RTCPeerConnection` +
 * `getUserMedia`：控制信令走注入的 `publishCallSignal`（kind 21002，NIP-59 包封），
 * 媒體全程 P2P（DTLS 加密），單一通話槽。
 */
export class WebRtcCall {
  private session = new CallSession();
  private pc: RTCPeerConnection | null = null;
  private peer: PubkeyHex | null = null;
  private media: CallMedia | null = null;
  private localStream: MediaStream | null = null;
  private hasRemote = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private seq = 0;

  constructor(
    private readonly ownSk: SecretKey,
    private readonly handlers: CallHandlers,
    /** ICE 設定；可為函式以於每次建連時取當前值（企業強制 TURN 動態生效）。 */
    private readonly rtcConfig?: RTCConfiguration | (() => RTCConfiguration | undefined),
    /** 判斷某公鑰是否已被封鎖（封鎖者的通話信令一律忽略）。 */
    private readonly isBlocked: (pubkey: PubkeyHex) => boolean = () => false,
  ) {}

  private busy(): boolean {
    return this.session.state !== "idle" && this.session.state !== "ended";
  }

  /** 主叫：發起通話。 */
  startCall(peer: PubkeyHex, media: CallMedia): void {
    if (this.busy()) return;
    this.session = new CallSession();
    this.peer = peer;
    this.media = media;
    this.ensurePc();
    const callId = `nb-call-${Date.now()}-${this.seq++}`;
    void this.run(this.session.startCall(callId, media));
  }

  /** 被叫：接聽目前的來電。 */
  accept(): void {
    void this.run(this.session.accept());
  }

  /** 被叫：拒接。 */
  reject(): void {
    void this.run(this.session.reject());
  }

  /** 任一方：掛斷。 */
  hangup(): void {
    void this.run(this.session.hangup());
  }

  /** 處理收到的通話信令事件（kind 21002）。 */
  onCallSignalEvent(event: NostrEvent): void {
    let sender: PubkeyHex;
    let signal: CallSignal;
    try {
      const read = readCallSignal(event, this.ownSk);
      sender = read.sender;
      signal = read.signal;
    } catch {
      return;
    }

    // 封鎖者的通話信令一律忽略（不回應其 SDP、不響鈴）。
    if (this.isBlocked(sender)) return;

    if (signal.type === "call-candidate") {
      if (this.peer !== sender || this.session.activeCallId !== signal.callId) return;
      const init: RTCIceCandidateInit = {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid ?? null,
        sdpMLineIndex: signal.sdpMLineIndex ?? null,
      };
      if (this.hasRemote) void this.pc?.addIceCandidate(init);
      else this.pendingCandidates.push(init);
      return;
    }

    if (signal.type === "call-invite") {
      // 忙線：直接回 busy 給邀請者，不動現有通話。
      if (this.busy()) {
        this.handlers.publishCallSignal(
          createCallSignal({ type: "call-reject", callId: signal.callId, reason: "busy" }, this.ownSk, sender),
        );
        return;
      }
      this.session = new CallSession();
      this.peer = sender;
      this.media = signal.media;
      this.ensurePc();
      void this.run(this.session.onSignal(signal));
      return;
    }

    // accept / reject / hangup：僅接受目前通話對象。
    if (this.peer !== sender) return;
    void this.run(this.session.onSignal(signal));
  }

  /** 後端 stop 時關閉。 */
  close(): void {
    this.teardown();
  }

  private ensurePc(): void {
    const pc = new RTCPeerConnection(typeof this.rtcConfig === "function" ? this.rtcConfig() : this.rtcConfig);
    pc.onicecandidate = (ev) => {
      const c = ev.candidate;
      const callId = this.session.activeCallId;
      if (!c || !this.peer || !callId) return;
      const sig: CallSignal = {
        type: "call-candidate",
        callId,
        candidate: c.candidate,
        ...(c.sdpMid != null ? { sdpMid: c.sdpMid } : {}),
        ...(c.sdpMLineIndex != null ? { sdpMLineIndex: c.sdpMLineIndex } : {}),
      };
      this.handlers.publishCallSignal(createCallSignal(sig, this.ownSk, this.peer));
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream) this.handlers.onRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") void this.run(this.session.onConnected());
      else if (pc.connectionState === "failed") {
        this.handlers.onError("通話連線失敗");
        this.teardown();
        this.emitState();
      }
    };
    this.pc = pc;
  }

  private async run(actions: CallAction[]): Promise<void> {
    for (const a of actions) {
      try {
        await this.exec(a);
      } catch (e) {
        this.handlers.onError(`通話處理失敗：${String(e)}`);
      }
    }
    this.emitState();
  }

  private async exec(a: CallAction): Promise<void> {
    const pc = this.pc;
    switch (a.type) {
      case "acquire-media":
        await this.acquireMedia(a.media);
        return;
      case "create-offer": {
        if (!pc) return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.run(this.session.localDescription(offer.sdp ?? ""));
        return;
      }
      case "create-answer": {
        if (!pc) return;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.run(this.session.localDescription(answer.sdp ?? ""));
        return;
      }
      case "set-remote": {
        if (!pc) return;
        await pc.setRemoteDescription({ type: a.kind, sdp: a.sdp });
        this.hasRemote = true;
        for (const c of this.pendingCandidates) await pc.addIceCandidate(c);
        this.pendingCandidates = [];
        return;
      }
      case "send":
        if (this.peer) this.handlers.publishCallSignal(createCallSignal(a.signal, this.ownSk, this.peer));
        return;
      case "ended":
        return; // 狀態由 emitState 反映
      case "close":
        this.teardown();
        return;
    }
  }

  private async acquireMedia(media: CallMedia): Promise<void> {
    if (!this.pc) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === "video" });
    this.localStream = stream;
    for (const track of stream.getTracks()) this.pc.addTrack(track, stream);
    this.handlers.onLocalStream(stream);
  }

  private teardown(): void {
    if (this.localStream) for (const t of this.localStream.getTracks()) t.stop();
    try {
      this.pc?.close();
    } catch {
      /* 忽略 */
    }
    this.pc = null;
    this.localStream = null;
    this.hasRemote = false;
    this.pendingCandidates = [];
    this.handlers.onLocalStream(null);
    this.handlers.onRemoteStream(null);
    this.peer = null;
  }

  private emitState(): void {
    this.handlers.onState(this.peer, this.session.state, this.media);
  }
}
