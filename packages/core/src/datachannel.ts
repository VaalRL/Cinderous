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

interface Partial {
  meta: { name: string; mime: string; size: number; chunks: number };
  received: Map<number, Uint8Array>;
}

/** 接收資料通道訊息，處理 Nudge 與檔案分塊重組。 */
export class DataChannelReceiver {
  private readonly partials = new Map<string, Partial>();

  constructor(private readonly handlers: DataChannelHandlers = {}) {}

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
        this.partials.set(msg.id, {
          meta: { name: msg.name, mime: msg.mime, size: msg.size, chunks: msg.chunks },
          received: new Map(),
        });
        if (msg.chunks === 0) this.complete(msg.id);
        return;
      case "file-chunk": {
        const partial = this.partials.get(msg.id);
        if (!partial) {
          this.handlers.onError?.(`未知檔案分塊 id：${msg.id}`);
          return;
        }
        partial.received.set(msg.seq, base64.decode(msg.data));
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
