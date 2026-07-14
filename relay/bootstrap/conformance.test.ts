// 一致性探測 vs. 真實的 requireAuth 中繼（ADR-0123）。
//
// ## 為什麼要開一個真的 WebSocket server
//
// 這個 bug 只在「探測」與「中繼」**真的講話**時才會顯現：探測不做 NIP-42 AUTH，而中繼是
// `requireAuth: true` → REQ 只會拿到 `["CLOSED", …]`，**永遠不會有 EOSE** → 探測逾時 →
// `live: false`。也就是說**每一次 cron，我們自己的中繼站都被自己的健檢判定為「不存活」**，
// 而那個結果會餵進滾動 uptime。
//
// 用假物件測不到這個——所以這裡起一個真的 `ws` server，接上真的 `RelayCore`。

import { WebSocket as NodeWs, WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MessageStore } from "../src/message-store.js";
import { RelayCore } from "../src/relay-core.js";
import { probeEphemeralNotStored, probeLive, probeRejectsExpired } from "./conformance.js";

/** 起一座真的中繼；回傳 ws:// 網址。 */
function startRelay(requireAuth: boolean): { url: string; close: () => Promise<void> } {
  const core = new RelayCore({ store: new MessageStore(), requireAuth });
  const wss = new WebSocketServer({ port: 0 });
  let n = 0;
  const conns = new Map<string, NodeWs>();
  const route = (out: ReturnType<RelayCore["handle"]>): void => {
    for (const { to, message } of out) conns.get(to)?.send(JSON.stringify(message));
  };
  wss.on("connection", (ws) => {
    const id = `c${n++}`;
    conns.set(id, ws);
    route(core.connect(id));
    ws.on("message", (data) => route(core.handle(id, String(data))));
    ws.on("close", () => {
      core.disconnect(id);
      conns.delete(id);
    });
  });
  const port = (wss.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((r) => {
        for (const ws of conns.values()) ws.terminate();
        wss.close(() => r());
      }),
  };
}

// `conformance.ts` 用全域 WebSocket（Workers/瀏覽器環境有；node 測試環境要補上）。
beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket ??= NodeWs;
});

describe("一致性探測（ADR-0092）對上 requireAuth 的中繼（ADR-0123）", () => {
  let relay: { url: string; close: () => Promise<void> };
  beforeAll(() => {
    relay = startRelay(true);
  });
  afterAll(() => relay.close());

  it("🔴 **存活探測要通得過**——修正前它必然逾時，把我們自己的中繼判成「不存活」", async () => {
    // 修正前：`["REQ","live",{kinds:[1],limit:0}]`，沒有 AUTH → 中繼回 `["CLOSED", …]` ＋
    // `["AUTH", 挑戰]`，永遠不會有 EOSE → withWs 逾時 → false。
    await expect(probeLive(relay.url)).resolves.toBe(true);
  }, 20_000);

  it("Ephemeral 不留存：探測會 AUTH、送事件、再具名查詢", async () => {
    await expect(probeEphemeralNotStored(relay.url)).resolves.toBe(true);
  }, 20_000);

  it("NIP-40 過期事件不回傳", async () => {
    await expect(probeRejectsExpired(relay.url)).resolves.toBe(true);
  }, 20_000);
});

describe("同一套探測也要能對付**不要求認證**的中繼（第三方節點）", () => {
  let relay: { url: string; close: () => Promise<void> };
  beforeAll(() => {
    relay = startRelay(false);
  });
  afterAll(() => relay.close());

  it("不發 AUTH 挑戰的中繼：探測照樣走得通（不能只認得自家中繼）", async () => {
    await expect(probeLive(relay.url)).resolves.toBe(true);
  }, 20_000);
});
