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
} from "@cinderous/core";
import { IcePathTracker, type IcePath } from "./ice-path.js";

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
  /**
   * P2P 直連狀態改變（ADR-0213）：`connected`＝資料通道開啟（直連可用，檔案/通話/輸入中可走 P2P），
   * `false`＝通道關閉或連線失敗（降級走 relay）。供對話標題列顯示連線品質晶片。
   *
   * `path`＝這條連線的位元組實際走哪（ADR-0344）：`direct`（零成本）／`relay`（經 TURN、**按流量
   * 計費**）／`unknown`（尚未測出）。`connected=false` 時無意義。通道一開會先以 `unknown` 發一次，
   * 探測有結果且**與前次不同**才再發——所以同一條連線會收到多次 `true`，UI 要能吃重複。
   */
  onConnectionState?: (peer: PubkeyHex, connected: boolean, path?: IcePath) => void;
}

/** 進行中的送檔工作（供進度回報）。 */
interface OutJob {
  id: string;
  file: OutgoingFile;
  /** 儲存槽存放來源標註（ADR-0161／審查修正）：隨 file-begin 傳，讓收端無需 relay metadata。 */
  origin?: string;
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
  /** ICE 路徑追蹤（ADR-0344）：通道開啟時 start、關閉時 reset。 */
  pathTracker: IcePathTracker;
}

const HIGH_WATER = 1 << 20; // 1 MiB：超過就暫緩送出，避免撐爆緩衝
const CHUNK_SIZE = 16_384;

/**
 * 背壓排空的保險計時器（毫秒，ADR-0345）。
 *
 * 正常路徑是 `bufferedamountlow` 事件。這個計時器只在「事件因競態而錯過」時救場——
 * 見 `flush()` 裡的說明。**不是輪詢**：事件一到就清掉，正常傳輸中它一次都不會觸發。
 */
