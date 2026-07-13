// Cinder CLI（ADR-0098）：無狀態的無頭收發工具。
//
// 刻意的設計取捨：
//  - **無本機儲存**（用 MemoryStorage）：不留私鑰、不留明文歷史。歷史請用桌面版的導出（ADR-0094）。
//  - 私鑰只讀進記憶體，用完隨行程結束；**絕不輸出、絕不寫檔**。
//  - 只做文字（走中繼）。檔案/通話需要 WebRTC，Node 無瀏覽器環境 → 不支援。
//  - listen 會拿到中繼站仍保存的近期收件匣（kind 1059，NIP-40 約 7 天）＋連線期間的新訊息。

import { readFileSync } from "node:fs";
import { getPublicKey, npubDecode, npubEncode, nsecDecode } from "@cinder/core";
import { MemoryStorage, RelayChatBackend, webSocketConnector } from "@cinder/engine";
import type { ChatBackendEvents } from "@cinder/engine";
import { ArgError, HELP, parseArgs, type Command, type NsecSource } from "./args.js";

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

async function run(cmd: Command): Promise<number> {
  if (cmd.cmd === "help") {
    console.log(HELP);
    return 0;
  }

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
