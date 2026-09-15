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

export interface ReceivedFile {
  /** 傳輸 id（= 送出端 file-begin 的 id）；供關聯中繼 metadata 訊息與此 P2P 位元組（ADR-0093）。 */
  id: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
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
 * 🔴 **這是 generator，不是陣列**（ADR-0345）。原本它一次把**所有**分塊框架都配置出來
 * 再回傳——一個 100 MiB 的檔就是額外一整份 100 MiB（6,400 個框架物件）躺在記憶體裡，
 * 而它們唯一的用途是等著被逐一送出。改成惰性產生後，同一時間只有**一塊**存在。
 *
 * 呼叫端照樣 `for...of`；需要陣列的地方（測試）自行 `[...encodeFile(...)]`。
 */
export function* encodeFile(
  file: OutgoingFile,
  id: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  /** 儲存槽存放來源標註（ADR-0161／審查修正）：隨 file-begin 傳，一般檔案省略。 */
  origin?: string,
): Generator<string | Uint8Array, void, void> {
  const total = Math.ceil(file.bytes.length / chunkSize);
  yield JSON.stringify({
    t: "file-begin",
    id,
    name: file.name,
    mime: file.mime,
    size: file.bytes.length,
    chunks: total,
    chunkSize,
    ...(origin !== undefined ? { origin } : {}),
  } satisfies DataMessage);
  for (let seq = 0; seq < total; seq++) {
    // subarray 不複製；框架本身才是那一份複製，而它在送出後即可回收。
    yield encodeFileChunk(id, seq, file.bytes.subarray(seq * chunkSize, (seq + 1) * chunkSize));
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
  /** 單一檔案最大位元組數。預設 100 MiB。 */
  maxFileSize?: number;
  /** 單一檔案最大分塊數。預設 1,000,000。 */
  maxChunks?: number;
  /** 同時進行中的檔案數上限。預設 16。 */
  maxConcurrentFiles?: number;
}

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;
const DEFAULT_MAX_CHUNKS = 1_000_000;
const DEFAULT_MAX_CONCURRENT = 16;

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
}

/** 接收資料通道訊息，處理 Nudge 與檔案分塊重組。 */
export class DataChannelReceiver {
  private readonly partials = new Map<string, Partial>();
  private readonly maxFileSize: number;
  private readonly maxChunks: number;
  private readonly maxConcurrent: number;

  constructor(
    private readonly handlers: DataChannelHandlers = {},
    limits: DataChannelLimits = {},
  ) {
    this.maxFileSize = limits.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.maxChunks = limits.maxChunks ?? DEFAULT_MAX_CHUNKS;
    this.maxConcurrent = limits.maxConcurrentFiles ?? DEFAULT_MAX_CONCURRENT;
  }

  /** 放棄一個進行中的檔案（如逾時）。 */
  abort(id: string): void {
    this.partials.delete(id);
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
        this.partials.set(msg.id, {
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
        });
        if (msg.chunks === 0) this.complete(msg.id);
        return;
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
      this.handlers.onError?.(`未知檔案分塊 id：${chunk.id}`);
      return;
    }
    // 序號必須落在宣告的範圍內。這條讓「收滿 chunks 塊」等價於「每一塊都到齊」——
    // 舊版是收滿後再逐一檢查有沒有洞，現在是不可能有洞。
    if (chunk.seq >= partial.meta.chunks) {
      this.partials.delete(chunk.id);
      this.handlers.onError?.(`檔案 ${chunk.id} 分塊序號 ${chunk.seq} 超出宣告範圍，已中止`);
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
        this.partials.delete(chunk.id);
        this.handlers.onError?.(`檔案 ${chunk.id} 分塊亂序且對端未提供 chunkSize，已中止`);
        return;
      }
      at = partial.offset;
    }
    if (at + chunk.bytes.length > partial.meta.size) {
      this.partials.delete(chunk.id);
      this.handlers.onError?.(`檔案 ${chunk.id} 實際資料超出宣告大小，已中止`);
      return;
    }

    // 延後配置（見 `Partial.buf`）：到這裡才確定對方真的在送資料。
    partial.buf ??= new Uint8Array(partial.meta.size);
    partial.buf.set(chunk.bytes, at);
    partial.seen.add(chunk.seq);
    partial.offset = Math.max(partial.offset, at + chunk.bytes.length);
    if (partial.seen.size === partial.meta.chunks) this.complete(chunk.id);
  }

  private complete(id: string): void {
    const partial = this.partials.get(id);
    if (!partial) return;
    this.partials.delete(id);
    this.handlers.onFile?.({
      id,
      name: partial.meta.name,
      mime: partial.meta.mime,
      // 空檔（chunks === 0）從未配置過緩衝區。
      bytes: partial.buf ?? new Uint8Array(partial.meta.size),
      ...(partial.meta.origin !== undefined ? { origin: partial.meta.origin } : {}),
    });
  }
}
