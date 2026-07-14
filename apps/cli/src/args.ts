// CLI 參數解析與金鑰來源決策（ADR-0098）——**純函式**，與 I/O 分離以便測試。
//
// 安全設計（見 ADR-0098）：
//  - 私鑰**永不由 CLI 落地**：只從「檔案 / stdin / 環境變數」讀進記憶體，用完即止。
//  - 環境變數是**最不安全**的來源（可能出現在行程清單、shell 歷史）→ 明確標記，執行時警告。
//  - 任何指令都**不會**輸出私鑰。

/** 生產中繼站預設值（可由 --relay 或 CINDER_RELAY 覆寫）。 */
export const DEFAULT_RELAY = "wss://cinder-relay.whoami885.workers.dev";

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

export type Command =
  | { cmd: "help" }
  | { cmd: "whoami"; nsec: NsecSource; hex: boolean }
  | { cmd: "send"; nsec: NsecSource; relay: string; to: string; text: string }
  | { cmd: "listen"; nsec: NsecSource; relay: string }
  /**
   * 本地啟動器（ADR-0113）：服務已建置的靜態 App 並開瀏覽器。
   * **不需要私鑰**——私鑰在瀏覽器裡，不經過 CLI。
   */
  | { cmd: "serve"; port: number; dir: string | undefined; open: boolean };

export class ArgError extends Error {}

/** 帶值的旗標（其後一個 token 是值，不可被當成位置參數）。 */
const VALUE_FLAGS = new Set(["nsec-file", "relay", "port", "dir"]);

/** 取一個帶值的旗標（`--k v`）；沒有則回 undefined。 */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new ArgError(`--${name} 需要一個值`);
  return v;
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
    if (a === "-h") continue;
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
      return { cmd: "send", nsec: resolveNsecSource(argv, env), relay, to, text };
    }

    case "listen":
      return { cmd: "listen", nsec: resolveNsecSource(argv, env), relay };

    case "serve": {
      // serve **不解析私鑰**：本地啟動器只送靜態資源，私鑰全程在瀏覽器裡。
      const raw = flag(argv, "port");
      const port = raw === undefined ? DEFAULT_PORT : Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ArgError(`--port 不是合法的 port：${raw}`);
      return { cmd: "serve", port, dir: flag(argv, "dir"), open: !argv.includes("--no-open") };
    }

    default:
      throw new ArgError(`未知指令：${sub}（可用：whoami / send / listen / serve）`);
  }
}

export const HELP = `Cinder CLI——無狀態的無頭收發工具（ADR-0098）＋本地啟動器（ADR-0113）。

用法：
  cinder serve [--port N] [--dir P]    本地啟動瀏覽器版（預設 http://127.0.0.1:${DEFAULT_PORT}/）
  cinder whoami [--hex]                顯示自己的 npub（--hex 改印 64 字元 hex 公鑰）
  cinder send <npub> <訊息…>            送出一則加密訊息
  cinder listen                        持續印出收到的訊息（JSON Lines）

serve（不需要私鑰——私鑰全程在瀏覽器裡）：
  --port <N>                           **會換掉 origin**：既有訊息/封存在原本的 port 底下才讀得到
  --dir <路徑>                          靜態資源目錄（預設為已建置的桌面 App）
  --no-open                            不自動開瀏覽器

私鑰來源（擇一；CLI 絕不儲存、絕不輸出私鑰）：
  --nsec-file <路徑>                    從檔案讀（建議；請自行設好權限）
  --nsec-stdin                          從標準輸入讀
  CINDER_NSEC=<nsec…>                   環境變數（最不安全，會警告）

其他：
  --relay <wss://…>                     中繼站（預設 ${DEFAULT_RELAY}）
  CINDER_RELAY=<wss://…>                同上（環境變數）

注意：本工具**無本機儲存**——不留私鑰、不留明文歷史。listen 會收到中繼站仍保存的
近期收件匣（NIP-40，約 7 天），以及連線期間到達的新訊息。檔案/通話（WebRTC）不支援。
`;
