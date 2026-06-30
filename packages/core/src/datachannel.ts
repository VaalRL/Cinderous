import { base64 } from "@scure/base";

/** P2P 資料通道上的訊息（通道本身由 WebRTC DTLS 加密）。 */
export type DataMessage =
  | { t: "nudge" }
  | { t: "file-begin"; id: string; name: string; mime: string; size: number; chunks: number }
  | { t: "file-chunk"; id: string; seq: number; data: string };

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

/**
 * 將檔案編碼為一連串資料通道訊息：一則 `file-begin` 後接 N 則 `file-chunk`。
 * 不受中繼站 JSON 大小限制，速度僅受雙方頻寬影響。
 */
export function encodeFile(file: OutgoingFile, id: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  const total = Math.ceil(file.bytes.length / chunkSize);
  const messages: string[] = [
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
    messages.push(
      JSON.stringify({ t: "file-chunk", id, seq, data: base64.encode(slice) } satisfies DataMessage),
    );
  }
  return messages;
}

export interface DataChannelHandlers {
  onNudge?: () => void;
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

  receive(raw: string): void {
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
      case "file-chunk": {
        const partial = this.partials.get(msg.id);
        if (!partial) {
          this.handlers.onError?.(`未知檔案分塊 id：${msg.id}`);
          return;
        }
        const bytes = base64.decode(msg.data);
        if (!partial.received.has(msg.seq)) partial.receivedBytes += bytes.length;
        if (partial.receivedBytes > partial.meta.size) {
          this.partials.delete(msg.id);
          this.handlers.onError?.(`檔案 ${msg.id} 實際資料超出宣告大小，已中止`);
          return;
        }
        partial.received.set(msg.seq, bytes);
        if (partial.received.size === partial.meta.chunks) this.complete(msg.id);
        return;
      }
      default:
        this.handlers.onError?.("未知資料通道訊息類型");
    }
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
