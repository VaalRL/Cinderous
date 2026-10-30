// CLI 參數解析與金鑰來源決策（ADR-0098）——**純函式**，與 I/O 分離以便測試。
//
// 安全設計（見 ADR-0098）：
//  - 私鑰**不由 CLI 落地**：只從「檔案 / stdin / 環境變數」讀進記憶體，用完即止。
//    唯一例外是 `keygen --out`（ADR-0404 §4）：明確指定路徑、已存在就拒絕、畫面不印私鑰。
//  - 環境變數是**最不安全**的來源（可能出現在行程清單、shell 歷史）→ 明確標記，執行時警告。
//  - 任何指令都**不會**輸出私鑰。

/** 生產中繼站預設值（可由 --relay 或 CINDER_RELAY 覆寫）。 */
export const DEFAULT_RELAY = "wss://cinder-relay.cinderous1.workers.dev";

/**
 * 本地啟動器的預設 port（ADR-0113）。**固定**——`localStorage`／OPFS 都以 origin 為鍵，
 * 換 port 等於換一個 App，使用者的資料會「憑空消失」。刻意避開常見開發 port（3000/5173/8080）。
 *
 * 放在這裡（而非 `serve.ts`）是為了讓 `args.ts` 維持**純函式、零 I/O**：serve 會拉進
 * `node:http`／`node:fs`，不該被參數解析的測試連帶拖進來。
 */
export const DEFAULT_PORT = 7847;

/** 私鑰來源；`env` 視為最不安全（會發出警告）。 */
export type NsecSource = { kind: "file"; path: string } | { kind: "stdin" } | { kind: "env" };

/**
 * agent 私人頻道的共用選項（ADR-0404）。**沒給就不出現**——舊的 send／listen 形狀不變。
 */
export interface AgentOptions {
  /** 寄件人白名單（npub）：只輸出這些人的訊息，並把他們加成聯絡人。 */
  from?: string[];
  /** 持久狀態目錄：裝置 id 固定、重開不重複處理、FS 狀態存得下來。 */
  stateDir?: string;
  /** 顯示名稱（取代寫死的 "cli"；只送給聯絡人，ADR-0061）。 */
  name?: string;
  /** 前向保密：on＝啟用、off＝明示退場（ADR-0314）。必須搭 stateDir。 */
  fs?: "on" | "off";
}

/** 限時訊息上限：中繼本來就只留 7 天，再長沒有意義（ADR-0404 §5）。 */
export const MAX_TTL_SECONDS = 7 * 24 * 3600;
/** `ask` 預設等多久（秒）。 */
export const DEFAULT_ASK_TIMEOUT = 300;

export type Command =
  | { cmd: "help" }
  /** 印版號（ADR-0405：從 Release 下載的單檔要看得出是哪一版）。 */
  | { cmd: "version" }
  | { cmd: "whoami"; nsec: NsecSource; hex: boolean }
  | ({ cmd: "send"; nsec: NsecSource; relay: string; to: string; text: string; ttl?: number } & AgentOptions)
  | ({ cmd: "listen"; nsec: NsecSource; relay: string } & AgentOptions)
  /** 送出並等回覆（ADR-0404 §3）。`approve`＝附短碼，要回 `yes 1234`／`no 1234` 才算。 */
  | ({
      cmd: "ask";
      nsec: NsecSource;
      relay: string;
      to: string;
      text: string;
      timeout: number;
      approve: boolean;
      ttl?: number;
    } & AgentOptions)
  /** 產生 agent 金鑰寫進檔案（ADR-0404 §4，**唯一**會寫私鑰的指令）；畫面只印 npub。 */
  | { cmd: "keygen"; out: string }
  /**
   * 本地啟動器（ADR-0113）：服務已建置的靜態 App 並開瀏覽器。
   * **不需要私鑰**——私鑰在瀏覽器裡，不經過 CLI。
   */
  | { cmd: "serve"; port: number; dir: string | undefined; open: boolean };

export class ArgError extends Error {}

/** 帶值的旗標（其後一個 token 是值，不可被當成位置參數）。 */
const VALUE_FLAGS = new Set(["nsec-file", "relay", "port", "dir", "from", "state-dir", "name", "fs", "ttl", "timeout", "out"]);

/** 取一個帶值的旗標（`--k v`）；沒有則回 undefined。 */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new ArgError(`--${name} 需要一個值`);
  return v;
}

/** 取一個可重複的帶值旗標（`--k a --k b`）的所有值。 */
function flags(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== `--${name}`) continue;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new ArgError(`--${name} 需要一個值`);
    out.push(v);
  }
  return out;
}

