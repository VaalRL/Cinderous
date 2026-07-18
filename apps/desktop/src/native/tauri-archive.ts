// 桌面封存基質（ADR-0111）：加密塊檔，`<store>/<ns>/archive/<convo>.<seq>.enc`。
//
// 為什麼是檔案而不是 IndexedDB：桌面的儲存**本來就是加密的**（encstore，AES-256-GCM，
// 金鑰在 OS 金鑰庫）。封存改走 IndexedDB 會是**明文**——那是靜態加密的**默默降級**。
// 走檔案則直接沿用同一把 db 金鑰與同一套加密，零新機制。

import { invoke } from "@tauri-apps/api/core";
import type { MessageArchive, StoredMessage } from "@cinderous/engine";

/** 封存 IO 管道（可注入以利測試）。 */
export interface ArchiveIo {
  append(namespace: string, convo: string, seq: number, json: string): Promise<void>;
  count(namespace: string, convo: string): Promise<number>;
  load(namespace: string, convo: string, seq: number): Promise<string | null>;
  remove(namespace: string, convo: string): Promise<void>;
}

/** 產線 IO：走 Rust IPC（AES-256-GCM 加密落地）。 */
export const tauriArchiveIo: ArchiveIo = {
  append: (namespace, convo, seq, json) => invoke("archive_append", { namespace, convo, seq, json }),
  count: (namespace, convo) => invoke<number>("archive_count", { namespace, convo }),
  load: (namespace, convo, seq) => invoke<string | null>("archive_load", { namespace, convo, seq }),
  remove: (namespace, convo) => invoke("archive_remove", { namespace, convo }),
};

export class TauriArchive implements MessageArchive {
  constructor(
    private readonly namespace: string,
    private readonly io: ArchiveIo = tauriArchiveIo,
  ) {}

  async append(convo: string, messages: StoredMessage[]): Promise<void> {
    // seq 取自現有塊數 → 天然遞增、無需額外索引。
    const seq = await this.io.count(this.namespace, convo);
    await this.io.append(this.namespace, convo, seq, JSON.stringify(messages));
  }

  chunkCount(convo: string): Promise<number> {
    return this.io.count(this.namespace, convo);
  }

  async loadChunk(convo: string, seq: number): Promise<StoredMessage[]> {
    const json = await this.io.load(this.namespace, convo, seq);
    if (!json) return [];
    try {
      return JSON.parse(json) as StoredMessage[];
    } catch {
      return []; // 單一塊毀損不該讓整個歷史打不開
    }
  }

  remove(convo: string): Promise<void> {
    return this.io.remove(this.namespace, convo);
  }
}
