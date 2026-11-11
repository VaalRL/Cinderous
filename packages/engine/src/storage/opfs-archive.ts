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
// **加密**（ADR-0112）：塊檔以 AES-256-GCM 加密。未提供金鑰時退回明文——但那條路只該出現在
// 「使用者根本沒有 nsec」的情境。
//
// **每塊一把隨機金鑰**（ADR-0413；ADR-0298 §2 的第一階段）：
//
//   <convo>.<seq>.json  塊本體＝sealValue(K_seg, json)
//   <convo>.<seq>.key   塊金鑰的包裹＝wrapSegmentKey(dek, K_seg)；dek 由 nsec 導出
//
// 過去每一塊都直接用 dek 加密，而刪除只是 `removeEntry`——在 flash 上刪檔不保證位元組被抹掉，
// 殘留的塊**拿到 nsec 就照樣解得開**。現在刪除對話＝先銷毀 `.key`（覆寫後刪除）、再刪塊：
// 塊金鑰是隨機的、不是導出的，沒有包裹就沒有任何辦法重建，殘留的塊變成解不開的亂數。
//
// ⚠ 量的改善，不是質的保證：`.key` 自己也在同一個介質上（ADR-0298 §6；
// `archive-residue.test.ts` 最後把這條界線釘住）。
// ⚠ 升級前寫下的塊沒有 `.key`，仍直接用 dek 解——讀得到，但沒有上面的刪除保障。
// 不整批重新加密：重寫只會多一份新檔，舊密文的殘留還是在、還是用 dek 解得開。
//
// 移植到真正的 React Native 時換掉本檔即可（expo-file-system），介面不變。

import { newSegmentKey, openValue, sealValue, unwrapSegmentKey, wrapSegmentKey } from "@cinderous/core";

import type { MessageArchive } from "./archive.js";
import type { StoredMessage } from "./types.js";

const ROOT = "cinder-archive";
const SUFFIX = ".json";
const KEY_SUFFIX = ".key";

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

/**
 * 移除某身分的**全部**封存（「移除此身分」，ADR-0202／0413）。
 *
 * 過去網頁與行動端移除身分只清 localStorage，**OPFS 封存整批留著**——而它由 nsec 導出的
 * 金鑰保護，同一把 nsec 再輸入一次就解得開。這與「移除身分＝刪本機資料」不符。
 *
 * 先銷毀每一份金鑰包裹、再刪整個目錄（順序同 `remove`）。空 namespace 不做事：
 * 舊的單一身分用共用的 legacy 目錄（同 `clearStorageNamespace` 的規則）。盡力而為，不丟例外。
 */
export async function wipeOpfsArchive(namespace: string): Promise<void> {
  if (!namespace || !hasOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const app = await root.getDirectoryHandle(ROOT);
    const dir = (await app.getDirectoryHandle(namespace)) as DirHandle;
    const archive = new OpfsArchive(dir, undefined);
    const names: string[] = [];
    for await (const key of dir.keys()) names.push(key);
    for (const key of names.filter((k) => k.endsWith(KEY_SUFFIX))) await archive.destroyKey(key);
    for (const key of names.filter((k) => !k.endsWith(KEY_SUFFIX))) await dir.removeEntry(key).catch(() => {});
    await app.removeEntry(namespace, { recursive: true }).catch(() => {});
  } catch {
    /* 沒有這個目錄（從沒封存過）或 OPFS 不可用 → 沒有東西要清 */
  }
}

class OpfsArchive implements MessageArchive {
  constructor(
    private readonly dir: DirHandle,
    /** 根金鑰（ADR-0112）：與 localStorage 同一把（皆由 nsec 導出）。ADR-0413 起只用來包塊金鑰。 */
    private readonly dek: Uint8Array | undefined,
  ) {}

  private name(convo: string, seq: number): string {
    return `${convo}.${seq}${SUFFIX}`;
  }

  private keyName(convo: string, seq: number): string {
    return `${convo}.${seq}${KEY_SUFFIX}`;
  }

  private async writeFile(name: string, data: string): Promise<void> {
    const file = await this.dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(data);
    await writable.close();
  }

  /** 讀檔；不存在回 `null`。 */
  private async readFile(name: string): Promise<string | null> {
    try {
      const file = await this.dir.getFileHandle(name);
      return await (await file.getFile()).text();
    } catch {
      return null;
    }
  }

  async append(convo: string, messages: StoredMessage[]): Promise<void> {
    const seq = await this.chunkCount(convo); // seq 取自現有塊數 → 天然遞增
    const json = JSON.stringify(messages);
    if (!this.dek) {
      await this.writeFile(this.name(convo, seq), json);
      return;
    }
    // ADR-0413：**先包裹、後塊**。中途當機留下的是「有包裹、沒有塊」——塊數以 `.json` 計，
    // 下一次 append 會用同一個 seq 重來並以新金鑰覆蓋這份孤兒包裹。反過來（先塊後包裹）
    // 當機會留下一個沒有金鑰的塊＝那一塊訊息遺失。
    const seg = newSegmentKey();
    await this.writeFile(this.keyName(convo, seq), wrapSegmentKey(this.dek, seg));
    await this.writeFile(this.name(convo, seq), sealValue(seg, json));
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
      const raw = await this.readFile(this.name(convo, seq));
      if (raw === null) return [];
      if (!this.dek) return JSON.parse(raw) as StoredMessage[];
      const wrapped = await this.readFile(this.keyName(convo, seq));
      // 有包裹：解不開（換了 nsec／遭竄改／已被銷毀時覆寫過）就是讀不到，不退回用 dek 直接解——
      // 那一塊本來就不是用 dek 加密的。沒有包裹＝升級前的舊塊，直接用 dek；
      // 更舊的明文塊也仍讀得出來（`openValue` 對無前綴者原樣回傳）——升級不能讓既有封存變亂碼。
      const key = wrapped === null ? this.dek : unwrapSegmentKey(this.dek, wrapped);
      if (key === null) return [];
      const json = openValue(key, raw);
      if (json === null) return []; // 密文解不開（錯鑰/竄改）
      return JSON.parse(json) as StoredMessage[];
    } catch {
      return []; // 單一塊毀損 → 不拖垮其餘塊
    }
  }

  async remove(convo: string): Promise<void> {
    const prefix = `${convo}.`;
    const wraps: string[] = [];
    const chunks: string[] = [];
    for await (const key of this.dir.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (key.endsWith(KEY_SUFFIX)) wraps.push(key);
      else if (key.endsWith(SUFFIX)) chunks.push(key);
    }
    // ADR-0413：**先銷毀所有金鑰包裹，再刪塊**。包裹沒了，塊就算刪不乾淨也解不開；
    // 反過來做，中途當機會留下「塊刪了一半、金鑰全都還在」。
    for (const key of wraps) await this.destroyKey(key);
    for (const key of chunks) await this.dir.removeEntry(key);
  }

  /**
   * 銷毀一份金鑰包裹：先以等長的零覆寫、再刪除。
   *
   * 覆寫是**盡力而為**：flash 的控制器可能把新內容寫到別的區塊，舊位元組仍在。
   * 不因此省略——幾十個位元組，成本近乎零。覆寫失敗也照樣刪除。
   */
  async destroyKey(name: string): Promise<void> {
    try {
      const old = await this.readFile(name);
      if (old !== null) await this.writeFile(name, "0".repeat(old.length));
    } catch {
      /* 覆寫失敗不擋刪除 */
    }
    await this.dir.removeEntry(name);
  }
}
