import {
  CallSession,
  createCallSignal,
  readCallSignal,
  type CallAction,
  type CallFailureReason,
  type CallMedia,
  type CallSignal,
  type CallState,
  type NostrEvent,
  type PubkeyHex,
  type SecretKey,
  type VideoQuality,
  type CameraFacing,
  type CameraSelection,
  DEFAULT_VIDEO_QUALITY,
  videoConstraints,
  videoProfile,
} from "@cinderous/core";

/**
 * 這個 transceiver 是不是視訊的（ADR-0338）。
 *
 * ⚠ 不能只看 `sender.track`——預先協商的視訊 transceiver 在語音通話時 track 是 `null`，
 * 那正是我們要找的那一個。真實的 `RTCRtpTransceiver` 恆有 `receiver.track`，用它判定。
 */
function isVideoTransceiver(t: RTCRtpTransceiver): boolean {
  return t.receiver?.track?.kind === "video" || t.sender?.track?.kind === "video";
}

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
  /**
   * 通話媒體型態改變（ADR-0338）：`local`＝我在送什麼、`remote`＝對方在送什麼。
   * **兩者各自獨立**——「我送視訊、他只送語音」是合法狀態，UI 要照實呈現。
   */
  onMedia?: (local: CallMedia, remote: CallMedia) => void;
  /**
   * 目前鏡頭的**實際**朝向（ADR-0339）。`null`＝裝置不回報（桌面 webcam 常見）。
   *
   * ⚠ 回報的是 `getSettings().facingMode`，不是我們要求了什麼——`facingMode` 是
   * 偏好不是保證，只有一個鏡頭的裝置會給它有的那個。UI 的鏡像與按鈕狀態要跟著這個走。
   */
  onCamera?: (facing: CameraFacing | null) => void;
  onError: (reason: string) => void;
  /**
   * 通話**連線失敗**（ADR-0243）：與 `onError`（處理例外）不同——這是 P2P 連不通/斷線，
   * UI 據 `reason` 給可行動提示（`unreachable`＝限制網路可改網路重試；`lost`＝可再撥）。
   */
  onFailed: (peer: PubkeyHex, reason: CallFailureReason) => void;
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
  /** 本通話的 P2P 是否曾經連通（ADR-0243）：區分「從未打通」與「連上後斷線」的失敗提示。 */
  private everConnected = false;
  /** 視訊畫質檔位（ADR-0337）；跨通話沿用，由 App 於啟動時以裝置偏好設定。 */
  private videoQuality: VideoQuality = DEFAULT_VIDEO_QUALITY;
  /** 目前選定的鏡頭（ADR-0339）；沿用到下次開視訊，升級時不必再選一次。 */
  private camera: CameraSelection = {};

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
    this.everConnected = false; // 每通新通話重置（ADR-0243）
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
      if (pc.connectionState === "connected") {
        this.everConnected = true; // 記錄「曾連通」，供失敗時分辨 unreachable / lost（ADR-0243）
        void this.run(this.session.onConnected());
      } else if (pc.connectionState === "failed") {
        // ADR-0243：P2P 連不通/斷線。給可行動的失敗提示（非靜默、非只顯示「連不上」），並乾淨結束通話：
        // 從未打通＝多為限制網路無 TURN 退路（unreachable，可改網路重試）；連上後斷＝網路不穩（lost，可再撥）。
        const peer = this.peer;
        const reason: CallFailureReason = this.everConnected ? "lost" : "unreachable";
        if (peer) this.handlers.onFailed(peer, reason);
        // 走正常掛斷路徑：session→ended、送 hangup 給對端（經中繼、與失敗的 P2P 不同路，能讓對端也乾淨結束）、
        // close→teardown → UI 收到 onState(ended) 而關閉通話視窗。
        void this.run(this.session.hangup());
      }
    };
    // 🔴 ADR-0338：**一律**預先協商視訊 transceiver，即使這是語音通話。
    // 之後升級只需 `replaceTrack`（規格保證不必重新協商）⇒ 沒有 SDP 交換、沒有 glare。
    // ⚠ 這裡不取用相機——`sendrecv` 但 track 為 null，不送任何 RTP、沒有權限提示。
    try {
      pc.addTransceiver("video", { direction: "sendrecv" });
    } catch {
      /* 舊環境沒有 addTransceiver：退化為不可升降級（canChangeMedia 會回 false） */
    }
    this.pc = pc;
  }

  /**
   * 這通能不能改型態（ADR-0338 §4）：本端有沒有視訊 sender。
   *
   * 舊版對端的 offer 沒有視訊 m-line ⇒ 沒有可用的視訊 sender ⇒ 按了不會有效果。
   * **UI 據此不顯示入口**——寧可少一個按鈕，也不要一個按了沒反應的按鈕。
   */
  canChangeMedia(): boolean {
    return !!this.videoSender();
  }

  /** 我正在送的型態（ADR-0338）。 */
  get localMedia(): CallMedia | null {
    return this.session.localMedia;
  }

  /** 對方正在送的型態（ADR-0338）。 */
  get remoteMedia(): CallMedia | null {
    return this.session.remoteMedia;
  }

  /** 找出視訊 sender（`addTransceiver` 建立的那個，track 可能為 null）。 */
  private videoSender(): RTCRtpSender | null {
    const pc = this.pc;
    if (!pc) return null;
    const tr = pc.getTransceivers?.().find(isVideoTransceiver);
    if (tr) return tr.sender;
    return pc.getSenders().find((s) => s.track?.kind === "video") ?? null;
  }

  /**
   * 通話中改變自己這一方的型態（ADR-0338）。
   *
   * 升級：取視訊軌 → `replaceTrack` 到既有 sender → 通知對端。
   * 降級：`replaceTrack(null)` → **`stop()` 相機**（與 ADR-0337 的關鏡頭不同，那個只送黑畫面）。
   */
  setLocalMedia(media: CallMedia): void {
    void this.changeMedia(media);
  }

  /**
   * ⚠ **不能直接 `run(session.setLocalMedia(...))`**：`run` 逐一執行動作、失敗只記錄後續續跑，
   * 那會在取媒體失敗（使用者不給相機權限）後照樣把 `call-media` 送出去——
   * 對端於是等一個永遠不會來的畫面（ADR-0338 §6-3）。
   *
   * 所以這裡自己排序：**先做完換軌，成功了才通知對端**；失敗則把型態改回去。
   */
  private async changeMedia(media: CallMedia): Promise<void> {
    const prev = this.session.localMedia;
    const actions = this.session.setLocalMedia(media);
    if (actions.length === 0) return; // 非 active、或型態沒變
    try {
      if (media === "video") await this.attachVideo();
      else this.detachVideo();
    } catch (e) {
      if (prev) this.session.setLocalMedia(prev); // 回滾，且不送任何信令
      this.handlers.onError(`無法開啟視訊：${String(e)}`);
      this.emitMedia();
      return;
    }
    for (const a of actions) if (a.type === "send") await this.exec(a);
    this.emitMedia();
  }

  /** 升級：取視訊軌並換到既有的視訊 sender 上（不重新協商）。 */
  private async attachVideo(): Promise<void> {
    const sender = this.videoSender();
    if (!sender) throw new Error("這通沒有可用的視訊軌道");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(this.videoQuality, this.camera),
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("取不到視訊軌");
    // 🔴 取到之後的任何失敗都必須把它停掉（審查發現 #3）。
    // 不停就是**相機留著亮**，而 ADR-0340 的整個主張就是「指示燈要誠實」。
    // （`swapCamera` 一直有做這件事，這裡先前漏了——兩處不一致。）
    try {
      await sender.replaceTrack(track);
      this.localStream?.addTrack?.(track);
    } catch (e) {
      track.stop();
      throw e;
    }
    this.applyVideoQuality();
    if (this.localStream) this.handlers.onLocalStream(this.localStream);
    this.emitCamera();
  }

  /** 降級：卸下視訊軌並**真的停掉相機**（與 ADR-0337 的關鏡頭不同，那個只送黑畫面）。 */
  private detachVideo(): void {
    const sender = this.videoSender();
    const track = sender?.track ?? null;
    void sender?.replaceTrack(null);
    if (track) {
      track.stop();
      this.localStream?.removeTrack?.(track);
    }
    if (this.localStream) this.handlers.onLocalStream(this.localStream);
  }

  /**
   * 切換鏡頭（ADR-0339）：手機翻面（`facingMode`）或桌面選裝置（`deviceId`）。
   *
   * 沒在送視訊時只記住選擇，下次開視訊時沿用。
   */
  setCamera(sel: CameraSelection): void {
    this.camera = { ...sel };
    void this.swapCamera();
  }

  /**
   * 換上新鏡頭的軌。
   *
   * 🔴 **順序**：先取新軌 → `replaceTrack` → **才**停舊軌。
   *
   * 反過來（先停舊軌）會有一段沒有畫面的空窗，而且**新軌取失敗時就回不去了**
   * ——使用者的畫面會就此消失。故失敗時舊軌原封不動。
   */
  private async swapCamera(): Promise<void> {
    const sender = this.videoSender();
    const old = sender?.track ?? null;
    if (!sender || !old) return; // 沒在送視訊：只記住選擇（見 setCamera）
    let track: MediaStreamTrack | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(this.videoQuality, this.camera),
      });
      track = stream.getVideoTracks()[0];
      if (!track) throw new Error("取不到視訊軌");
      await sender.replaceTrack(track);
    } catch (e) {
      track?.stop(); // 取到了但換軌失敗：別讓它留著佔用相機
      this.handlers.onError(`無法切換鏡頭：${String(e)}`);
      return; // 舊軌原封不動
    }
    old.stop();
    this.localStream?.removeTrack?.(old);
    this.localStream?.addTrack?.(track);
    this.applyVideoQuality();
    if (this.localStream) this.handlers.onLocalStream(this.localStream);
    this.emitCamera();
  }

  /**
   * 回報**實際**朝向（ADR-0339）。
   *
   * ⚠ 讀的是軌道的 `getSettings().facingMode`，不是 `this.camera.facingMode`——
   * 後者是我們要求的，而 `facingMode` 是偏好不是保證。只有一個鏡頭的裝置
   * 會給它有的那個，UI 必須跟著事實走而不是跟著請求走。
   */
  private emitCamera(): void {
    const track = this.videoSender()?.track ?? null;
    const facing = (track?.getSettings?.() as { facingMode?: string } | undefined)?.facingMode;
    this.handlers.onCamera?.(facing === "user" || facing === "environment" ? facing : null);
  }

  private emitMedia(): void {
    const local = this.session.localMedia;
    const remote = this.session.remoteMedia;
    if (local && remote) this.handlers.onMedia?.(local, remote);
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
        // 🔴 ADR-0338 §3：答方在 `setRemoteDescription(offer)` 時，瀏覽器為未匹配的 m-line
        // 自動建立的 transceiver 預設是 `recvonly`。不改成 `sendrecv` 就**永遠送不出視訊**
        // ——這是這個設計唯一容易寫錯的地方。
        if (a.kind === "offer") {
          for (const t of pc.getTransceivers?.() ?? []) {
            if (isVideoTransceiver(t) && t.direction === "recvonly") t.direction = "sendrecv";
          }
        }
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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      // 不是裸 `true`（ADR-0337）：裸 true 拿相機預設（手機常見 720p 以上），
      // 使用者付行動數據、站方付 TURN egress，而兩邊都無從得知。
      video: media === "video" ? videoConstraints(this.videoQuality, this.camera) : false,
    });
    this.localStream = stream;
    for (const track of stream.getTracks()) this.pc.addTrack(track, stream);
    this.applyVideoQuality();
    this.handlers.onLocalStream(stream);
  }

  /**
   * 設定畫質檔位（ADR-0337）。**通話中呼叫即時生效**——畫質問題只有在通話中
   * 才會被察覺，做成「下次通話才生效」等於要求使用者先掛斷再打一次。
   *
   * 無通話時只記住，下一通沿用。
   */
  setVideoQuality(q: VideoQuality): void {
    this.videoQuality = q;
    this.applyVideoQuality();
  }

  /**
   * 兩段都要動：`setParameters` 改編碼上限（立即生效、免重新協商）、
   * `applyConstraints` 改擷取解析度。
   *
   * ⚠ **順序有意義**：先降 bitrate 再降解析度。反過來會有一小段
   * 「低解析度但高位元率」的浪費視窗。
   *
   * 失敗一律吞掉——畫質是加分項，不是通話前提。
   */
  private applyVideoQuality(): void {
    const pc = this.pc;
    if (!pc) return;
    const profile = videoProfile(this.videoQuality);
    void (async () => {
      try {
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind !== "video") continue;
          const params = sender.getParameters();
          const encodings = params.encodings?.length ? params.encodings : [{}];
          encodings[0]!.maxBitrate = profile.maxBitrate;
          // 視訊通話是看人臉：掉解析度比掉幀順眼。
          await sender.setParameters({ ...params, encodings, degradationPreference: "maintain-framerate" });
        }
        for (const track of this.localStream?.getVideoTracks() ?? []) {
          await track.applyConstraints(videoConstraints(this.videoQuality, this.camera));
        }
      } catch {
        /* 畫質套用失敗不影響通話本身 */
      }
    })();
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
    // ADR-0338：`media` 改為**有效值**（任一方視訊即視訊）——UI 據此決定要不要開視訊版面。
    this.handlers.onState(this.peer, this.session.state, this.session.effectiveMedia ?? this.media);
    this.emitMedia();
  }
}
