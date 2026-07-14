import {
  CandidateBatch,
  createSignal,
  DataChannelReceiver,
  encodeDcPresence,
  encodeFile,
  encodeTyping,
  readSignal,
  type IceCandidateData,
  type NostrEvent,
  type OutgoingFile,
  type PubkeyHex,
  type ReceivedFile,
  type SecretKey,
  type Signal,
} from "@cinder/core";

/** ICE candidate 批次的去抖動視窗（毫秒）：把一陣爆發的候選合併成一則信令。 */
const CANDIDATE_BATCH_MS = 60;

/** WebRTC 檔案傳輸管理器對外的事件。 */
export interface TransferHandlers {
  /** 送出已封裝好的信令事件到中繼站。 */
  publishSignal: (event: NostrEvent) => void;
  /** 傳送進度（bytesSent / size）。 */
  onOutgoingProgress: (peer: PubkeyHex, id: string, sent: number, size: number) => void;
  /** 收到完整檔案。 */
  onIncoming: (peer: PubkeyHex, file: ReceivedFile) => void;
  /** 經 P2P 通道收到「正在輸入中」（F5 卸載）。 */
  onTyping?: (peer: PubkeyHex) => void;
  /**
   * 經 P2P 通道收到對方在線狀態（ADR-0088 (e)：心跳卸載中繼）。
   * `hb`＝對方自報的信標節奏（毫秒，ADR-0109）；缺少則收端退回預設容忍窗（相容舊版）。
   */
  onPresence?: (peer: PubkeyHex, p: { s: string; m: string; np: string; hb?: number }) => void;
  /** 錯誤（傳輸失敗、對方不可達等）。 */
  onError: (peer: PubkeyHex, reason: string) => void;
}

/** 進行中的送檔工作（供進度回報）。 */
interface OutJob {
  id: string;
  file: OutgoingFile;
}

interface PeerConn {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  rx: DataChannelReceiver;
  hasRemote: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  outbox: OutJob[];
  started: boolean;
  candBatch: CandidateBatch;
  candTimer: ReturnType<typeof setTimeout> | undefined;
}

const HIGH_WATER = 1 << 20; // 1 MiB：超過就暫緩送出，避免撐爆緩衝
const CHUNK_SIZE = 16_384;

/**
 * 每個聯絡人一條 WebRTC P2P 連線，複用 core 的 signaling / datachannel：
 * SDP/ICE 經注入的 `publishSignal` 走中繼交換，連上後以資料通道傳檔（分塊 + 進度）。
 * 檔案內容不經中繼，僅走 P2P（DTLS 加密）。
 */
export class WebRtcTransfer {
  private readonly peers = new Map<PubkeyHex, PeerConn>();
  private seq = 0;

  constructor(
    private readonly ownSk: SecretKey,
    private readonly handlers: TransferHandlers,
    /** ICE 設定；可為函式以於每次建連時取當前值（企業強制 TURN 動態生效）。 */
    private readonly rtcConfig?: RTCConfiguration | (() => RTCConfiguration | undefined),
  ) {}

  /** 主動建立與對方的 P2P 通道（開啟對話時呼叫，讓後續狀態/輸入中可走 P2P）。 */
  connect(peerPk: PubkeyHex): void {
    const peer = this.ensurePeer(peerPk);
    if (!peer.started && !(peer.dc && peer.dc.readyState === "open")) {
      void this.startOffer(peerPk, peer);
    }
  }

  /** 若與對方的 P2P 通道已開，經其送出「正在輸入中」並回傳 true（卸載中繼）；否則 false。 */
  sendTyping(peerPk: PubkeyHex): boolean {
    const peer = this.peers.get(peerPk);
    if (peer?.dc && peer.dc.readyState === "open") {
      peer.dc.send(encodeTyping());
      return true;
    }
    return false;
  }

