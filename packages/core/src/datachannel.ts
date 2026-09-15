import { utf8ToBytes } from "@noble/hashes/utils";

/**
 * P2P 資料通道上的**控制**訊息（JSON 字串）。檔案分塊改走二進位框架
 * （見 {@link encodeFileChunk}），省去 base64 約 33% 膨脹（F5/C4）。
 */
export type DataMessage =
  | { t: "nudge" }
  | { t: "typing" }
  /**
   * `hb`：發送端自報的在線信標節奏（毫秒，ADR-0109）。**必要**——P2P 在線狀態是由 `beat()`
   * 送出的，節奏與心跳相同；閒置時每 5 分鐘才一則。收端若用固定的短窗判離線，會把
   * 「在線但閒置」的人誤判為離線。相容舊版：缺此欄位則退回預設容忍窗。
   */
  | { t: "presence"; s: string; m: string; np: string; hb?: number }
  /**
   * `chunkSize`（ADR-0345）＝送出端的分塊大小。**收端據此把每塊直接寫進最終緩衝區的
   * `seq * chunkSize` 位移**，不必先把每塊留在 Map 裡再拼一次（省掉一整份檔案的複製）。
   * 舊版對端沒有這個欄位 ⇒ 收端退回「依到達順序循序寫入」（見 `receiveChunk`）。
   */
  | {
      t: "file-begin";
      id: string;
      name: string;
      mime: string;
      size: number;
      chunks: number;
      chunkSize?: number;
      origin?: string;
    };

/** 資料通道可能收到的原始資料（控制為字串、檔案分塊為二進位）。 */
export type RawData = string | ArrayBuffer | Uint8Array;

const FRAME_CHUNK = 0x01;

/** 把 ArrayBuffer/Uint8Array 正規化為 Uint8Array（不複製）。 */
function asBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * 檔案分塊二進位框架：`[type=1][idLen][id(ASCII)][seq(uint32 BE)][chunk bytes]`。
 * id 為 app 產生的短 ASCII 字串（≤255 位元組）。
 */
export function encodeFileChunk(id: string, seq: number, bytes: Uint8Array): Uint8Array {
  const idBytes = utf8ToBytes(id);
  if (idBytes.length > 255) throw new Error("檔案 id 過長");
  const frame = new Uint8Array(1 + 1 + idBytes.length + 4 + bytes.length);
  frame[0] = FRAME_CHUNK;
  frame[1] = idBytes.length;
  frame.set(idBytes, 2);
  new DataView(frame.buffer).setUint32(2 + idBytes.length, seq >>> 0, false);
  frame.set(bytes, 2 + idBytes.length + 4);
  return frame;
}

/** 解析二進位檔案分塊框架；非法回傳 null。 */
export function decodeFileChunk(data: ArrayBuffer | Uint8Array): { id: string; seq: number; bytes: Uint8Array } | null {
  const buf = asBytes(data);
  if (buf.length < 6 || buf[0] !== FRAME_CHUNK) return null;
  const idLen = buf[1]!;
  const headerEnd = 2 + idLen + 4;
  if (buf.length < headerEnd) return null;
  let id = "";
  for (let i = 2; i < 2 + idLen; i++) id += String.fromCharCode(buf[i]!);
  const seq = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(2 + idLen, false);
  // 複製出分塊資料，避免持有整個框架的底層 buffer。
  return { id, seq, bytes: buf.slice(headerEnd) };
}

export interface OutgoingFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/**
 * 惰性檔案來源（ADR-0346）：**知道多大、讀得出某一段**，但不保證整份在記憶體裡。
 *
 * 這是送大檔時 `OutgoingFile` 的替代品。`OutgoingFile.bytes` 意味著整檔已經在 RAM ——
 * 一個 2 GB 的檔案光是「準備送出」就先 OOM 了，連一個位元組都還沒上網。
 *
 * ⚠ **不取代 `OutgoingFile`**：需要整份位元組的路徑（ADR-0162 relay 暫存的加密分塊、
 * ADR-0161 儲存槽落盤、縮圖、EXIF 清除）仍吃 `OutgoingFile`，那些本來就只處理小檔。
 */
