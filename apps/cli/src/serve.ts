// 本地啟動器（ADR-0113）：把已建置的靜態 App 服務在**固定 port** 的 loopback 上，並開瀏覽器。
//
// ## 為什麼 port 必須固定
//
// **Origin 就是資料的身分。** localStorage 與 OPFS 都以 origin 為鍵——`localhost:7847` 與
// `localhost:3000` 是**兩個不同的 App**。換 port ＝ 使用者的訊息、聯絡人、封存**憑空消失**
// （其實還在，只是在另一個 origin 底下讀不到）。
//
// 所以 port 被占用時**直接失敗，絕不自動換一個**——自動換 port 是最糟的做法：它會「成功啟動」
// 並把使用者帶進一個空白的 App，看起來像資料被刪光了。
//
// ## 這台伺服器不持有任何機密
//
// 它只送出 App 的靜態資源（公開的程式碼）。使用者的資料全在**瀏覽器的儲存**裡，且自 ADR-0112
// 起是加密的。伺服器只綁 `127.0.0.1`，不對外網開放。

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

import { DEFAULT_PORT } from "./args.js";

export { DEFAULT_PORT };

/** 只綁 loopback：不讓區網上的其他機器連進來。 */
export const HOST = "127.0.0.1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export function contentTypeOf(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 把 URL 路徑解析成 `root` 底下的實體檔案；**不在 root 底下就回 null**（路徑穿越防護）。
 *
 * 純函式（只讀檔案系統的存在性），以便測試——`..`、URL 編碼的 `%2e%2e`、絕對路徑、
 * Windows 的 `\` 都必須被擋下來。找不到檔案時回 `null`，由呼叫端決定要不要退回 SPA 的 index。
 */
export function resolveAsset(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return null; // 非法的百分號編碼
  }
  if (decoded.includes("\0")) return null;

  const rootAbs = resolve(root);
  // 去掉開頭的 `/`，讓它一定是相對於 root 的解析（否則 `/etc/passwd` 會變成絕對路徑）。
  const rel = decoded.replace(/^[/\\]+/, "");
  const target = resolve(join(rootAbs, rel));

  // 前綴檢查：必須嚴格在 root 底下（加上分隔符，避免 `/root-evil` 通過 `/root` 的前綴檢查）。
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  return target;
}

export interface ServeOptions {
  /** 靜態資源根目錄（已建置的 App）。 */
  root: string;
  port: number;
  /** 逐請求的日誌（測試可注入）。 */
  onRequest?: (method: string, url: string, status: number) => void;
}

/**
 * 啟動靜態伺服器。**port 被占用時 reject**（見檔頭：絕不自動換 port）。
 */
export function startServer(opts: ServeOptions): Promise<Server> {
  const rootAbs = resolve(opts.root);
  const indexPath = join(rootAbs, "index.html");

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, body: Buffer | string, type: string): void => {
      res.writeHead(status, {
        "content-type": type,
        // 不嗅探型別；不給任何 CORS 標頭（其他 origin 不得讀取本 App 的資源）。
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      res.end(body);
      opts.onRequest?.(req.method ?? "GET", url, status);
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(405, "method not allowed", "text/plain; charset=utf-8");
      return;
    }

    const file = resolveAsset(rootAbs, url);
    if (file) {
      send(200, readFileSync(file), contentTypeOf(file));
      return;
    }
    // SPA 退路：未知路徑交給 index.html（客戶端路由）。index 不存在＝根本沒建置。
    if (existsSync(indexPath)) {
      send(200, readFileSync(indexPath), "text/html; charset=utf-8");
      return;
    }
    send(404, "not found", "text/plain; charset=utf-8");
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port, HOST, () => {
      server.removeListener("error", reject);
      resolvePromise(server);
    });
  });
}

/** 撞埠時給使用者一段有用的話（而不是一句 EADDRINUSE）。 */
export function portBusyMessage(port: number): string {
  return [
    `port ${port} 已被占用，啟動中止。`,
    "",
    "**不會自動換一個 port**：localStorage 與 OPFS 都以 origin 為鍵，",
    `換 port 等於換一個 App——你的訊息與封存會「憑空消失」（其實還在 localhost:${port} 底下）。`,
    "",
    "請先關掉占用該 port 的程式，或以 --port 明確指定（並記得：那是另一個資料空間）。",
  ].join("\n");
}