/** 正整數旗標；給了但不合法就報錯（不靜默退回預設）。 */
function positiveInt(argv: string[], name: string): number | undefined {
  const raw = flag(argv, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ArgError(`--${name} 要是正整數（秒）：${raw}`);
  return n;
}

/** agent 頻道的共用選項（ADR-0404）。 */
function agentOptions(argv: string[]): AgentOptions {
  const from = flags(argv, "from");
  const stateDir = flag(argv, "state-dir");
  const name = flag(argv, "name");
  const fs = flag(argv, "fs");
  if (fs !== undefined && fs !== "on" && fs !== "off") throw new ArgError(`--fs 只能是 on 或 off：${fs}`);
  // EK 存不下來 ⇒ 下一次啟動就解不開對方加密到它 EK 的訊息，對方還會一直看到降級警告。
  if (fs !== undefined && stateDir === undefined) throw new ArgError("--fs 必須搭配 --state-dir（前向保密的金鑰要存得下來）");
  return {
    ...(from.length > 0 ? { from } : {}),
    ...(stateDir !== undefined ? { stateDir } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(fs !== undefined ? { fs } : {}),
  };
}

/** `--ttl`：1 秒到 7 天（ADR-0404 §5）。 */
function ttlOf(argv: string[]): { ttl?: number } {
  const ttl = positiveInt(argv, "ttl");
  if (ttl === undefined) return {};
  if (ttl > MAX_TTL_SECONDS) throw new ArgError(`--ttl 最多 7 天（${MAX_TTL_SECONDS} 秒）：中繼本來就只留 7 天`);
  return { ttl };
}

/** `ask --timeout`：最多 7 天——再長 Node 的 setTimeout 會溢位成 1ms，問題還沒送出就判定失敗。 */
function timeoutOf(argv: string[]): number {
  const t = positiveInt(argv, "timeout") ?? DEFAULT_ASK_TIMEOUT;
  if (t > MAX_TTL_SECONDS) throw new ArgError(`--timeout 最多 7 天（${MAX_TTL_SECONDS} 秒）`);
  return t;
}

/**
 * 取出位置參數：必須**跳過帶值旗標的值**，否則 `send <npub> 訊息 --nsec-file /k/nsec` 會把
 * `/k/nsec` 也當成訊息內容的一部分（把私鑰路徑寫進要送出的訊息裡——正是不能發生的事）。
 */
function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      if (VALUE_FLAGS.has(a.slice(2))) i += 1; // 連同其值一起跳過
      continue;
    }
    if (a === "-h" || a === "-v") continue;
    out.push(a);
  }
  return out;
}

/** 決定私鑰來源：--nsec-file > --nsec-stdin > CINDER_NSEC。都沒有就報錯（不會去猜）。 */
export function resolveNsecSource(argv: string[], env: Record<string, string | undefined>): NsecSource {
  const file = flag(argv, "nsec-file");
  if (file) return { kind: "file", path: file };
  if (argv.includes("--nsec-stdin")) return { kind: "stdin" };
  if (env.CINDER_NSEC) return { kind: "env" };
  throw new ArgError(
    "找不到私鑰。請用 --nsec-file <路徑>（建議）或 --nsec-stdin；CINDER_NSEC 環境變數可用但最不安全。",
  );
}

/** 解析命令列；`--help`／無參數 → help。不做任何 I/O。 */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): Command {
  const positional = positionals(argv);
  const sub = positional[0];
  if (argv.includes("--version") || argv.includes("-v")) return { cmd: "version" };
  if (!sub || argv.includes("--help") || argv.includes("-h") || sub === "help") return { cmd: "help" };

  const relay = flag(argv, "relay") ?? env.CINDER_RELAY ?? DEFAULT_RELAY;

  switch (sub) {
    case "whoami":
      // --hex：印 64 字元 hex 公鑰（MAINTAINER_PUBKEY 要的格式，ADR-0039）；預設印 npub。
      return { cmd: "whoami", nsec: resolveNsecSource(argv, env), hex: argv.includes("--hex") };

    case "send": {
      const to = positional[1];
      // 訊息本文＝第 2 個之後的所有位置參數（允許不加引號的多字詞）。
      const text = positional.slice(2).join(" ").trim();
      if (!to) throw new ArgError("send 需要收件人：cinder send <npub> <訊息…>");
      if (!text) throw new ArgError("send 需要訊息內容：cinder send <npub> <訊息…>");
      return { cmd: "send", nsec: resolveNsecSource(argv, env), relay, to, text, ...ttlOf(argv), ...agentOptions(argv) };
    }

    case "listen":
      return { cmd: "listen", nsec: resolveNsecSource(argv, env), relay, ...agentOptions(argv) };

    case "ask": {
      const to = positional[1];
      const text = positional.slice(2).join(" ").trim();
      if (!to) throw new ArgError("ask 需要收件人：cinder ask <npub> <問題…>");
      if (!text) throw new ArgError("ask 需要問題內容：cinder ask <npub> <問題…>");
      return {
        cmd: "ask",
        nsec: resolveNsecSource(argv, env),
        relay,
        to,
        text,
        timeout: timeoutOf(argv),
        approve: argv.includes("--approve"),
        ...ttlOf(argv),
        ...agentOptions(argv),
      };
    }

    case "keygen": {
      // keygen **不解析私鑰來源**：它就是在產生私鑰。
      const out = flag(argv, "out");
      if (!out) throw new ArgError("keygen 需要 --out <路徑>（私鑰只寫進檔案，不印在畫面上）");
      return { cmd: "keygen", out };
    }

    case "serve": {
      // serve **不解析私鑰**：本地啟動器只送靜態資源，私鑰全程在瀏覽器裡。
      const raw = flag(argv, "port");
      const port = raw === undefined ? DEFAULT_PORT : Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ArgError(`--port 不是合法的 port：${raw}`);
      return { cmd: "serve", port, dir: flag(argv, "dir"), open: !argv.includes("--no-open") };
    }

    default:
      throw new ArgError(`未知指令：${sub}（可用：whoami / send / listen / ask / keygen / serve）`);
  }
}

