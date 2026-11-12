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
//   <convo>.<seq>.json        塊本體＝"s1:<kid>:" + sealValue(K_seg, json)
//   <convo>.<seq>.<kid>.key   塊金鑰的包裹＝wrapSegmentKey(dek, K_seg)；dek 由 nsec 導出
//
// 過去每一塊都直接用 dek 加密，而刪除只是 `removeEntry`——在 flash 上刪檔不保證位元組被抹掉，
// 殘留的塊**拿到 nsec 就照樣解得開**。現在刪除對話＝先刪 `.key`、再刪塊：
// 塊金鑰是隨機的、不是導出的，沒有包裹就沒有任何辦法重建，殘留的塊變成解不開的亂數。
//
// **塊自己記下用的是哪一份包裹**（`kid`，隨機 16 個 hex；審查後加上）。包裹不靠「同一個 seq」
// 對上塊，所以這幾種情況都不會把一塊配到別人的金鑰：
//   - 兩個分頁同時封存同一個 seq：各寫各的包裹，最後留下的那一塊讀得到（後寫者贏，與加金鑰前相同）。
//   - 降回舊版又升級：舊版寫的塊沒有 `s1:` 開頭＝舊塊，直接用 dek 解，不會撞上留下來的包裹。
//   - 當機留下的孤兒包裹：下一次 append 另寫一份，不覆蓋誰。
// 多出來的孤兒包裹只有幾十個位元組，移除對話時一起刪。
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
/** 新格式塊的開頭：`s1:<kid>:`，後面接 `sealValue` 的輸出（ADR-0413）。 */
const KEYED = "s1:";
const KID_RE = /^[0-9a-f]{16}$/;

/**
 * 同一身分的封存寫入，**跨分頁互斥**（Web Locks；ADR-0413 後續 0）。
 *
 * 每個分頁各有自己的 `ArchiveWriter`，佇列只排得了自己分頁的寫入。兩個分頁同時封存同一個對話時，
 * 都會算出同一個 seq，後寫的塊蓋掉先寫的——那一千則就沒了。鎖住「算 seq → 寫包裹 → 寫塊」整段，
 * 第二個分頁就會拿到下一個 seq。兩個分頁搬的可能是同一批訊息，那只是重複，讀取端以 id 去重。
 *
 * 移除對話、移除身分也拿同一把鎖：不會刪到一半時另一個分頁（或同一個分頁的搬移）又寫進來。
 *
 * 沒有 Web Locks 的環境照舊直接做（同一分頁內仍由 `ArchiveWriter` 排隊）。
 */
function withArchiveLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (typeof locks?.request !== "function") return fn();
  return locks.request(name, () => fn()) as Promise<T>;
}

function lockName(namespace: string): string {
  return `cinder-archive:${namespace || "legacy"}`;
}

function newKid(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
    return new OpfsArchive(dir as DirHandle, storageKey, lockName(namespace));
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
  // 拿封存的鎖：正在寫的那一塊（這個分頁或別的分頁）寫完才刪，不會留下剛寫的包裹與塊。
  await withArchiveLock(lockName(namespace), async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle(ROOT);
      const dir = (await app.getDirectoryHandle(namespace)) as DirHandle;
      const archive = new OpfsArchive(dir, undefined, lockName(namespace));
      const names: string[] = [];
      for await (const key of dir.keys()) names.push(key);
      for (const key of names.filter((k) => k.endsWith(KEY_SUFFIX))) await archive.removeQuietly(key);
      for (const key of names.filter((k) => !k.endsWith(KEY_SUFFIX))) await dir.removeEntry(key).catch(() => {});
      await app.removeEntry(namespace, { recursive: true }).catch(() => {});
    } catch {
      /* 沒有這個目錄（從沒封存過）或 OPFS 不可用 → 沒有東西要清 */
    }
  });
}

class OpfsArchive implements MessageArchive {
  constructor(
    private readonly dir: DirHandle,
    /** 根金鑰（ADR-0112）：與 localStorage 同一把（皆由 nsec 導出）。ADR-0413 起只用來包塊金鑰。 */
    private readonly dek: Uint8Array | undefined,
    /** 跨分頁互斥的鎖名（每個身分一把，見 `withArchiveLock`） */
    private readonly lock: string,
  ) {}