const DRAIN_FALLBACK_MS = 250;

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

  /**
   * 與對方目前的 ICE 路徑（ADR-0344）：**最近一次探測的快取值**，同步、零成本。
   *
   * 通道未開一律 `"unknown"`——沒連上就沒有「路徑」可言，不要拿它當「直連」的反義詞用。
   */
  icePath(peerPk: PubkeyHex): IcePath {
    const peer = this.peers.get(peerPk);
    if (!peer?.dc || peer.dc.readyState !== "open") return "unknown";
    return peer.pathTracker.path;
  }

  /**
   * 立刻重測與對方的 ICE 路徑並回傳（ADR-0344）。會更新快取，變化時一併回報 `onConnectionState`。
   *
   * **送大檔前該叫這個，而不是 `icePath()`**：快取只在通道開啟後的前 15 秒內補測過，之後
   * 的切換（ICE restart、Wi-Fi 換 4G）不會反映。真正在意成本的時刻就重測一次，很便宜。
   */
  async refreshIcePath(peerPk: PubkeyHex): Promise<IcePath> {
    const peer = this.peers.get(peerPk);
    if (!peer?.dc || peer.dc.readyState !== "open") return "unknown";
    await peer.pathTracker.refresh(peer.pc);
    return this.icePath(peerPk);
  }

  /** 傳送一個檔案給對方，回傳此傳輸的 id（供 UI 追蹤進度）。 */
  /** 產生一個傳輸 id。群組傳檔（ADR-0124）先產一個，再讓每位成員**共用**它。 */
  newTransferId(): string {
    return `f${Date.now()}_${this.seq++}`;
  }

  /**
   * @param tid 外部指定的傳輸 id（ADR-0124 群組傳檔）。
   *
   * **群組的每位成員必須共用同一個 tid**：metadata 只有一個（rumor 跨成員共用），
   * 若每條 P2P 各自產 id，收件端就對不回同一則訊息——位元組到了，卻不知道它屬於哪一則。
   */
  sendFile(peerPk: PubkeyHex, file: OutgoingFile, tid?: string, origin?: string): string {
    const id = tid ?? this.newTransferId();
    const peer = this.ensurePeer(peerPk);
    peer.outbox.push({ id, file, ...(origin !== undefined ? { origin } : {}) });
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
      peer.pathTracker.reset();
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
      // 判定有變才會進來（tracker 自己去重）；只在通道仍開著時上報，避免斷線後的殘響。
      pathTracker: new IcePathTracker((path) => {
        if (conn.dc?.readyState === "open") this.handlers.onConnectionState?.(peerPk, true, path);
      }),
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
      // P2P 是盡力而為的加值通道（檔案／在線／輸入中）；失敗**不影響訊息**（文字走 relay）。
      // 跨網路／對稱型 NAT 連不起來屬預期，故**不對使用者報錯**、只記錄降級（ADR-0210）。
      if (pc.connectionState === "failed") {
        console.debug("[webrtc] P2P failed → degraded to relay", peerPk);
        conn.pathTracker.reset(); // ADR-0344：連線沒了，排程中的探測沒有意義，清掉免得洩漏計時器
        this.handlers.onConnectionState?.(peerPk, false); // ADR-0213：標題列晶片轉「直連未建立」
      }
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
    // ADR-0345：背壓改事件驅動。門檻設在高水位的一半——等它**全空**才續傳會讓管線
    // 一鬆一緊、吞吐掉一截；留一半在路上，續傳時網卡不會有空窗。
    dc.bufferedAmountLowThreshold = HIGH_WATER / 2;
    dc.onmessage = (m) => peer.rx.receive(m.data as string | ArrayBuffer);
    const onOpen = () => {
      // ADR-0213：通道可用 → 標題列晶片亮起。ADR-0344：此刻還不知道走哪條路，先誠實報 unknown，
      // 探測有結果再補一則（UI 因此會看到同一條連線的多次 true——這是預期，不是抖動）。
      this.handlers.onConnectionState?.(peerPk, true, "unknown");
      peer.pathTracker.start(peer.pc);
      this.flush(peerPk, peer);
    };
    dc.onopen = onOpen;
    dc.onclose = () => {
      peer.pathTracker.reset();
      this.handlers.onConnectionState?.(peerPk, false); // ADR-0213：直連中斷
    };
    dc.onerror = () => this.handlers.onError(peerPk, "資料通道錯誤");
    if (dc.readyState === "open") onOpen();
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

  /**
   * 依序送出 outbox 內的檔案（含背壓與進度）。
   *
   * ## 兩件事和以前不一樣（ADR-0345）
   *
   * 1. **分塊惰性產生**：`encodeFile` 現在是 generator，同一時間只有一塊框架存在。
   *    原本是先把整份檔案的框架都配置出來（100 MiB 的檔＝額外一整份 100 MiB）。
   * 2. **背壓改事件驅動**：滿了就等 `bufferedamountlow`，不再每 50ms 醒來問一次。
   */
  private flush(peerPk: PubkeyHex, peer: PeerConn): void {
    const dc = peer.dc;
    if (!dc || dc.readyState !== "open") return;
    const job = peer.outbox.shift();
    if (!job) return;
    const chunks = encodeFile(job.file, job.id, CHUNK_SIZE, job.origin)[Symbol.iterator]();
    const size = job.file.bytes.length;
    let sentChunks = 0;
    let waiting: ReturnType<typeof setTimeout> | undefined;

    const stopWaiting = (): void => {
      dc.removeEventListener("bufferedamountlow", onDrain);
      if (waiting !== undefined) clearTimeout(waiting);
      waiting = undefined;
    };
    const onDrain = (): void => {
      stopWaiting();
      pump();
    };

    const pump = (): void => {
      if (dc.readyState !== "open") {
        stopWaiting();
        this.handlers.onError(peerPk, "傳輸中斷");
        return;
      }
      for (;;) {
        if (dc.bufferedAmount > HIGH_WATER) {
          // 掛上排空事件等它降到門檻（`bufferedAmountLowThreshold`＝HIGH_WATER/2，見 attachChannel）。
          //
          // ⚠ 另外掛一個保險計時器：事件只在 `bufferedAmount` **下降穿越**門檻時觸發，若它
          // 恰好在我們檢查與掛上監聽之間就降下去了，那一次觸發就錯過了——而錯過的後果是
          // 傳輸**永久卡住且不報錯**，是檔案傳輸最糟的失敗型態。保險計時器把「可能永久卡住」
          // 換成「最壞多等 250ms」。正常情況下事件先到，計時器會被清掉。
          dc.addEventListener("bufferedamountlow", onDrain);
          waiting = setTimeout(onDrain, DRAIN_FALLBACK_MS);
          (waiting as unknown as { unref?: () => void }).unref?.();
          return;
        }
        const next = chunks.next();
        if (next.done === true) break;
        const m = next.value;
        // 分塊框架為整段 buffer（offset 0），送底層 ArrayBuffer（零拷貝、無 base64 膨脹）。
        if (typeof m === "string") {
          dc.send(m); // file-begin
        } else {
          dc.send(m.buffer as ArrayBuffer);
          sentChunks += 1;
          this.handlers.onOutgoingProgress(peerPk, job.id, Math.min(size, sentChunks * CHUNK_SIZE), size);
        }
      }
      // 本檔送完，繼續下一個
      this.flush(peerPk, peer);
    };
    pump();
  }
}
