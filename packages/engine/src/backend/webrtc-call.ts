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
import { IcePathTracker, type IcePath } from "./ice-path.js";

/**
 * 這個 transceiver 是不是視訊的（ADR-0338）。
 *
 * ⚠ 不能只看 `sender.track`——預先協商的視訊 transceiver 在語音通話時 track 是 `null`，
 * 那正是我們要找的那一個。真實的 `RTCRtpTransceiver` 恆有 `receiver.track`，用它判定。
 */
/** 鏡頭被佔用（多為另一顆鏡頭還開著）——換鏡頭時改成先停舊軌的依據（ADR-0424）。 */
function isCameraBusy(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "NotReadableError" || name === "TrackStartError" || name === "AbortError";
}

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
  /**
   * 這通通話的媒體實際走哪條路（ADR-0344）：`direct`（兩端直連、延遲最低、站方零成本）／
   * `relay`（經 TURN 中繼——**按流量計費**，且視訊 ≈ 150 MB／10 分鐘）／`unknown`（尚未測出）。
   *
   * 只在**判定改變**時發（tracker 自己去重），通話結束不發——UI 於 `onState` 結束時自行歸位。
   */
  onIcePath?: (peer: PubkeyHex, path: IcePath) => void;
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
  /** 這通收到的所有遠端軌併成的串流（見 ensurePc 的 ontrack）。 */
  private remoteStream: MediaStream | null = null;
  private hasRemote = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private seq = 0;
  /** 本通話的 P2P 是否曾經連通（ADR-0243）：區分「從未打通」與「連上後斷線」的失敗提示。 */
  private everConnected = false;
  /** 視訊畫質檔位（ADR-0337）；跨通話沿用，由 App 於啟動時以裝置偏好設定。 */
  private videoQuality: VideoQuality = DEFAULT_VIDEO_QUALITY;
  /** 目前選定的鏡頭（ADR-0339）；沿用到下次開視訊，升級時不必再選一次。 */
  private camera: CameraSelection = {};
  /** ICE 路徑追蹤（ADR-0344）：連線 connected 時 start、teardown 時 reset。 */
  private readonly pathTracker: IcePathTracker;

  constructor(
    private readonly ownSk: SecretKey,
    private readonly handlers: CallHandlers,
    /** ICE 設定；可為函式以於每次建連時取當前值（企業強制 TURN 動態生效）。 */
    private readonly rtcConfig?: RTCConfiguration | (() => RTCConfiguration | undefined),
    /** 判斷某公鑰是否已被封鎖（封鎖者的通話信令一律忽略）。 */
    private readonly isBlocked: (pubkey: PubkeyHex) => boolean = () => false,
  ) {
    // ADR-0344：路徑判定。在建構子內指派而非欄位初始值——回呼要讀 `this.handlers`，
    // 而參數屬性的指派時機不該被拿來賭。
    this.pathTracker = new IcePathTracker((path) => {
      const peer = this.peer;
      // 通話已結束（peer 歸零）就別再上報：那是上一通的判定。
      if (peer) this.handlers.onIcePath?.(peer, path);
    });
  }

  /**
   * 這通通話的 ICE 路徑（ADR-0344）。通話正是 ADR-0243 成本論證的主體——
   * 「少數通話 × 小頻寬」成立的前提是它真的走 TURN 的那幾通才計費，而在此之前
   * 程式從來不知道是哪幾通。
   */
  icePath(): IcePath {
    return this.pc ? this.pathTracker.path : "unknown";
  }

  /** 立刻重測這通通話的 ICE 路徑（供品質提示／用量觀測在意時取準值）。 */
  async refreshIcePath(): Promise<IcePath> {
    if (!this.pc) return "unknown";
    await this.pathTracker.refresh(this.pc);
    return this.icePath();
  }

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
    this.remoteStream = null; // 上一通的遠端軌不能併進這一通
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
    // 🔴 實機發現（2026-11-17）：預先鋪的視訊 transceiver（下方 addTransceiver）**沒有綁 stream**，
    // 對端收到的 `ev.streams` 是空的。以前只看 `ev.streams[0]` ⇒ 視訊軌被丟掉，
    // 「通話中才開視訊」的畫面從來沒顯示過（畫格有收、元件沒拿到）。
    // 已出貨的對端都是這樣送的，所以在收的這一端把所有軌併成一條遠端串流。
    pc.ontrack = (ev) => {
      const stream = this.mergeRemoteTrack(ev.track, ev.streams[0]);
      if (stream) this.handlers.onRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.everConnected = true; // 記錄「曾連通」，供失敗時分辨 unreachable / lost（ADR-0243）
        this.pathTracker.start(pc); // ADR-0344：這通是直連還是經 TURN？連上了才問得出來
        void this.run(this.session.onConnected());
      } else if (pc.connectionState === "failed") {
        // ADR-0243：P2P 連不通/斷線。給可行動的失敗提示（非靜默、非只顯示「連不上」），並乾淨結束通話：
        // 從未打通＝多為限制網路無 TURN 退路（unreachable，可改網路重試）；連上後斷＝網路不穩（lost，可再撥）。
        const peer = this.peer;
        const reason: CallFailureReason = this.everConnected ? "lost" : "unreachable";
        // ADR-0344：連線已死，快取的判定立刻作廢。**不能等 teardown**——收尾走的是非同步的
        // hangup 路徑，在它跑完之前 `icePath()` 會繼續回報上一刻的 relay/direct。
        this.pathTracker.reset();
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
    // 🔴 實機發現（2026-11-17）：答方有**兩條**視訊 transceiver——ensurePc 自己鋪的那條
    // **不會**被 offer 採用（JSEP：只有 addTrack 建的才會被重用），mid 恆為 null、不在 SDP 裡；
    // offer 的視訊 m-line 另建一條。換到前者＝相機亮著、對方什麼都收不到。所以先挑協商過的。
    const videos = pc.getTransceivers?.().filter((t) => isVideoTransceiver(t) && t.direction !== "stopped") ?? [];
    const tr = videos.find((t) => t.mid != null) ?? videos[0];
    if (tr) return tr.sender;
    return pc.getSenders().find((s) => s.track?.kind === "video") ?? null;
  }

  /** 協商過（有 mid）、還沒上軌的視訊 sender——答方開機時放鏡頭的位置（ADR-0424）。 */
  private unusedNegotiatedVideoSender(): RTCRtpSender | null {
    const tr = this.pc
      ?.getTransceivers?.()
      .find((t) => isVideoTransceiver(t) && t.mid != null && t.direction !== "stopped" && !t.sender.track);
    return tr?.sender ?? null;
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
    } catch (e) {
      track.stop();
      throw e;
    }
    this.replaceLocalTrack(track, null);
    this.applyVideoQuality();
    this.emitCamera();
  }

  /** 降級：卸下視訊軌並**真的停掉相機**（與 ADR-0337 的關鏡頭不同，那個只送黑畫面）。 */
  private detachVideo(): void {
    const sender = this.videoSender();
    const track = sender?.track ?? null;
    void sender?.replaceTrack(null);
    if (track) track.stop();
    this.replaceLocalTrack(null, track);
  }

  /**
   * 換掉本地串流裡的一條軌，並送出**新的**串流物件。
   *
   * 🔴 實機發現（2026-11-17）：以前是對同一個 localStream `addTrack` 再送同一個物件——
   * UI 的 `srcObject` 綁定看的是物件有沒有換，於是開視訊後自我預覽一直是黑的。
   * 沒有 `MediaStream` 的環境（舊 WebView、node 測試）退回原地增刪。
   */
  private replaceLocalTrack(add: MediaStreamTrack | null, remove: MediaStreamTrack | null): void {
    const old = this.localStream;
    if (!old) return;
    if (typeof MediaStream === "function") {
      const next = old.getTracks().filter((t) => t !== remove && t !== add);
      if (add) next.push(add);
      this.localStream = new MediaStream(next);
    } else {
      if (remove) old.removeTrack?.(remove);
      if (add) old.addTrack?.(add);
    }
    this.handlers.onLocalStream(this.localStream);
  }

  /** 併入一條遠端軌，回傳**新的**遠端串流（見 ensurePc 的 ontrack 說明）。 */
  private mergeRemoteTrack(track: MediaStreamTrack, stream: MediaStream | undefined): MediaStream | null {
    if (typeof MediaStream !== "function") return stream ?? null;
    const all = [...(this.remoteStream?.getTracks() ?? []), ...(stream?.getTracks() ?? []), track];
    this.remoteStream = new MediaStream(all.filter((t, i) => all.indexOf(t) === i));
    return this.remoteStream;
  }

  /**
   * 切換鏡頭（ADR-0339）：手機翻面（`facingMode`）或桌面選裝置（`deviceId`）。
   *
   * 沒在送視訊時只記住選擇，下次開視訊時沿用。
   */
  setCamera(sel: CameraSelection): void {
    const prev = { ...this.camera };
    this.camera = { ...sel };
    void this.swapCamera(prev);
  }

  /**
   * 換上新鏡頭的軌。
   *
   * 🔴 **順序**：先取新軌 → `replaceTrack` → **才**停舊軌。
   *
   * 反過來（先停舊軌）會有一段沒有畫面的空窗，而且**新軌取失敗時就回不去了**
   * ——使用者的畫面會就此消失。故失敗時舊軌原封不動。
   *
   * 🔴 例外（實機發現 2026-11-17，ADR-0424）：多數 Android 手機**不能同時開兩顆鏡頭**，
   * 舊鏡頭開著時取新的會丟 `NotReadableError`——照上面的順序就**永遠**切不過去。
   * 遇到「鏡頭忙碌」才改成先停舊軌，並備好退路：新的開不了就用原本的鏡頭重開，
   * 連原本的都開不了才正式降級成語音（通知對方，不送一條死掉的軌）。
   */
  private async swapCamera(prev: CameraSelection): Promise<void> {
    const sender = this.videoSender();
    const old = sender?.track ?? null;
    if (!sender || !old) return; // 沒在送視訊：只記住選擇（見 setCamera）
    let track: MediaStreamTrack;
    try {
      track = await this.openCamera();
    } catch (e) {
      if (!isCameraBusy(e)) {
        this.handlers.onError(`無法切換鏡頭：${String(e)}`);
        return; // 舊軌原封不動
      }
      old.stop();
      try {
        track = await this.openCamera();
      } catch (e2) {
        this.handlers.onError(`無法切換鏡頭：${String(e2)}`);
        this.camera = prev;
        try {
          track = await this.openCamera();
        } catch {
          await this.changeMedia("audio");
          return;
        }
      }
    }
    try {
      await sender.replaceTrack(track);
    } catch (e) {
      track.stop(); // 取到了但換軌失敗：別讓它留著佔用相機
      this.handlers.onError(`無法切換鏡頭：${String(e)}`);
      return;
    }
    old.stop();
    this.replaceLocalTrack(track, old);
    this.applyVideoQuality();
    this.emitCamera();
  }

  /** 以目前的畫質與鏡頭選擇開一條視訊軌。 */
  private async openCamera(): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(this.videoQuality, this.camera),
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("取不到視訊軌");
    return track;
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
          // 🔴 ADR-0424（實機發現 2026-11-17）：ensurePc 自己鋪的那條**不會**被 offer 採用
          // （JSEP：只有 addTrack 建的才會被重用），mid 恆為 null、不在 SDP 裡。
          // 不能停掉它：Chrome 的 addTrack 會挑到這條已停的、直接丟例外。所以留著，
          // 由 acquireMedia／videoSender 改挑協商過的那條。
          // 只有 offer 根本沒有視訊（舊版）時才停——那時不會再 addTrack 視訊，
          // 而 canChangeMedia 才會照實回 false（不顯示按了沒反應的按鈕）。
          const videos = (pc.getTransceivers?.() ?? []).filter(isVideoTransceiver);
          const negotiated = videos.some((t) => t.mid != null);
          for (const t of videos) {
            if (t.mid == null) {
              if (!negotiated) t.stop?.();
            } else if (t.direction === "recvonly") {
              t.direction = "sendrecv";
            }
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
    for (const track of stream.getTracks()) {
      // 🔴 ADR-0424：答方（已套用 offer）有一條協商過、還沒上軌的視訊 transceiver——直接放上去。
      // 交給 addTrack 會重用 ensurePc 自己鋪的那條（沒進 SDP）⇒ 鏡頭開了、對方看不到。
      // setStreams 補上 msid，舊版對端的 ontrack 才拿得到 stream。主叫還沒協商，照舊 addTrack。
      const target = track.kind === "video" ? this.unusedNegotiatedVideoSender() : null;
      if (target) {
        await target.replaceTrack(track);
        target.setStreams?.(stream);
      } else {
        this.pc.addTrack(track, stream);
      }
    }
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
    this.pathTracker.reset(); // ADR-0344：作廢在途探測，別讓這通的判定蓋到下一通
    if (this.localStream) for (const t of this.localStream.getTracks()) t.stop();
    try {
      this.pc?.close();
    } catch {
      /* 忽略 */
    }
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
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