export interface OutgoingFileStream {
  name: string;
  mime: string;
  /** 位元組總數。**這才是權威**——惰性來源沒有 `bytes` 可量。 */
  size: number;
  /**
   * 讀取 `[offset, offset + length)`。回傳長度可小於 `length`（尾段），
   * 但**不得多於**——多了代表來源說謊，收端會判超出宣告大小而中止。
   */
  slice(offset: number, length: number): Promise<Uint8Array>;
}

/** `Blob`/`File` 的最小形狀（不綁 lib.dom，Node 18+ 的 Blob 也吃得下）。 */
export interface BlobLike {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * 把已在記憶體的 `OutgoingFile` 包成惰性來源。
 *
 * `slice` 走 `subarray`＝**不複製**，所以這層包裝對既有的位元組路徑是零成本的——
 * 它存在只是為了讓送檔管線**只有一條**，不必為「有 bytes」和「沒 bytes」各寫一遍。
 */
export function bytesStream(file: OutgoingFile): OutgoingFileStream {
  return {
    name: file.name,
    mime: file.mime,
    size: file.bytes.length,
    slice: (offset, length) => Promise.resolve(file.bytes.subarray(offset, offset + length)),
  };
}

/**
 * 把 `Blob`/`File` 包成惰性來源：**逐塊才讀，整檔不進 RAM**。
 *
 * 這是 ADR-0346 的重點——瀏覽器的 `File` 本來就只是磁碟上那份檔案的把手，
 * 是 `await f.arrayBuffer()` 那一行把它整份拉進了記憶體。
 */
export function blobStream(name: string, mime: string, blob: BlobLike): OutgoingFileStream {
  return {
    name,
    mime,
    size: blob.size,
    slice: async (offset, length) => {
      const end = Math.min(offset + length, blob.size);
      return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    },
  };
}

/** 兩種型態統一成惰性來源（送檔管線只認這個）。 */
export function asFileStream(file: OutgoingFile | OutgoingFileStream): OutgoingFileStream {
  return "bytes" in file ? bytesStream(file) : file;
}

/** 位元組總數，不管拿到的是哪一種型態。 */
export function fileSizeOf(file: OutgoingFile | OutgoingFileStream): number {
  return "bytes" in file ? file.bytes.length : file.size;
}

/**
 * 收檔落盤的去處（ADR-0347）：**來一塊寫一塊**，整檔不進 RAM。
 *
 * 由呼叫端（引擎）提供實作——core 不知道檔案系統長什麼樣，只知道「寫某個位移」與「收工」。
 */
export interface FileSink {
  /** 寫入 `[offset, offset + chunk.length)`。 */
  write(offset: number, chunk: Uint8Array): Promise<void> | void;
  /** 收齊：收尾並回報落腳處。 */
  close(): Promise<FileSinkResult> | FileSinkResult;
  /** 放棄：清掉半成品（逾時、超量、寫入失敗）。**不得拋例外**。 */
  abort(): void;
}

/** 落腳處的識別（OPFS 檔名／原生路徑）。UI 之後據此把檔案交給使用者。 */
export interface FileSinkResult {
  handle: string;
}

/**
 * 決定某個進來的檔案要不要串流落盤（ADR-0347）。
 *
 * 回 `null`＝**這個檔案走記憶體**。這是刻意保留的退路：小檔留在記憶體才能做縮圖與預覽，
 * 沒有檔案系統的環境（SSR、舊 webview）也得照常收得到檔案。
 */
export type OpenFileSink = (meta: {
  id: string;
  name: string;
  mime: string;
  size: number;
  origin?: string;
}) => Promise<FileSink | null> | FileSink | null;

export interface ReceivedFile {
  /** 傳輸 id（= 送出端 file-begin 的 id）；供關聯中繼 metadata 訊息與此 P2P 位元組（ADR-0093）。 */
  id: string;
  name: string;
  mime: string;
  /** 位元組總數。**這才是權威**——串流落盤時沒有 `bytes` 可量（ADR-0347）。 */
  size: number;
  /**
   * 整份位元組。**串流落盤時為 `undefined`**，改看 `sink`（ADR-0347）。
   *
   * 需要位元組的消費點（縮圖、儲存槽、relay 分塊重組）都只處理小檔，而小檔本來就走
   * 記憶體路徑；真正的大檔它們本來也吃不下。
   */
  bytes?: Uint8Array;
  /** 串流落盤的落腳處（ADR-0347）；記憶體路徑無此欄。 */
  sink?: FileSinkResult;
  /**
   * 公司儲存槽存放來源標註（ADR-0161／審查修正）：**隨 file-begin 幀本身傳**——收端據此
   * 直接判定為存放、不需等 relay metadata，消除位元組/metadata 兩傳輸的競態。一般檔案無此欄。
   */
  origin?: string;
}

const DEFAULT_CHUNK_SIZE = 16_384;

/** 編碼一則震動（Nudge）訊息。 */
export function encodeNudge(): string {
  return JSON.stringify({ t: "nudge" } satisfies DataMessage);
}

/** 編碼一則「正在輸入中」訊息（F5：P2P 通道可用時卸載中繼）。 */
export function encodeTyping(): string {
  return JSON.stringify({ t: "typing" } satisfies DataMessage);
}

/**
 * 編碼一則在線狀態訊息（ADR-0088：P2P 通道可用時把心跳卸載中繼，不再明簽廣播上線）。
 * `cadenceMs`＝自報的信標節奏（ADR-0109）；省略則收端退回預設容忍窗（相容舊版）。
 */
export function encodeDcPresence(s: string, m: string, np: string, cadenceMs?: number): string {
  return JSON.stringify({
    t: "presence",
    s,
    m,
    np,
    ...(cadenceMs !== undefined ? { hb: cadenceMs } : {}),
  } satisfies DataMessage);
}

/**
 * 將檔案編碼為一連串資料通道訊息：一則 `file-begin` 後接 N 則 `file-chunk`。
 * 不受中繼站 JSON 大小限制，速度僅受雙方頻寬影響。
 *
 * 🔴 **async generator**——同一時間只有**一塊**存在（ADR-0345），而且分塊是
 * **逐塊才從來源讀**（ADR-0346）：來源若是 `Blob`/`File`，整檔從頭到尾不進 RAM。
 *
 * 呼叫端 `for await`；需要陣列的地方（測試）自行收集。
 */
export async function* streamFile(
  file: OutgoingFile | OutgoingFileStream,
  id: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  /** 儲存槽存放來源標註（ADR-0161／審查修正）：隨 file-begin 傳，一般檔案省略。 */
  origin?: string,
): AsyncGenerator<string | Uint8Array, void, void> {
  const src = asFileStream(file);
  const total = Math.ceil(src.size / chunkSize);
  yield JSON.stringify({
    t: "file-begin",
    id,
    name: src.name,
    mime: src.mime,
    size: src.size,
    chunks: total,
    chunkSize,
    ...(origin !== undefined ? { origin } : {}),
  } satisfies DataMessage);
  for (let seq = 0; seq < total; seq++) {
    const offset = seq * chunkSize;
    yield encodeFileChunk(id, seq, await src.slice(offset, Math.min(chunkSize, src.size - offset)));
  }
}

export interface DataChannelHandlers {
  onNudge?: () => void;
  onTyping?: () => void;
  /** 經 P2P 通道收到對方在線狀態（ADR-0088 (e)：心跳卸載中繼）。 */
  onPresence?: (p: { s: string; m: string; np: string; hb?: number }) => void;
  onFile?: (file: ReceivedFile) => void;
  onError?: (reason: string) => void;
}

/** 接收端的資源上限（防 OOM 與未完成檔案佔用記憶體）。 */
export interface DataChannelLimits {
  /**
   * 單一檔案最大位元組數。預設 1 GiB（ADR-0349）。
   *
   * 這個上限在串流落盤之前是 100 MiB，而**那個數字是記憶體逼出來的，不是產品決策**
   * （ADR-0345）。三個平台都能串流之後才調高——但**只有真的會落盤的檔案吃得到它**，
   * 見 `maxMemoryFileSize`。
   */
  maxFileSize?: number;
  /**
   * **不落盤時**的單一檔案上限（ADR-0349）。預設 100 MiB——就是串流之前的舊天花板。
   *
   * 🔴 為什麼要分兩個上限：`openSink` 可能不存在（沒掛）、也可能在執行期回 `null`
   * （私密模式、配額拒絕、小檔）。那些情況會**退回記憶體**——而退回記憶體的路徑若沒有
   * 自己的上限，把 `maxFileSize` 調到 1 GiB 就等於把 OOM 從「擋下來」變成「等它發生」。
   * 拒絕比 OOM 誠實：使用者至少知道發生了什麼。
   */
  maxMemoryFileSize?: number;
  /** 單一檔案最大分塊數。預設 1,000,000。 */
  maxChunks?: number;
  /** 同時進行中的檔案數上限。預設 16。 */
  maxConcurrentFiles?: number;
  /**
   * 串流落盤時，**等著被寫入**的分塊最多能累積多少位元組（ADR-0347）。預設 8 MiB。
   *
   * 🔴 為什麼需要這個上限：資料通道**沒有收端流量控制**——瀏覽器會照收不誤，我們無法
   * 叫對方慢一點。落盤若比網路慢，佇列就會無限長大，記憶體問題原封不動地搬到佇列裡。
   * 超過上限即中止該檔並報錯——比靜默吃光記憶體誠實。實務上磁碟遠快於 P2P 頻寬，
   * 正常傳輸永遠碰不到它。
   */
  maxQueuedBytes?: number;
  /**
   * 小於這個大小的檔案**不落盤**（ADR-0347）。預設 8 MiB。
   *
   * 小檔留在記憶體，縮圖（ADR-0102）、公司儲存槽（ADR-0161）、預覽才有位元組可用；
   * 為了幾百 KB 的圖去開檔案、寫入、再讀回來也不划算。
   */
  sinkMinBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GiB（ADR-0349：串流落盤之後才拆得掉）
const DEFAULT_MAX_MEMORY_FILE_SIZE = 100 * 1024 * 1024; // 串流之前的舊天花板，退回記憶體時仍適用
const DEFAULT_MAX_CHUNKS = 1_000_000;
const DEFAULT_MAX_CONCURRENT = 16;
const DEFAULT_MAX_QUEUED_BYTES = 8 * 1024 * 1024;
const DEFAULT_SINK_MIN_BYTES = 8 * 1024 * 1024;
/** 抑制名單長度：只需要撐過「中止後還在路上的那些分塊」，不必記得久。 */
const SUPPRESS_MAX = 64;

interface Partial {
  meta: { name: string; mime: string; size: number; chunks: number; chunkSize?: number; origin?: string };
  /**
   * 最終緩衝區——每塊**直接寫進去**，不再逐塊留存後重拼（ADR-0345：省掉一整份複製）。
   *
   * 🔴 **延後到第一塊才配置。** 在 `file-begin` 就配置很誘人（程式更短），但那等於讓
   * 對方**一個位元組都不用送**就吃掉 `size` 的記憶體——`maxConcurrentFiles` 16 × 100 MiB
   * ＝ 1.6 GB，免費。延後配置把成本拉回「他得真的送資料」，與改動前一致。
   */
  buf: Uint8Array | null;
  /** 已收到的分塊序號：去重與完成判定用。存的是**數字**，不是位元組。 */
  seen: Set<number>;
  /** 無 `chunkSize`（舊版對端）時的循序寫入游標。 */
  offset: number;