  /**
   * 若 P2P 通道已開，經其送出在線狀態並回傳 true（ADR-0088：心跳卸載中繼）；否則 false。
   *
   * `hb`＝自報的信標節奏（ADR-0109）。**必須帶**：這條訊息是由 `beat()` 送出的，節奏與心跳
   * 相同——閒置時每 5 分鐘才一則。收端若用固定的短窗判離線，會把在線的人誤判為離線。
   */
  sendPresence(peerPk: PubkeyHex, p: { s: string; m: string; np: string; hb?: number }): boolean {
    const peer = this.peers.get(peerPk);
    if (peer?.dc && peer.dc.readyState === "open") {
      peer.dc.send(encodeDcPresence(p.s, p.m, p.np, p.hb));
      return true;
    }
    return false;
  }

  /** 與對方是否有活的 P2P 資料通道（供心跳抑制判斷，ADR-0088）。 */
  hasOpenChannel(peerPk: PubkeyHex): boolean {
    const peer = this.peers.get(peerPk);
    return !!(peer?.dc && peer.dc.readyState === "open");
  }

  /** 傳送一個檔案給對方，回傳此傳輸的 id（供 UI 追蹤進度）。 */
  sendFile(peerPk: PubkeyHex, file: OutgoingFile): string {
    const id = `f${Date.now()}_${this.seq++}`;
    const peer = this.ensurePeer(peerPk);
    peer.outbox.push({ id, file });
    if (peer.dc && peer.dc.readyState === "open") {
      this.flush(peerPk, peer);
    } else if (!peer.started) {
      void this.startOffer(peerPk, peer);
    }
    return id;
  }

  /** 處理收到的信令事件（kind 21000）。 */
  onSignalEvent(event: NostrEvent): void {
    let sender: PubkeyHex;
    let signal: Signal;
    try {
      const read = readSignal(event, this.ownSk);
      sender = read.sender;
      signal = read.signal;
    } catch {
      return;
    }
    const peer = this.ensurePeer(sender);
    void this.applySignal(sender, peer, signal);
  }

  /** 沖出累積的 ICE candidate，以單一批次信令送出。 */
  private flushCandidates(peerPk: PubkeyHex, peer: PeerConn): void {
    if (peer.candTimer !== undefined) {
      clearTimeout(peer.candTimer);
      peer.candTimer = undefined;
    }
    const batch = peer.candBatch.drain();
    if (batch) this.handlers.publishSignal(createSignal(batch, this.ownSk, peerPk));
  }

  /** 關閉所有連線（後端 stop 時呼叫）。 */
  close(): void {
    for (const peer of this.peers.values()) {
      if (peer.candTimer !== undefined) clearTimeout(peer.candTimer);
      try {
        peer.pc.close();
      } catch {
        /* 忽略 */
      }
    }
    this.peers.clear();
  }

  private ensurePeer(peerPk: PubkeyHex): PeerConn {
    const existing = this.peers.get(peerPk);
    if (existing) return existing;
    const pc = new RTCPeerConnection(typeof this.rtcConfig === "function" ? this.rtcConfig() : this.rtcConfig);
    const conn: PeerConn = {
      pc,
      rx: new DataChannelReceiver({
        onFile: (file) => this.handlers.onIncoming(peerPk, file),
        onTyping: () => this.handlers.onTyping?.(peerPk),
        onPresence: (p) => this.handlers.onPresence?.(peerPk, p),
        onError: (reason) => this.handlers.onError(peerPk, reason),
      }),
      hasRemote: false,
      pendingCandidates: [],
      outbox: [],
      started: false,
      candBatch: new CandidateBatch(),
      candTimer: undefined,
    };
    pc.onicecandidate = (ev) => {
      const c = ev.candidate;
      if (!c) {
        // null candidate = 蒐集完成，立即沖出剩餘批次
        this.flushCandidates(peerPk, conn);
        return;
      }
      conn.candBatch.add({
        candidate: c.candidate,
        ...(c.sdpMid != null ? { sdpMid: c.sdpMid } : {}),
        ...(c.sdpMLineIndex != null ? { sdpMLineIndex: c.sdpMLineIndex } : {}),
      });
      // 去抖動：一陣爆發的候選合併成單一 candidates 信令送出（A6）。
      if (conn.candTimer === undefined) {
        conn.candTimer = setTimeout(() => this.flushCandidates(peerPk, conn), CANDIDATE_BATCH_MS);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.handlers.onError(peerPk, "P2P 連線失敗");
    };
    // 由對方發起時，透過 ondatachannel 取得通道
    pc.ondatachannel = (ev) => this.attachChannel(peerPk, conn, ev.channel);
    this.peers.set(peerPk, conn);
    return conn;
  }

  private async startOffer(peerPk: PubkeyHex, peer: PeerConn): Promise<void> {
    peer.started = true;
    const dc = peer.pc.createDataChannel("buddy");
    this.attachChannel(peerPk, peer, dc);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.handlers.publishSignal(createSignal({ type: "offer", sdp: offer.sdp ?? "" }, this.ownSk, peerPk));
    } catch (e) {
      this.handlers.onError(peerPk, `建立 offer 失敗：${String(e)}`);
    }
  }

