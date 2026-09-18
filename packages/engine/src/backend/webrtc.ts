import {
  CandidateBatch,
  createSignal,
  DataChannelReceiver,
  encodeDcPresence,
  asFileStream,
  fileSizeOf,
  fileBeginMessage,
  fileEndMessage,
  streamFileChunks,
  encodeTyping,
  readSignal,
  type IceCandidateData,
  type NostrEvent,
  type OutgoingFile,
  type OutgoingFileStream,
  type OpenFileSink,
  type PubkeyHex,
  type ReceivedFile,
  type SecretKey,
  type Signal,
  FileSourceUnavailableError,
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
  /**
   * 續傳斷點查詢（ADR-0355）：這個檔本機的暫存檔已經有幾個位元組？
   * 未提供＝不協商續傳（中斷後從頭重送）。
   */
  resumeOffset?: (
    peer: PubkeyHex,
    meta: { id: string; name: string; mime: string; size: number },
  ) => number | Promise<number>;
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
  /** 已正規化為惰性來源（ADR-0346）：位元組檔與 Blob 檔共用同一條送出管線。 */
  file: OutgoingFileStream;
  /** 儲存槽存放來源標註（ADR-0161／審查修正）：隨 file-begin 傳，讓收端無需 relay metadata。 */
  origin?: string;
  /**
   * 這是中斷後的重試（ADR-0355）：送出 `file-begin` 後**等一下**對方的 `file-resume`，
   * 拿到斷點才開始送分塊。第一次送不等——那會給每個檔案加上一次無謂的往返。
   */
  mayResume?: boolean;
  /** 已重試次數（有上限，避免對端一直斷線時無限重排）。 */
  attempts?: number;
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
  /** 等待中的續傳協商：傳輸 id → 收到 `file-resume` 時要呼叫的解析函式（ADR-0355）。 */
  resumeWaiters: Map<string, (have: number) => void>;
  /**
   * 對端是否回過能力回執（`file-resume`）＝它聽得懂新訊息（ADR-0355）。
   *
   * 🔴 沒有這個旗標就不能送 `file-end`：舊版收端遇到不認得的控制訊息會呼叫 `onError`，
   * 那條路一路走到 App 會在對話裡跳一行 ⚠ 警告——為了加校驗而讓對方看到假錯誤，不可接受。
   */
  peerUnderstandsV2: boolean;
  /** 是否已有一個檔案正在送（非同步管線需要防重入才不會兩檔交錯）。 */
  sending: boolean;
}

