import { utf8ToBytes } from "@noble/hashes/utils";

/**
 * P2P 資料通道上的**控制**訊息（JSON 字串）。檔案分塊改走二進位框架
 * （見 {@link encodeFileChunk}），省去 base64 約 33% 膨脹（F5/C4）。
 */
export type DataMessage =
  | { t: "nudge" }
  | { t: "typing" }
  | { t: "file-begin"; id: string; name: string; mime: string; size: number; chunks: number };

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
  name: string;
  mime: string;
  bytes: Uint8Array;
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
 * 將檔案編碼為一連串資料通道訊息：一則 `file-begin` 後接 N 則 `file-chunk`。
 * 不受中繼站 JSON 大小限制，速度僅受雙方頻寬影響。
 */
export function encodeFile(
  file: OutgoingFile,
  id: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
): (string | Uint8Array)[] {
  const total = Math.ceil(file.bytes.length / chunkSize);
  const messages: (string | Uint8Array)[] = [
    JSON.stringify({
      t: "file-begin",
      id,
      name: file.name,
      mime: file.mime,
      size: file.bytes.length,
      chunks: total,
    } satisfies DataMessage),
  ];
  for (let seq = 0; seq < total; seq++) {
    const slice = file.bytes.subarray(seq * chunkSize, (seq + 1) * chunkSize);
    messages.push(encodeFileChunk(id, seq, slice));
  }
  return messages;
}

export interface DataChannelHandlers {
  onNudge?: () => void;
  onTyping?: () => void;
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
  meta: { name: string; mime: string; size: number; chunks: number };
  received: Map<number, Uint8Array>;
  receivedBytes: number;
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
          meta: { name: msg.name, mime: msg.mime, size: msg.size, chunks: msg.chunks },
          received: new Map(),
          receivedBytes: 0,
        });
        if (msg.chunks === 0) this.complete(msg.id);
        return;
      default:
        this.handlers.onError?.("未知資料通道訊息類型");
    }
  }

  /** 處理二進位檔案分塊框架。 */
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
    if (!partial.received.has(chunk.seq)) partial.receivedBytes += chunk.bytes.length;
    if (partial.receivedBytes > partial.meta.size) {
      this.partials.delete(chunk.id);
      this.handlers.onError?.(`檔案 ${chunk.id} 實際資料超出宣告大小，已中止`);
      return;
    }
    partial.received.set(chunk.seq, chunk.bytes);
    if (partial.received.size === partial.meta.chunks) this.complete(chunk.id);
  }

  private complete(id: string): void {
    const partial = this.partials.get(id);
    if (!partial) return;
    this.partials.delete(id);

    const bytes = new Uint8Array(partial.meta.size);
    let offset = 0;
    for (let seq = 0; seq < partial.meta.chunks; seq++) {
      const chunk = partial.received.get(seq);
      if (!chunk) {
        this.handlers.onError?.(`檔案 ${id} 缺少分塊 ${seq}`);
        return;
      }
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.handlers.onFile?.({ name: partial.meta.name, mime: partial.meta.mime, bytes });
  }
}