  private attachChannel(peerPk: PubkeyHex, peer: PeerConn, dc: RTCDataChannel): void {
    peer.dc = dc;
    dc.binaryType = "arraybuffer"; // 檔案分塊以二進位框架送達（省 base64 膨脹）
    dc.onmessage = (m) => peer.rx.receive(m.data as string | ArrayBuffer);
    dc.onopen = () => this.flush(peerPk, peer);
    dc.onerror = () => this.handlers.onError(peerPk, "資料通道錯誤");
    if (dc.readyState === "open") this.flush(peerPk, peer);
  }

  private async addIce(peer: PeerConn, c: IceCandidateData): Promise<void> {
    const init: RTCIceCandidateInit = {
      candidate: c.candidate,
      sdpMid: c.sdpMid ?? null,
      sdpMLineIndex: c.sdpMLineIndex ?? null,
    };
    if (peer.hasRemote) await peer.pc.addIceCandidate(init);
    else peer.pendingCandidates.push(init);
  }

  private async applySignal(peerPk: PubkeyHex, peer: PeerConn, signal: Signal): Promise<void> {
    try {
      if (signal.type === "candidate") {
        await this.addIce(peer, signal);
      } else if (signal.type === "candidates") {
        for (const c of signal.candidates) await this.addIce(peer, c);
      } else if (signal.type === "offer") {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        peer.hasRemote = true;
        for (const c of peer.pendingCandidates) await peer.pc.addIceCandidate(c);
        peer.pendingCandidates = [];
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.handlers.publishSignal(createSignal({ type: "answer", sdp: answer.sdp ?? "" }, this.ownSk, peerPk));
      } else {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        peer.hasRemote = true;
        for (const c of peer.pendingCandidates) await peer.pc.addIceCandidate(c);
        peer.pendingCandidates = [];
      }
    } catch (e) {
      this.handlers.onError(peerPk, `信令處理失敗：${String(e)}`);
    }
  }

  /** 依序送出 outbox 內的檔案（含背壓與進度）。 */
  private flush(peerPk: PubkeyHex, peer: PeerConn): void {
    const dc = peer.dc;
    if (!dc || dc.readyState !== "open") return;
    const job = peer.outbox.shift();
    if (!job) return;
    const messages = encodeFile(job.file, job.id, CHUNK_SIZE);
    const size = job.file.bytes.length;
    let i = 0;
    const pump = () => {
      if (dc.readyState !== "open") {
        this.handlers.onError(peerPk, "傳輸中斷");
        return;
      }
      while (i < messages.length) {
        if (dc.bufferedAmount > HIGH_WATER) {
          setTimeout(pump, 50);
          return;
        }
        const m = messages[i]!;
        // 分塊框架為整段 buffer（offset 0），送底層 ArrayBuffer（零拷貝、無 base64 膨脹）。
        if (typeof m === "string") dc.send(m);
        else dc.send(m.buffer as ArrayBuffer);
        i += 1;
        // i=1 為 file-begin；之後每則為一個 chunk
        const sent = Math.min(size, (i - 1) * CHUNK_SIZE);
        this.handlers.onOutgoingProgress(peerPk, job.id, sent, size);
      }
      // 本檔送完，繼續下一個
      this.flush(peerPk, peer);
    };
    pump();
  }
}