  // ── 串流落盤模式（ADR-0347）。以上的 `buf` 在這個模式下恆為 null。 ──
  /**
   * `"memory"`＝走 `buf`；`"opening"`＝正在開 sink，分塊先進 `queue`；
   * `"sink"`＝已開好，`queue` 由 drain 迴圈寫出。
   */
  mode: "memory" | "opening" | "sink";
  sink: FileSink | null;
  /** 等著被寫入的分塊（`maxQueuedBytes` 設上限）。 */
  queue: { at: number; bytes: Uint8Array }[];
  queued: number;
  /** drain 迴圈是否正在跑（避免並行寫入同一個 sink）。 */
  draining: boolean;
  /** 分塊已全部收到，只差寫完＋收尾。 */
  allReceived: boolean;
  /** 已中止（錯誤或超量）：後續分塊一律丟棄，不重複報錯。 */
  failed: boolean;
}

/** 接收資料通道訊息，處理 Nudge 與檔案分塊重組。 */
export class DataChannelReceiver {
  private readonly partials = new Map<string, Partial>();
  private readonly maxFileSize: number;
  private readonly maxMemoryFileSize: number;
  private readonly maxChunks: number;
  private readonly maxConcurrent: number;
  private readonly maxQueuedBytes: number;
  private readonly sinkMinBytes: number;
  /**
   * 已中止／已放棄的傳輸 id（ADR-0347）。
   *
   * 🔴 為什麼需要：中止後剩下的分塊**還在路上**，而它們會一一撞上「未知檔案分塊 id」
   * 再各報一次錯。一個中止的 1 GB 傳輸＝數萬則錯誤回呼。這裡把它們靜靜丟掉——
   * 中止的理由已經報過一次了。有界（`SUPPRESS_MAX`），不會無限長大。
   */
  private readonly suppressed = new Set<string>();

