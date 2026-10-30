// CLI 的後端設定要跟 App 走同一套路由（ADR-0404 修正，2026-10-30 實機對接時發現）。
//
// App 預設開分片（ADR-0241）：收件匣在錨點的「訊息片」上，不在基底網址。CLI 原本只連基底網址、
// 也不知道另一座錨點——CLI 對 CLI 測得過，CLI 對 App 寄出顯示 sent，App 卻永遠收不到。
// 這裡每個網址一顆獨立的 RelayCore（＝一顆 DO），跟錨點的實際拓樸一樣。
import { generateSecretKey, getPublicKey, nsecEncode, shardPrefix, type RelayClientHandlers } from "@cinderous/core";
import { MemoryStorage, RelayChatBackend, type ChatMessage, type RelayConnector } from "@cinderous/engine";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgentSetup, noopEvents } from "./agent.js";
import { createCliBackend } from "./backend.js";

const ONE = "wss://anchor-one";
const TWO = "wss://anchor-two";
const ANCHORS = [ONE, TWO];

const settle = async (): Promise<void> => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};

function farm() {
  const nets = new Map<string, ReturnType<typeof createInMemoryRelayNetwork>>();
  let seq = 0;
  const netFor = (url: string) => {
    let n = nets.get(url);
    if (!n) {
      n = createInMemoryRelayNetwork({ store: new MessageStore(), requireAuth: true });
      nets.set(url, n);
    }
    return n;
  };
  const connectorFor =
    (url: string): RelayConnector =>
    (h: RelayClientHandlers, onStatus) => {
      const c = netFor(url).connect(`c${seq++}`, h);
      onStatus?.("online");
      return c;
    };
  return { connectorFor, urls: () => [...nets.keys()] };
}

/** 兩把落在不同分片的私鑰（同片時基底與分片的差別測不出來）。 */
function crossShardKeys(): { app: Uint8Array; cli: Uint8Array } {
  const app = generateSecretKey();
  let cli = generateSecretKey();
  while (shardPrefix(getPublicKey(app)) === shardPrefix(getPublicKey(cli))) cli = generateSecretKey();
  return { app, cli };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
});

/** 「你」的 App：照桌面版 buildBackend 的個人身分設定（分片開、兩座錨點都列）。 */
function app(sk: Uint8Array, home: string, connectorFor: (url: string) => RelayConnector) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "我" });
  const b = new RelayChatBackend(store, connectorFor(home), "我", {
    relayUrl: home,
    connectorFor,
    shardingBase: home,
    anchors: ANCHORS,
  });
  const inbox: ChatMessage[] = [];
  b.start({ ...noopEvents, onMessage: (_c, m) => !m.outgoing && inbox.push(m) });
  cleanups.push(() => b.stop());
  return { b, inbox };
}

function cli(sk: Uint8Array, relay: string, connectorFor: (url: string) => RelayConnector) {
  const b = createCliBackend(new MemoryStorage(), nsecEncode(sk), relay, "agent", { connectorFor, anchors: ANCHORS });
  const inbox: ChatMessage[] = [];
  b.start({ ...noopEvents, onMessage: (_c, m) => !m.outgoing && inbox.push(m) });
  cleanups.push(() => b.stop());
  return { b, inbox };
}

describe("CLI ↔ App 路由（分片＋錨點）", () => {
  for (const [label, cliRelay] of [
    ["同一座錨點", TWO],
    ["不同錨點（CLI 預設錨點 1、App 在錨點 2）", ONE],
  ] as const) {
    it(`${label}：CLI 寄的 App 收得到，App 回的 CLI 也收得到`, async () => {
      const keys = crossShardKeys();
      const net = farm();
      const me = app(keys.app, TWO, net.connectorFor);
      const agent = cli(keys.cli, cliRelay, net.connectorFor);
      applyAgentSetup(agent.b, { from: [me.b.selfNpub] });
      me.b.addContact(agent.b.selfNpub);
      await settle();

      agent.b.sendMessage(me.b.self.pubkey, "建置完成");
      await settle();
      expect(me.inbox.map((m) => m.text)).toEqual(["建置完成"]);

      me.b.sendMessage(agent.b.self.pubkey, "好，部署");
      await settle();
      expect(agent.inbox.map((m) => m.text)).toEqual(["好，部署"]);
    });
  }
});