export const HELP = `Cinderous CLI——無頭收發工具（ADR-0098）、agent 私人頻道（ADR-0404）＋本地啟動器（ADR-0113）。
需要 Node.js 22 以上。說明與下載：https://vaalrl.github.io/Cinderous/cli/

用法：
  cinder --version                     顯示版號
  cinder serve [--port N] [--dir P]    本地啟動瀏覽器版（預設 http://127.0.0.1:${DEFAULT_PORT}/）
  cinder whoami [--hex]                顯示自己的 npub（--hex 改印 64 字元 hex 公鑰）
  cinder send <npub> <訊息…>            送出一則加密訊息
  cinder listen                        持續印出收到的訊息（JSON Lines）
  cinder ask <npub> <問題…>             送出並等對方回覆（ADR-0404）
  cinder keygen --out <路徑>            產生一把新私鑰寫進檔案，畫面只印 npub

serve（不需要私鑰——私鑰全程在瀏覽器裡）：
  --port <N>                           **會換掉 origin**：既有訊息/封存在原本的 port 底下才讀得到
  --dir <路徑>                          靜態資源目錄（預設為已建置的桌面 App）
  --no-open                            不自動開瀏覽器

私鑰來源（擇一；除了 keygen，CLI 絕不儲存、絕不輸出私鑰）：
  --nsec-file <路徑>                    從檔案讀（建議；請自行設好權限）
  --nsec-stdin                          從標準輸入讀
  CINDER_NSEC=<nsec…>                   環境變數（最不安全，會警告）

agent 私人頻道（ADR-0404；給 Claude Code 等 agent 用自己的身分跟你聯絡）：
  --from <npub>                         只接受這個人的訊息（可重複）；🔴 listen 不給就是任何人都能下指令
  --state-dir <目錄>                    持久狀態：裝置固定、重開不重複處理（一個目錄同時只給一個程序用）
  --name <名稱>                         對方 App 裡顯示的名稱（預設 cli；有 --state-dir 會記住）
  --ttl <秒>                            限時訊息（send／ask），1 秒到 7 天；到期中繼與對方 App 都刪除
  --fs on|off                           這個身分的前向保密（要搭 --state-dir）；只保護中繼上的密文，
                                        agent 讀到的明文仍會進 LLM
  ask --timeout <秒>                    最多等多久（預設 ${DEFAULT_ASK_TIMEOUT}，最多 7 天）
  ask --approve                         附 4 位數短碼，要回「yes 1234」／「no 1234」才算；
                                        要決定能不能做事一定要加（不加時任何回覆都算，連「不要」也是 0）
                                        結束碼：0＝回覆／核准、2＝拒絕、3＝逾時、1＝沒送到／被拒收

結束碼（全部指令）：64＝用法、金鑰或狀態目錄錯（重試也一樣）、70＝非預期錯誤

keygen：私鑰只寫進 --out 指定的檔案（已存在就拒絕，不覆蓋）；請放在只有自己讀得到的地方，
並在 agent 的設定裡禁止它讀那個檔案。

其他：
  --relay <wss://…>                     中繼站（預設 ${DEFAULT_RELAY}）
  CINDER_RELAY=<wss://…>                同上（環境變數）

注意：沒給 --state-dir 時**無本機儲存**——不留私鑰、不留明文歷史。listen 會收到中繼站仍保存的
近期收件匣（NIP-40，約 7 天），以及連線期間到達的新訊息。檔案/通話（WebRTC）不支援。
給了 --state-dir 時，狀態以私鑰導出的金鑰加密存在該目錄；私鑰檔若在同一台機器上，這層加密擋不住
拿到這台機器的人。
`;