  constructor(
    private readonly handlers: DataChannelHandlers = {},
    limits: DataChannelLimits = {},
    /**
     * 串流落盤的去處（ADR-0347）。未提供＝一律走記憶體（既有行為，一個位元組都不變）。
     */
    private readonly openSink?: OpenFileSink,
  ) {
    this.maxFileSize = limits.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxMemoryFileSize = limits.maxMemoryFileSize ?? DEFAULT_MAX_MEMORY_FILE_SIZE;
    this.maxChunks = limits.maxChunks ?? DEFAULT_MAX_CHUNKS;
    this.maxConcurrent = limits.maxConcurrentFiles ?? DEFAULT_MAX_CONCURRENT;
    this.maxQueuedBytes = limits.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.sinkMinBytes = limits.sinkMinBytes ?? DEFAULT_SINK_MIN_BYTES;
  }

  /** 放棄一個進行中的檔案（如逾時）。串流中的半成品一併清掉。 */
  abort(id: string): void {
    const partial = this.partials.get(id);
    if (!partial) return;
    partial.failed = true;
    partial.sink?.abort();
    this.partials.delete(id);
    this.suppress(id);
  }

  /** 記下一個不該再為它報錯的傳輸 id（有界）。 */
  private suppress(id: string): void {
    this.suppressed.add(id);
    if (this.suppressed.size > SUPPRESS_MAX) {
      const oldest = this.suppressed.values().next().value;
      if (oldest !== undefined) this.suppressed.delete(oldest);
    }
  }

