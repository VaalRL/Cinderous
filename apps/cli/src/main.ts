// Cinderous CLI（ADR-0098）：無狀態的無頭收發工具。
//
// 刻意的設計取捨：
//  - **無本機儲存**（用 MemoryStorage）：不留私鑰、不留明文歷史。歷史請用桌面版的導出（ADR-0094）。
//  - 私鑰只讀進記憶體，用完隨行程結束；**絕不輸出、絕不寫檔**。
//  - 只做文字（走中繼）。檔案/通話需要 WebRTC，Node 無瀏覽器環境 → 不支援。
//  - listen 會拿到中繼站仍保存的近期收件匣（kind 1059，NIP-40 約 7 天）＋連線期間的新訊息。

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getPublicKey, npubDecode, npubEncode, nsecDecode } from "@cinderous/core";
import { MemoryStorage, RelayChatBackend, webSocketConnector } from "@cinderous/engine";
import type { ChatBackendEvents } from "@cinderous/engine";
import { ArgError, HELP, parseArgs, type Command, type NsecSource } from "./args.js";
import { HOST, portBusyMessage, startServer } from "./serve.js";

/** 讀出私鑰（不回顯、不落地）。env 來源會警告。 */
function loadNsec(src: NsecSource): string {
  switch (src.kind) {
    case "file":
      return readFileSync(src.path, "utf8").trim();
    case "stdin":
      return readFileSync(0, "utf8").trim(); // fd 0
    case "env":
      console.error("⚠ 以 CINDER_NSEC 環境變數提供私鑰：可能出現在行程清單/shell 歷史，建議改用 --nsec-file。");
      return (process.env.CINDER_NSEC ?? "").trim();
  }
}

/** 建立無頭後端（記憶體儲存＝不落地）。 */
function makeBackend(nsec: string, relay: string): RelayChatBackend {
  return new RelayChatBackend(new MemoryStorage(), webSocketConnector(relay), "cli", {
    relayUrl: relay,
    connectorFor: webSocketConnector,
    anchors: [relay],
    nsecOverride: nsec,
  });
}

/** ChatBackendEvents 的必填欄位樣板（CLI 只關心其中幾個）。 */
const noopEvents: ChatBackendEvents = {
  onContacts() {},
  onMessage() {},
  onTyping() {},
  onNudge() {},
};

/** 已建置的桌面 App（瀏覽器版）。從 CLI 自身位置推出，`--dir` 可覆寫。 */
function defaultStaticDir(): string {
  // 打包後在 apps/cli/dist/cinder.js → ../../desktop/dist
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "desktop", "dist");
}

/** 以平台原生方式開瀏覽器。失敗不致命（使用者可自己貼網址）。 */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* 開不起來就算了——網址已經印出來了 */
  }
}

/** 本地啟動器（ADR-0113）：服務靜態 App、開瀏覽器，然後常駐。 */
async function serve(cmd: Extract<Command, { cmd: "serve" }>): Promise<number> {
  const root = cmd.dir ? resolve(cmd.dir) : defaultStaticDir();
  if (!existsSync(join(root, "index.html"))) {
    console.error(`找不到已建置的 App：${root}`);
    console.error("請先建置（在 repo 根目錄執行 `pnpm build`），或以 --dir 指定路徑。");
    return 1;
  }

  try {
    await startServer({ root, port: cmd.port });
  } catch (e) {
    // 撞埠**絕不自動換一個**（ADR-0113）：那會「成功啟動」卻把使用者帶進空白的 App。
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(portBusyMessage(cmd.port));
      return 1;
    }
    throw e;
  }

  const url = `http://${HOST}:${cmd.port}/`;
  console.log(`Cinderous 本地版：${url}`);
  console.log(`  資源目錄：${root}`);
  console.log("");
  // 誠實告知兩個瀏覽器版特有的取捨（ADR-0113）。
  console.log("注意：");
  console.log(`  · 網址（origin）就是資料的身分——換 port 會看不到既有訊息（它們還在 :${cmd.port} 底下）。`);
  console.log("  · 分頁切到背景時瀏覽器會節流計時器：送訊可能延遲（收訊不受影響）。桌面版無此問題。");
  console.log("");
  console.log("Ctrl+C 結束。");
  if (cmd.open) openBrowser(url);

  await new Promise(() => {}); // 常駐
  return 0;
}

async function run(cmd: Command): Promise<number> {
  if (cmd.cmd === "help") {
    console.log(HELP);
    return 0;
  }

  // serve **不需要私鑰**：它只送靜態資源，私鑰全程在瀏覽器裡。必須在 loadNsec 之前分派。
  if (cmd.cmd === "serve") return await serve(cmd);

  const nsec = loadNsec(cmd.nsec);
  if (!nsec.startsWith("nsec1")) throw new ArgError("私鑰格式不正確（應為 nsec1…）");

  if (cmd.cmd === "whoami") {
    // 純本機：不連線、不外送任何東西。私鑰只在記憶體、絕不輸出。
    const pubkey = getPublicKey(nsecDecode(nsec));
    console.log(cmd.hex ? pubkey : npubEncode(pubkey)); // --hex 供 MAINTAINER_PUBKEY 使用
    return 0;
  }

  const backend = makeBackend(nsec, cmd.relay);

  if (cmd.cmd === "send") {
    const to = npubDecode(cmd.to); // 非法 npub 會拋錯
    return await new Promise<number>((resolve) => {
      // 逾時保護：連不上中繼就不要無限卡住。
      const timer = setTimeout(() => {
        console.error("⚠ 逾時：未收到中繼站確認（訊息可能未送出）。");
        backend.stop();
        resolve(1);
      }, 15_000);

      backend.start({
        ...noopEvents,
        // Tier 1（ADR-0058）：中繼接受＝已送出。failed＝重試耗盡/被拒（ADR-0095）。
        onMessageStatus: (_c, _id, status) => {
          if (status === "sent") {
            clearTimeout(timer);
            console.log(JSON.stringify({ ok: true, to: cmd.to, status }));
            backend.stop();
            resolve(0);
          } else if (status === "failed") {
            clearTimeout(timer);
            console.error(JSON.stringify({ ok: false, to: cmd.to, status }));
            backend.stop();
            resolve(1);
          }
        },
      });
      backend.sendMessage(to, cmd.text);
    });
  }

  // listen：以 JSON Lines 印出收到的訊息，方便接管線（jq、腳本、通知…）。
  console.error(`… 連線 ${cmd.relay}（Ctrl+C 結束）`);
  backend.start({
    ...noopEvents,
    onMessage: (contact, m) => {
      if (m.outgoing) return; // 只印收到的
      console.log(
        JSON.stringify({
          from: npubEncode(contact),
          at: m.at,
          text: m.text,
          ...(m.file ? { file: { name: m.file.name, size: m.file.size } } : {}),
        }),
      );
    },
    onConnection: (state) => console.error(`… 中繼狀態：${state}`),
  });
  process.on("SIGINT", () => {
    backend.stop();
    process.exit(0);
  });
  return await new Promise<number>(() => {}); // 常駐
}

try {
  process.exit(await run(parseArgs(process.argv.slice(2), process.env)));
} catch (e) {
  console.error(e instanceof ArgError ? `✖ ${e.message}` : e);
  process.exit(1);
}
