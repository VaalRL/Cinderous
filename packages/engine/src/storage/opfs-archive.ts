// 行動／網頁封存基質（ADR-0111）：OPFS（Origin Private File System）。
//
// webview 裡**沒有**檔案系統——`react-native-web` 跑在 DOM 上，不能寫任意檔案。
// OPFS 是最接近「檔案」的東西：**真的檔案**（有 file handle、可分塊讀寫），只是沙箱化、
// 使用者看不到。
//
// 關鍵：**OPFS 的配額與 localStorage 是完全不同的池子**——localStorage 是 5–10MB 的小額度，
// OPFS 走 Storage API 配額（通常是可用磁碟的一大部分）。這正是封存必須換基質的理由：
// 把舊訊息從 `msgs.bob` 搬到 `archive.bob`（同在 localStorage）**完全不解決問題**。
//
// **加密**（ADR-0112）：塊檔以 AES-256-GCM 加密，金鑰由 nsec 導出（與 localStorage 同一把）。
// 未提供金鑰時退回明文——但那條路只該出現在「使用者根本沒有 nsec」的情境。
//
// 移植到真正的 React Native 時換掉本檔即可（expo-file-system），介面不變。

import { openValue, sealValue } from "@cinder/core";

import type { MessageArchive } from "./archive.js";
import type { StoredMessage } from "./types.js";

const ROOT = "cinder-archive";
const SUFFIX = ".json";

/**
 * `FileSystemDirectoryHandle.keys()` 是較新的 API，尚不在本專案 TS 版本的 lib.dom 裡。
 * 只宣告我們用到的那一個方法（不擴充全域型別，避免污染）。
 */
type DirHandle = FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };

/** 本環境是否支援 OPFS。 */
export function hasOpfs(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

/**
 * 開啟某身分的 OPFS 封存。
 *
 * **不支援時回 `null`（而不是一個什麼都不做的替身）**：這是刻意的安全設計。封存搬移是
 * 「先寫封存 → 成功後裁切熱區」；若封存是個靜默的 no-op，熱區仍會被裁切 → **永久遺失**。
 * 回 `null` 讓呼叫端不掛封存 → 不裁切 → 熱區無上限（退回舊行為，但資料完好）。
 */
export async function openOpfsArchive(namespace: string, storageKey?: Uint8Array): Promise<MessageArchive | null> {
  if (!hasOpfs()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle(ROOT, { create: true });
    const dir = await app.getDirectoryHandle(namespace || "legacy", { create: true });
    return new OpfsArchive(dir as DirHandle, storageKey);
  } catch {
    return null; // 私密模式／配額拒絕等 → 寧可不封存，也不冒遺失風險
  }
}

class OpfsArchive implements MessageArchive {
  constructor(
    private readonly dir: DirHandle,
    /** 靜態加密金鑰（ADR-0112）：與 localStorage 同一把（皆由 nsec 導出）。 */
    private readonly dek: Uint8Array | undefined,
  ) {}

  private name(convo: string, seq: number): string {
    return `${convo}.${seq}${SUFFIX}`;
  }

  async append(convo: string, messages: StoredMessage[]): Promise<void> {
    const seq = await this.chunkCount(convo); // seq 取自現有塊數 → 天然遞增
    const file = await this.dir.getFileHandle(this.name(convo, seq), { create: true });
    const writable = await file.createWritable();
    const json = JSON.stringify(messages);
    await writable.write(this.dek ? sealValue(this.dek, json) : json); // ADR-0112
    await writable.close();
  }

  async chunkCount(convo: string): Promise<number> {
    const prefix = `${convo}.`;
    let max = -1;
    for await (const key of this.dir.keys()) {
      if (!key.startsWith(prefix) || !key.endsWith(SUFFIX)) continue;
      const seq = Number(key.slice(prefix.length, -SUFFIX.length));
      if (Number.isInteger(seq) && seq > max) max = seq;
    }
    return max + 1;
  }

  async loadChunk(convo: string, seq: number): Promise<StoredMessage[]> {
    try {
      const file = await this.dir.getFileHandle(this.name(convo, seq));
      const raw = await (await file.getFile()).text();
      // 舊的明文塊仍讀得出來（`openValue` 對無前綴者原樣回傳）——升級不能讓既有封存變亂碼。
      const json = this.dek ? openValue(this.dek, raw) : raw;
      if (json === null) return []; // 密文解不開（錯鑰/竄改）
      return JSON.parse(json) as StoredMessage[];
    } catch {
      return []; // 不存在或單一塊毀損 → 不拖垮其餘塊
    }
  }

  async remove(convo: string): Promise<void> {
    const prefix = `${convo}.`;
    const doomed: string[] = [];
    for await (const key of this.dir.keys()) {
      if (key.startsWith(prefix) && key.endsWith(SUFFIX)) doomed.push(key);
    }
    for (const key of doomed) await this.dir.removeEntry(key);
  }
}