  receive(raw: RawData): void {
    // 二進位資料 = 檔案分塊框架；字串 = JSON 控制訊息。
    if (typeof raw !== "string") {
      this.receiveChunk(raw);
      return;
    }

    let msg: DataMessage;
    try {
      msg = JSON.parse(raw) as DataMessage;
    } catch {
      this.handlers.onError?.("資料通道訊息非法 JSON");
      return;
    }

    switch (msg.t) {
      case "nudge":
        this.handlers.onNudge?.();
        return;
      case "typing":
        this.handlers.onTyping?.();
        return;
      case "presence":
        this.handlers.onPresence?.({ s: msg.s, m: msg.m, np: msg.np, ...(msg.hb !== undefined ? { hb: msg.hb } : {}) });
        return;
      case "file-begin":
        if (msg.size < 0 || msg.chunks < 0 || msg.size > this.maxFileSize || msg.chunks > this.maxChunks) {
          this.handlers.onError?.(`檔案 ${msg.id} 超出上限（size=${msg.size}, chunks=${msg.chunks}）`);
          return;
        }
        if (this.partials.size >= this.maxConcurrent && !this.partials.has(msg.id)) {
          this.handlers.onError?.("同時進行中的檔案數已達上限");
          return;
        }
        {
        const partial: Partial = {
          // origin 來自對方（遠端可控）→ 限型別與長度（審查修正）。
          meta: {
            name: msg.name,
            mime: msg.mime,
            size: msg.size,
            chunks: msg.chunks,
            // chunkSize 同樣遠端可控 → 只接受正整數；不合理即當作沒給（退回循序寫入）。
            ...(typeof msg.chunkSize === "number" && Number.isInteger(msg.chunkSize) && msg.chunkSize > 0
              ? { chunkSize: msg.chunkSize }
              : {}),
            ...(typeof msg.origin === "string" ? { origin: msg.origin.slice(0, 200) } : {}),
          },
          buf: null,
          seen: new Set(),
          offset: 0,
          mode: "memory",
          sink: null,
          queue: [],
          queued: 0,
          draining: false,
          allReceived: false,
          failed: false,
        };
        this.partials.set(msg.id, partial);
        // ADR-0347：夠大才落盤。小檔留記憶體——縮圖/儲存槽/預覽需要位元組，
        // 而為了幾百 KB 去開檔、寫入、再讀回來也不划算。
        if (this.openSink && msg.size >= this.sinkMinBytes && msg.chunks > 0) {
          partial.mode = "opening";
          void this.beginSink(msg.id, partial);
        } else if (msg.size > this.maxMemoryFileSize) {
          // ADR-0349：這個檔不會落盤（沒掛 sink、或小於落盤門檻卻又超過記憶體上限——
          // 後者只可能是門檻被設得比記憶體上限還大的設定錯誤），而它大到不該進記憶體。
          this.fail(msg.id, partial, `檔案 ${msg.id} 過大且無法落盤（${msg.size} 位元組）`);
          return;
        }
        if (msg.chunks === 0) this.complete(msg.id);
        return;
        }
      default:
        this.handlers.onError?.("未知資料通道訊息類型");
    }
  }