  private name(convo: string, seq: number): string {
    return `${convo}.${seq}${SUFFIX}`;
  }

  private keyName(convo: string, seq: number, kid: string): string {
    return `${convo}.${seq}.${kid}${KEY_SUFFIX}`;
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

  append(convo: string, messages: StoredMessage[]): Promise<void> {
    return withArchiveLock(this.lock, () => this.appendLocked(convo, messages));
  }

  private async appendLocked(convo: string, messages: StoredMessage[]): Promise<void> {
    const seq = await this.chunkCount(convo); // seq 取自現有塊數 → 天然遞增（鎖住，別的分頁不會同時算出同一個）
    const json = JSON.stringify(messages);
    if (!this.dek) {
      await this.writeFile(this.name(convo, seq), json);
      return;
    }
    // ADR-0413：**先包裹、後塊**。中途當機留下的是「有包裹、沒有塊」——塊數以 `.json` 計，
    // 下一次 append 會用同一個 seq 重來、另寫一份包裹（孤兒包裹留到移除對話時一起刪）。
    // 反過來（先塊後包裹）當機會留下一個沒有金鑰的塊＝那一塊訊息遺失。
    const seg = newSegmentKey();
    const kid = newKid();
    await this.writeFile(this.keyName(convo, seq, kid), wrapSegmentKey(this.dek, seg));
    await this.writeFile(this.name(convo, seq), `${KEYED}${kid}:${sealValue(seg, json)}`);
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
      // 沒有 `s1:` 開頭＝升級前（或降版時）寫下的舊塊，直接用 dek；更舊的明文塊也仍讀得出來
      // （`openValue` 對無前綴者原樣回傳）——升級不能讓既有封存變亂碼。
      let key = this.dek;
      let body = raw;
      if (raw.startsWith(KEYED)) {
        const kid = raw.slice(KEYED.length, KEYED.length + 16);
        if (!KID_RE.test(kid) || raw[KEYED.length + 16] !== ":") return [];
        // 包裹不在（已刪除）或解不開（換了 nsec／遭竄改）就是讀不到，不退回用 dek 直接解——
        // 那一塊本來就不是用 dek 加密的。
        const wrapped = await this.readFile(this.keyName(convo, seq, kid));
        const seg = wrapped === null ? null : unwrapSegmentKey(this.dek, wrapped);
        if (seg === null) return [];
        key = seg;
        body = raw.slice(KEYED.length + 17);
      }
      const json = openValue(key, body);
      if (json === null) return []; // 密文解不開（錯鑰/竄改）
      return JSON.parse(json) as StoredMessage[];
    } catch {
      return []; // 單一塊毀損 → 不拖垮其餘塊
    }
  }

  remove(convo: string): Promise<void> {
    return withArchiveLock(this.lock, () => this.removeLocked(convo));
  }

  private async removeLocked(convo: string): Promise<void> {
    const prefix = `${convo}.`;
    const wraps: string[] = [];
    const chunks: string[] = [];
    for await (const key of this.dir.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (key.endsWith(KEY_SUFFIX)) wraps.push(key);
      else if (key.endsWith(SUFFIX)) chunks.push(key);
    }
    // ADR-0413：**先刪所有金鑰包裹，再刪塊**。包裹沒了，塊就算刪不乾淨也解不開；
    // 反過來做，中途當機會留下「塊刪了一半、金鑰全都還在」。
    // 每一個檔各自嘗試：一個刪不掉（例如另一個分頁正握著它）不能讓後面的全都留下來。
    let failed = 0;
    for (const key of wraps) if (!(await this.removeQuietly(key))) failed++;
    for (const key of chunks) if (!(await this.removeQuietly(key))) failed++;
    if (failed > 0) console.warn(`[archive] 移除對話封存時有 ${failed} 個檔刪不掉`);
  }

  /**
   * 刪一個檔；失敗回 `false`，不丟例外。
   *
   * 這裡**不做「先覆寫再刪」**：OPFS 的 `createWritable` 依規格是寫到另一份暫存檔、關閉時才換上，
   * 碰不到原本的位元組，覆寫只會多留一份痕跡。包裹的殘留能不能被撿回來取決於介質（ADR-0298 §6）。
   */
  async removeQuietly(name: string): Promise<boolean> {
    try {
      await this.dir.removeEntry(name);
      return true;
    } catch {
      return false;
    }
  }
}
