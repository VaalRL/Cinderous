// --state-dir（ADR-0404 §2）：讓 CLI 用引擎原本的 LocalStorage 持久化。
//
// 引擎的 `LocalStorage`（ADR-0112 靜態加密、去重回放、聯絡人、FS 狀態）與裝置 id（`getKv()`）
// 都讀寫全域 `localStorage`。Node 沒有能落地的那一份，所以這裡給一個**檔案為底**的實作，
// 裝到全域，其餘全部沿用引擎——不另寫一套狀態格式。
//
// 兩條護欄：
//  - **綁定身分**：DEK 由 nsec 導出，換一把金鑰開同一個目錄會讀出全空，下一次寫入就把原本的狀態蓋掉。
//  - **獨占鎖**：每次寫入都是整份覆寫，兩個程序共用一個目錄會互相吃掉對方的更新。

import { mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, closeSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setKvBackend } from "@cinderous/engine";

export class StateDirError extends Error {}

/** 檔案為底的 `Storage`：每次寫入整份落地（先寫暫存檔再改名，斷電不會留下半份）。 */
export class FileKv implements Storage {
  private readonly data: Map<string, string>;

  constructor(private readonly file: string) {
    this.data = new Map();
    if (!existsSync(file)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // 不可當成空的繼續跑：下一次寫入就會把壞掉之前的狀態永久蓋掉。
      throw new StateDirError(`狀態檔損毀，無法讀取：${file}（請先備份再處理，CLI 不會覆寫它）`);
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") this.data.set(k, v);
    }
  }

  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
    this.flush();
  }
  removeItem(key: string): void {
    if (this.data.delete(key)) this.flush();
  }
  clear(): void {
    this.data.clear();
    this.flush();
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data)), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export interface StateDir {
  readonly kv: FileKv;
  /** 放掉獨占鎖（程序結束前呼叫；當掉沒放，下一個程序會發現 pid 不在而接手）。 */
  release(): void;
}

/** 這個目錄綁定的身分（hex 公鑰）。 */
const PUBKEY_KEY = "cli.pubkey";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM＝程序在、只是不是我們的；ESRCH＝不在了。
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function takeLock(lock: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(lock, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) {
        throw new StateDirError(`狀態目錄正在被另一個 cinder 程序使用（pid ${pid}）；要同時跑請各給一個目錄`);
      }
      unlinkSync(lock); // 前一個程序當掉留下的鎖
    }
  }
  throw new StateDirError(`拿不到狀態目錄的鎖：${lock}`);
}

/** 開一個狀態目錄：建目錄、拿鎖、檢查綁定的身分。 */
export function openStateDir(dir: string, pubkey: string): StateDir {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, "lock");
  takeLock(lock);
  const release = () => {
    try {
      unlinkSync(lock);
    } catch {
      /* 已經不在了 */
    }
  };
  try {
    const kv = new FileKv(join(dir, "state.json"));
    const bound = kv.getItem(PUBKEY_KEY);
    if (bound !== null && bound !== pubkey) {
      throw new StateDirError("這個狀態目錄屬於另一個身分；請換一個目錄，或改用原本那把私鑰");
    }
    if (bound === null) kv.setItem(PUBKEY_KEY, pubkey);
    return { kv, release };
  } catch (e) {
    release();
    throw e;
  }
}

/** 把狀態目錄裝成全域 `localStorage`＋引擎的 KV（裝置 id 從此固定）。必須在建立後端之前呼叫。 */
export function installStateDir(state: StateDir): void {
  Object.defineProperty(globalThis, "localStorage", { value: state.kv, configurable: true, writable: true });
  setKvBackend(state.kv);
}