  /** 處理二進位檔案分塊框架：算出位移後**直接寫進最終緩衝區**（ADR-0345）。 */
  private receiveChunk(data: ArrayBuffer | Uint8Array): void {
    const chunk = decodeFileChunk(data);
    if (!chunk) {
      this.handlers.onError?.("資料通道二進位框架非法");
      return;
    }
    const partial = this.partials.get(chunk.id);
    if (!partial) {
      // 已中止的傳輸剩下的分塊還在路上——靜靜丟掉，理由已經報過一次了。
      if (!this.suppressed.has(chunk.id)) this.handlers.onError?.(`未知檔案分塊 id：${chunk.id}`);
      return;
    }
    // 序號必須落在宣告的範圍內。這條讓「收滿 chunks 塊」等價於「每一塊都到齊」——
    // 舊版是收滿後再逐一檢查有沒有洞，現在是不可能有洞。
    if (partial.failed) return; // 已中止：後續分塊一律丟棄
    if (chunk.seq >= partial.meta.chunks) {
      this.fail(chunk.id, partial, `檔案 ${chunk.id} 分塊序號 ${chunk.seq} 超出宣告範圍，已中止`);
      return;
    }
    if (partial.seen.has(chunk.seq)) return; // 重複塊：忽略（原本也不重複計數）

    const cs = partial.meta.chunkSize;
    let at: number;
    if (cs !== undefined) {
      at = chunk.seq * cs; // 有 chunkSize ⇒ 位移可直接算，亂序送達照樣寫對地方
    } else {
      // 舊版對端沒給 chunkSize ⇒ 只能靠到達順序推算位移。資料通道是**可靠且有序**的，
      // 所以正常情況下這條路徑等價；真的跳號時寧可中止也不要靜默寫錯位置。
      if (chunk.seq !== partial.seen.size) {
        this.fail(chunk.id, partial, `檔案 ${chunk.id} 分塊亂序且對端未提供 chunkSize，已中止`);
        return;
      }
      at = partial.offset;
    }
    if (at + chunk.bytes.length > partial.meta.size) {
      this.fail(chunk.id, partial, `檔案 ${chunk.id} 實際資料超出宣告大小，已中止`);
      return;
    }

    partial.seen.add(chunk.seq);
    partial.offset = Math.max(partial.offset, at + chunk.bytes.length);
    const last = partial.seen.size === partial.meta.chunks;

    if (partial.mode === "memory") {
      // 延後配置（見 `Partial.buf`）：到這裡才確定對方真的在送資料。
      partial.buf ??= new Uint8Array(partial.meta.size);
      partial.buf.set(chunk.bytes, at);
      if (last) this.complete(chunk.id);
      return;
    }

    // ── 串流落盤（ADR-0347）──
    // ⚠ `chunk.bytes` 是 `decodeFileChunk` 切出來的副本，但它與整個框架共用底層 buffer。
    // 排進佇列＝要一直留到寫出去為止，所以**這裡必須真的複製**，否則整個框架（含表頭）
    // 都被這一小段釘住不放。
    partial.queue.push({ at, bytes: new Uint8Array(chunk.bytes) });
    partial.queued += chunk.bytes.length;
    if (last) partial.allReceived = true;
    if (partial.queued > this.maxQueuedBytes) {
      // 資料通道沒有收端流量控制——叫不動對方慢一點。佇列爆掉就中止，別靜默吃光記憶體。
      this.fail(chunk.id, partial, `檔案 ${chunk.id} 落盤速度跟不上接收速度，已中止`);
      return;
    }
    void this.drain(chunk.id, partial);
  }

