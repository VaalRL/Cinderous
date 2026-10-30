// --state-dir（ADR-0404 §2）：讓 CLI 用引擎原本的 LocalStorage 持久化。
//
// 引擎的 `LocalStorage`（ADR-0112 靜態加密、去重回放、聯絡人、FS 狀態）與裝置 id（`getKv()`）
// 都讀寫全域 `localStorage`。Node 沒有能落地的那一份，所以這裡給一個**檔案為底**的實作，
// 裝到全域，其餘全部沿用引擎——不另寫一套狀態格式。
//
// 兩條護欄：
//  - **綁定身分**：DEK 由 nsec 導出，換一把金鑰開同一個目錄會讀出全空，下一次寫入就把原本的狀態蓋掉。
//  - **獨占鎖**：每次寫入都是整份覆寫，兩個程序共用一個目錄會互相吃掉對方的更新。

import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setKvBackend } from "@cinderous/engine";

export class StateDirError extends Error {}

/** 記憶體的 `Storage`（沒給 --state-dir 時用；不落地）。 */
export class MemoryKv implements Storage {
  protected readonly data = new Map<string, string>();

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
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

/** 檔案為底的 `Storage`：每次寫入整份落地（先寫暫存檔再改名，斷電不會留下半份）。 */
export class FileKv extends MemoryKv {
  constructor(private readonly file: string) {
    super();
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

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    this.flush();
  }
  override removeItem(key: string): void {
    if (!this.data.has(key)) return;
    super.removeItem(key);
    this.flush();
  }
  override clear(): void {
    super.clear();
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
/** 上次用的 `--name`。 */
const NAME_KEY = "cli.name";

/**
 * 這次送給對方的顯示名稱。名稱每次都會送出，忘了帶 `--name` 時，對方 App 裡的名稱會被改回預設——
 * 有狀態目錄就記住上次給的、沒給時沿用。
 */
export function resolveName(kv: Storage | undefined, name: string | undefined): string {
  if (name !== undefined) {
    kv?.setItem(NAME_KEY, name);
    return name;
  }
  return kv?.getItem(NAME_KEY) ?? "cli";
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM＝程序在、只是不是我們的；ESRCH＝不在了。
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 空的或看不懂的鎖放了這麼久還沒寫好，才當成「寫入前就當掉」。 */
const HALF_WRITTEN_GRACE_MS = 10_000;

const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code;
const uniq = () => `${process.pid}.${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`;

/** 讀鎖的內容；鎖剛好被放掉＝undefined。 */
function readLock(lock: string): string | undefined {
  try {
    return readFileSync(lock, "utf8");
  } catch (e) {
    if (errCode(e) === "ENOENT") return undefined;
    throw e;
  }
}

/** 把鎖原子地建立成「已經寫好 pid」：先寫暫存檔再 hard link，別的程序不會讀到半寫的空檔。 */
function linkLock(lock: string, tmp: string): boolean {
  try {
    linkSync(tmp, lock);
    return true;
  } catch (e) {
    if (errCode(e) === "EEXIST") return false;
    if (errCode(e) !== "EPERM" && errCode(e) !== "ENOTSUP" && errCode(e) !== "EXDEV") throw e;
  }
  // 檔案系統不支援 hard link（FAT／exFAT）：退回 wx——空檔的窗口由 HALF_WRITTEN_GRACE_MS 擋。
  try {
    const fd = openSync(lock, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (e) {
    if (errCode(e) === "EEXIST") return false;
    throw e;
  }
}

function inUse(detail: string): StateDirError {
  return new StateDirError(`狀態目錄正在被另一個 cinder 程序使用（${detail}）；要同時跑請各給一個目錄`);
}

function takeLock(lock: string): void {
  const tmp = `${lock}.${uniq()}`;
  writeFileSync(tmp, String(process.pid), { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (linkLock(lock, tmp)) return;
      const held = readLock(lock);
      if (held === undefined) continue; // 剛好被放掉：再搶一次
      const pid = Number(held.trim());
      if (held.trim() !== "" && Number.isInteger(pid) && pid > 0) {
        if (pidAlive(pid)) throw inUse(`pid ${pid}`);
      } else {
        // 空的或看不懂：可能是別人正在寫（退回 wx 時）。放久了才算殘留。
        let age = 0;
        try {
          age = Date.now() - statSync(lock).mtimeMs;
        } catch {
          continue;
        }
        if (age < HALF_WRITTEN_GRACE_MS) throw inUse("鎖正在建立");
      }
      // 殘留鎖：原子地移到旁邊，再確認移走的是**剛剛看到的那一份**——
      // 兩個程序同時接手時，後到的那個可能移走的是先到者新建的鎖，要放回去並讓出。
      const aside = `${lock}.stale.${uniq()}`;
      try {
        renameSync(lock, aside);
      } catch (e) {
        if (errCode(e) === "ENOENT") continue;
        throw e;
      }
      const moved = readLock(aside);
      if (moved !== held) {
        try {
          linkSync(aside, lock);
        } catch {
          /* 又有第三個人拿到了：一樣讓出 */
        }
        unlinkQuiet(aside);
        throw inUse("另一個程序剛接手");
      }
      unlinkQuiet(aside);
    }
    throw new StateDirError(`拿不到狀態目錄的鎖：${lock}`);
  } finally {
    unlinkQuiet(tmp);
  }
}

function unlinkQuiet(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    /* 已經不在了 */
  }
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
  installKv(state.kv);
}

/**
 * 沒給 --state-dir：裝一份記憶體的。Node 25 起內建全域 localStorage，沒給 `--localstorage-file`
 * 時引擎一碰就印 ExperimentalWarning，agent 讀 stderr 會被干擾。
 */
export function installMemoryKv(): MemoryKv {
  const kv = new MemoryKv();
  installKv(kv);
  return kv;
}

function installKv(kv: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { value: kv, configurable: true, writable: true });
  setKvBackend(kv);
}