/** 續傳協商的等待上限：超過就當對方沒有斷點，從頭送。 */
const RESUME_WAIT_MS = 400;
/** 單一檔案的重試次數上限。 */
const MAX_RESEND_ATTEMPTS = 3;

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
    /** 收檔串流落盤的去處（ADR-0347）；未提供＝一律走記憶體。 */
    private readonly openSink?: OpenFileSink,
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
  sendFile(peerPk: PubkeyHex, file: OutgoingFile | OutgoingFileStream, tid?: string, origin?: string): string {
    const id = tid ?? this.newTransferId();
    const peer = this.ensurePeer(peerPk);
    // 進 outbox 就正規化為惰性來源（ADR-0346）：位元組檔包一層 subarray（零複製），
    // Blob 檔原樣帶入 ⇒ 底下的送出管線只需要認得一種東西。
    peer.outbox.push({ id, file: asFileStream(file), ...(origin !== undefined ? { origin } : {}) });
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
      rx: new DataChannelReceiver(
        {
          onFile: (file) => this.handlers.onIncoming(peerPk, file),
          onTyping: () => this.handlers.onTyping?.(peerPk),
          onPresence: (p) => this.handlers.onPresence?.(peerPk, p),
          onError: (reason) => this.handlers.onError(peerPk, reason),
          // 續傳協商（ADR-0355）。`reply` 恆接：它同時承載能力回執，沒有宿主的
          // `resumeOffset` 也要回（have=0），否則整檔校驗永遠用不上。
          reply: (m: string) => {
            if (conn.dc?.readyState === "open") conn.dc.send(m);
          },
          onResumeRequest: (id, have, peerVersion) => {
            // 收到回執＝對端是新版。這是送 `file-end` 的唯一依據。
            if (peerVersion >= 2) conn.peerUnderstandsV2 = true;
            const waiter = conn.resumeWaiters.get(id);
            if (waiter) {
              conn.resumeWaiters.delete(id);
              waiter(have);
            }
          },
          ...(this.handlers.resumeOffset
            ? { resumeOffset: (meta) => this.handlers.resumeOffset!(peerPk, meta) }
            : {}),
        },
        {},
        this.openSink, // ADR-0347：大檔串流落盤；未提供＝一律走記憶體（既有行為）
      ),
      hasRemote: false,
      pendingCandidates: [],
      outbox: [],
      started: false,
      resumeWaiters: new Map(),
      peerUnderstandsV2: false,
      sending: false,
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

  /** 等對方回報續傳斷點；逾時（或對方是舊版、沒有斷點）就回 0＝從頭送。 */
  private awaitResume(peer: PeerConn, id: string): Promise<number> {
    return new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        peer.resumeWaiters.delete(id);
        resolve(0);
      }, RESUME_WAIT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
      peer.resumeWaiters.set(id, (have) => {
        clearTimeout(timer);
        resolve(have);
      });
    });
  }

  /**
   * 依序送出 outbox 內的檔案（含背壓與進度）。
   *
   * ## 三件事和最初不一樣
   *
   * 1. **分塊惰性產生**（ADR-0345）：同一時間只有一塊框架存在。原本是先把整份檔案的
   *    框架都配置出來（100 MiB 的檔＝額外一整份 100 MiB）。
   * 2. **背壓改事件驅動**（ADR-0345）：滿了就等 `bufferedamountlow`，不再每 50ms 醒來問。
   * 3. **來源惰性讀取**（ADR-0346）：分塊是逐塊向來源要的。來源若是 `Blob`/`File`，
   *    整檔從頭到尾不進 RAM——這是 pump 變成非同步的唯一理由。
   */
  private flush(peerPk: PubkeyHex, peer: PeerConn): void {
    const dc = peer.dc;
    if (!dc || dc.readyState !== "open") return;
    if (peer.sending) return; // 非同步管線：防重入才不會兩檔交錯
    const job = peer.outbox.shift();
    if (!job) return;
    peer.sending = true;
    const size = fileSizeOf(job.file);
    // 整檔雜湊只在對端回過能力回執時才算：不算就不必為了雜湊從第 0 位元組重讀一遍
    // （續傳時那是白花的本機 I/O），也不會送出對方不認得的訊息。
    let sha: string | undefined;
    const wantDigest = peer.peerUnderstandsV2;
    let chunks: AsyncIterator<Uint8Array> | undefined;
    let sentChunks = 0;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    // 讀分塊是非同步的（ADR-0346），所以 pump 可能在 await 中途被排空事件再次喚醒。
    // 這個旗標讓第二次呼叫直接返回——正在跑的那一輪自己會繼續。
    let running = false;

    const stopWaiting = (): void => {
      dc.removeEventListener("bufferedamountlow", onDrain);
      if (waiting !== undefined) clearTimeout(waiting);
      waiting = undefined;
    };
    const onDrain = (): void => {
      stopWaiting();
      void pump();
    };

    const pump = async (): Promise<void> => {
      if (running) return;
      running = true;
      try {
        await pumpLoop();
      } catch (e) {
        // 🔴 原本這裡只有 try/finally。呼叫端是 `void pump()`，所以 `pumpLoop` 一旦拋出
        // （最常見的是來源檔案傳到一半被搬走，`slice` reject），就成了 unhandled rejection：
        // `sending` 歸零了但 job 沒重排、`onError` 沒觸發，寄件者畫面停在「傳送中」，
        // 而**那個對話的外送佇列整條卡死**。與 ADR-0294 P2 修掉的靜默分歧同型。
        //
        // 現在一律收斂成使用者看得到的錯誤。**不要再 shift 一次**——`job` 在 `flush`
        // 開頭就已經從 outbox 取出來了，再 shift 會誤丟下一個還沒送的檔案。
        peer.sending = false;
        this.handlers.onError(
          peerPk,
          e instanceof FileSourceUnavailableError
            ? `送不出「${e.fileName}」：檔案已不在原來的位置`
            : `送檔失敗：${e instanceof Error ? e.message : String(e)}`,
        );
        // 進度歸零，讓 UI 的「傳送中」停下來（沿用既有 handler，不另開一個）。
        this.handlers.onOutgoingProgress(peerPk, job.id, 0, size);
        // 讀不到的檔案不重排：重試幾次都一樣，只會讓下一次 flush 再撞同一個。
        if (peer.outbox.length > 0) this.flush(peerPk, peer);
      } finally {
        running = false;
      }
    };

    const pumpLoop = async (): Promise<void> => {
      for (;;) {
        // 每一圈都重驗：讀分塊是非同步的，await 回來時通道可能已經關了。
        if (dc.readyState !== "open") {
          stopWaiting();
          peer.sending = false;
          // 中斷 → 排回 outbox 等通道再開（ADR-0355）。沒有這一步，「續傳」就只是個協定
          // 欄位——沒有人會再送第二次，收端的半截暫存檔也永遠等不到剩下的位元組。
          if ((job.attempts ?? 0) < MAX_RESEND_ATTEMPTS) {
            peer.outbox.unshift({ ...job, mayResume: true, attempts: (job.attempts ?? 0) + 1 });
            return; // 不報錯：這是一次可續傳的中斷，不是失敗
          }
          this.handlers.onError(peerPk, "傳輸中斷");
          return;
        }
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
        if (!chunks) {
          // `file-begin` 也走背壓（上面那兩道檢查已經過了才會到這裡）——收端要看到它
          // 才會回報斷點，所以它必須是第一件送出的事（ADR-0355）。
          dc.send(fileBeginMessage(job.file, job.id, CHUNK_SIZE, job.origin));
          // 續傳協商只在**重試**時等：第一次送就等一輪，等於給每個檔案加上一次無謂的往返。
          const fromByte = job.mayResume ? await this.awaitResume(peer, job.id) : 0;
          if (fromByte > 0) {
            sentChunks = Math.floor(fromByte / CHUNK_SIZE);
            this.handlers.onOutgoingProgress(peerPk, job.id, Math.min(size, fromByte), size);
          }
          chunks = streamFileChunks(
            job.file,
            job.id,
            CHUNK_SIZE,
            fromByte,
            wantDigest ? (v) => (sha = v) : undefined,
          )[Symbol.asyncIterator]();
          continue; // 回迴圈頂端重驗：協商期間通道可能已經關了
        }
        const next = await chunks.next();
        if (next.done === true) break;
        // 分塊框架為整段 buffer（offset 0），送底層 ArrayBuffer（零拷貝、無 base64 膨脹）。
        dc.send(next.value.buffer as ArrayBuffer);
        sentChunks += 1;
        this.handlers.onOutgoingProgress(peerPk, job.id, Math.min(size, sentChunks * CHUNK_SIZE), size);
      }
      // 結尾的整檔雜湊，緊跟最後一塊之後送出（有序通道 ⇒ 收端收齊後立刻拿到）。
      if (sha && dc.readyState === "open") dc.send(fileEndMessage(job.id, sha));
      peer.sending = false;
      // 本檔送完，繼續下一個
      this.flush(peerPk, peer);
    };
    void pump();
  }
}