  /** 開啟 sink；失敗或回 `null` 一律退回記憶體模式（收檔不能因為磁碟問題而整個失敗）。 */
  private async beginSink(id: string, partial: Partial): Promise<void> {
    let sink: FileSink | null = null;
    try {
      sink = await this.openSink!({
        id,
        name: partial.meta.name,
        mime: partial.meta.mime,
        size: partial.meta.size,
        ...(partial.meta.origin !== undefined ? { origin: partial.meta.origin } : {}),
      });
    } catch {
      sink = null;
    }
    if (this.partials.get(id) !== partial || partial.failed) {
      sink?.abort(); // 開 sink 期間這個檔已被中止／取代
      return;
    }
    if (!sink) {
      // ADR-0349：退回記憶體之前先問一句「它進得了記憶體嗎」。開 sink 失敗（私密模式、
      // 配額拒絕）是執行期才知道的，所以這個守衛不能只做在 file-begin。
      if (partial.meta.size > this.maxMemoryFileSize) {
        this.fail(id, partial, `檔案 ${id} 無法落盤且過大，已中止（${partial.meta.size} 位元組）`);
        return;
      }
      // 退回記憶體：把等在佇列裡的分塊倒進緩衝區。
      partial.mode = "memory";
      partial.buf ??= new Uint8Array(partial.meta.size);
      for (const q of partial.queue) partial.buf.set(q.bytes, q.at);
      const done = partial.allReceived;
      partial.queue = [];
      partial.queued = 0;
      if (done) this.complete(id);
      return;
    }
    partial.sink = sink;
    partial.mode = "sink";
    void this.drain(id, partial);
  }

  /** 把佇列寫出去；收齊且寫完即收尾。同一個檔案同時只會有一輪在跑。 */
  private async drain(id: string, partial: Partial): Promise<void> {
    if (partial.draining || partial.mode !== "sink" || !partial.sink) return;
    partial.draining = true;
    try {
      while (partial.queue.length > 0) {
        const next = partial.queue.shift()!;
        partial.queued -= next.bytes.length;
        await partial.sink.write(next.at, next.bytes);
        // 寫入期間可能被中止（超量、逾時、通道關閉）。
        if (partial.failed || this.partials.get(id) !== partial) return;
      }
      if (!partial.allReceived) return;
      const result = await partial.sink.close();
      if (this.partials.get(id) !== partial) return;
      this.partials.delete(id);
      this.handlers.onFile?.({
        id,
        name: partial.meta.name,
        mime: partial.meta.mime,
        size: partial.meta.size,
        sink: result,
        ...(partial.meta.origin !== undefined ? { origin: partial.meta.origin } : {}),
      });
    } catch (e) {
      this.fail(id, partial, `檔案 ${id} 落盤失敗：${String(e)}`);
    } finally {
      partial.draining = false;
    }
  }

  /** 中止一個進行中的檔案並報錯（只報一次）。 */
  private fail(id: string, partial: Partial, reason: string): void {
    if (partial.failed) return;
    partial.failed = true;
    partial.queue = [];
    partial.queued = 0;
    try {
      partial.sink?.abort();
    } catch {
      /* abort 不得拋，但別因為它壞掉而吞掉原本的錯誤 */
    }
    this.partials.delete(id);
    this.suppress(id);
    this.handlers.onError?.(reason);
  }

  /** 記憶體模式的收尾（串流模式走 `drain`）。 */
  private complete(id: string): void {
    const partial = this.partials.get(id);
    if (!partial || partial.failed) return;
    this.partials.delete(id);
    this.handlers.onFile?.({
      id,
      name: partial.meta.name,
      mime: partial.meta.mime,
      size: partial.meta.size,
      // 空檔（chunks === 0）從未配置過緩衝區。
      bytes: partial.buf ?? new Uint8Array(partial.meta.size),
      ...(partial.meta.origin !== undefined ? { origin: partial.meta.origin } : {}),
    });
  }
}
