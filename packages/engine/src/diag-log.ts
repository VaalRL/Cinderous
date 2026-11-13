// ADR-0421：本機錯誤紀錄（診斷）。
//
// - **只存在這台裝置**：存在 localStorage（WebView 的資料夾），從不自動上傳；要給人看由使用者自己
//   在設定頁「複製」出去。
// - **寫入前先遮罩**：nsec／npub 等 bech32、長 hex（公鑰、事件 id、金鑰）、長 base64（密文）、
//   email、網址的 query／fragment 一律換成佔位字。錯誤訊息理論上不該帶這些，但我們不賭。
// - **環狀緩衝**：只留最近 cap 筆；同一錯誤連續爆（render 迴圈）合併成一筆加次數，不洗掉別的紀錄。
// - **記錄本身絕不丟例外**：store 壞掉時退回記憶體——診斷工具把 App 弄當是最糟的結局。

export type DiagSource = "window" | "promise" | "render" | "native";

export interface DiagEntry {
  /** 最後一次發生的時間（ms）。 */
  t: number;
  src: DiagSource;
  /** App 版本。 */
  v: string;
  msg: string;
  stack?: string;
  /** 連續發生次數（>1 才有）。 */
  n?: number;
}

export interface DiagStore {
  get(): string | null;
  set(value: string): void;
}

export interface DiagLog {
  record(src: DiagSource, err: unknown): void;
  list(): DiagEntry[];
  clear(): void;
  exportText(env: { platform: string; extra?: string }): string;
  subscribe(fn: () => void): () => void;
}

const MSG_MAX = 500;
const STACK_MAX = 2000;

/** 遮掉可識別身分／金鑰／密文的字串。順序有意義：先網址、再 bech32，最後才是泛用的 hex／base64。 */
export function redactDiag(text: string): string {
  return text
    .replace(/\b((?:https?|wss?):\/\/[^\s?#'"()]+)[?#][^\s'"()]*/gi, "$1")
    .replace(/\b(nsec|npub|ncryptsec|nprofile|nevent|naddr|note|nrelay)1[02-9ac-hj-np-z]{20,}/gi, (_m, p: string) => `[${p.toLowerCase()}]`)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[hex]")
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[b64]");
}

function describe(err: unknown): { msg: string; stack?: string } {
  if (err instanceof Error) {
    const stack = typeof err.stack === "string" ? err.stack : undefined;
    return { msg: `${err.name}: ${err.message}`, ...(stack ? { stack } : {}) };
  }
  if (typeof err === "string") return { msg: err };
  if (err === undefined) return { msg: "undefined" };
  try {
    return { msg: JSON.stringify(err) ?? String(err) };
  } catch {
    return { msg: String(err) };
  }
}

function parse(raw: string | null): DiagEntry[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object" && typeof x.msg === "string") as DiagEntry[]) : [];
  } catch {
    return [];
  }
}

export function memoryDiagStore(): DiagStore {
  let v: string | null = null;
  return {
    get: () => v,
    set: (x) => {
      v = x;
    },
  };
}

/** localStorage 版；拿不到（隱私模式、測試環境）就退回記憶體。 */
export function webDiagStore(key: string): DiagStore {
  const mem = memoryDiagStore();
  return {
    get: () => {
      try {
        return globalThis.localStorage?.getItem(key) ?? mem.get();
      } catch {
        return mem.get();
      }
    },
    set: (x) => {
      mem.set(x);
      try {
        globalThis.localStorage?.setItem(key, x);
      } catch {
        /* 寫不進去就只留記憶體 */
      }
    },
  };
}

export function createDiagLog(opts: { store: DiagStore; version: string; now?: () => number; cap?: number }): DiagLog {
  const now = opts.now ?? Date.now;
  const cap = opts.cap ?? 100;
  let entries = parse(safeGet(opts.store));
  const subs = new Set<() => void>();

  const save = (): void => {
    try {
      opts.store.set(JSON.stringify(entries));
    } catch {
      /* 持久化失敗不影響記憶體裡的紀錄 */
    }
    for (const fn of subs) {
      try {
        fn();
      } catch {
        /* 訂閱者的錯不能回頭弄壞記錄 */
      }
    }
  };

  return {
    record(src, err) {
      try {
        const d = describe(err);
        const msg = redactDiag(d.msg).slice(0, MSG_MAX);
        const stack = d.stack ? redactDiag(d.stack).slice(0, STACK_MAX) : undefined;
        const last = entries.at(-1);
        if (last && last.src === src && last.msg === msg) {
          entries = [...entries.slice(0, -1), { ...last, t: now(), n: (last.n ?? 1) + 1 }];
        } else {
          entries = [...entries, { t: now(), src, v: opts.version, msg, ...(stack ? { stack } : {}) }].slice(-cap);
        }
        save();
      } catch {
        /* 絕不丟例外 */
      }
    },
    list: () => entries.slice(),
    clear() {
      entries = [];
      save();
    },
    exportText(env) {
      const head = [
        "Cinderous 診斷紀錄（只存在本機）",
        `version ${opts.version}`,
        `platform ${env.platform}`,
        `${entries.length} 筆`,
      ];
      const body = entries.map((e) => {
        const times = e.n && e.n > 1 ? ` (×${e.n})` : "";
        const line = `${new Date(e.t).toISOString()} [${e.src}] ${e.msg}${times} · v${e.v}`;
        return e.stack ? `${line}\n${e.stack}` : line;
      });
      return [head.join("\n"), ...body, ...(env.extra ? [env.extra] : [])].join("\n\n");
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

function safeGet(s: DiagStore): string | null {
  try {
    return s.get();
  } catch {
    return null;
  }
}

/** 接 window 的 error 與 unhandledrejection。回傳拆除函式。 */
export function installErrorCapture(target: EventTarget, log: DiagLog): () => void {
  const onError = (ev: Event): void => {
    const e = ev as Event & { error?: unknown; message?: string };
    log.record("window", e.error ?? e.message ?? "unknown error");
  };
  const onRejection = (ev: Event): void => {
    log.record("promise", (ev as Event & { reason?: unknown }).reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
