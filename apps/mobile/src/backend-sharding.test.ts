// 行動端也走分片（ADR-0407）。
//
// 2026-10-30 實機：桌面（ADR-0241 預設開分片）寄給手機的訊息**全部遺失**，手機上桌面永遠顯示離線；
// 手機寄給桌面卻收得到。原因：桌面把訊息寄到 `shard(手機)`，手機沒開分片，只聽錨點的主網址。
// 這裡每個網址一顆獨立的 RelayCore（＝一顆 DO），跟錨點的實際拓樸一樣。
import {
  generateSecretKey,
  getPublicKey,
  npubEncode,
  nsecEncode,
  shardPrefix,
  type RelayClientHandlers,
} from "@cinderous/core";
import {
  ANCHOR_RELAYS,
  MemoryStorage,
  RelayChatBackend,
  type ChatBackend,
  type ChatBackendEvents,
  type ChatMessage,
  type RelayConnector,
} from "@cinderous/engine";
import { createInMemoryRelayNetwork, MessageStore } from "@cinderous/relay";
import { afterEach, describe, expect, it } from "vitest";
import type { MobileIdentity } from "./auth.js";
import { createRelayChat } from "./backend.js";

// node 測試環境無 localStorage（kill-switch 讀它）：裝一個 Map-backed shim，同 native/foreground.test.ts。
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

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
  return { connectorFor };
}

/** 兩把落在不同分片的私鑰（同片時主網址與分片的差別測不出來）。 */
function crossShardKeys(): { desk: Uint8Array; phone: Uint8Array } {
  const desk = generateSecretKey();
  let phone = generateSecretKey();
  while (shardPrefix(getPublicKey(desk)) === shardPrefix(getPublicKey(phone))) phone = generateSecretKey();
  return { desk, phone };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanups.splice(0).reverse()) f();
  localStorage.removeItem("nb.sharding");
});

const events = (inbox: ChatMessage[]): ChatBackendEvents => ({
  onContacts() {},
  onMessage: (_c, m) => {
    if (!m.outgoing) inbox.push(m);
  },
  onTyping() {},
  onNudge() {},
});

/** 桌面：照 apps/desktop buildBackend 的個人身分設定（分片開、兩座錨點都列）。 */
function desktop(sk: Uint8Array, home: string, connectorFor: (url: string) => RelayConnector) {
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "桌面" });
  const b = new RelayChatBackend(store, connectorFor(home), "桌面", {
    relayUrl: home,
    connectorFor,
    shardingBase: home,
    anchors: ANCHOR_RELAYS,
  });
  const inbox: ChatMessage[] = [];
  b.start(events(inbox));
  cleanups.push(() => b.stop());
  return { b, inbox };
}

function phone(sk: Uint8Array, home: string, connectorFor: (url: string) => RelayConnector) {
  const pubkey = getPublicKey(sk);
  const id: MobileIdentity = { sk, pubkey, npub: npubEncode(pubkey), nsec: nsecEncode(sk), name: "手機" };
  const b = createRelayChat(id, home, { store: new MemoryStorage(), connectorFor }) as ChatBackend & RelayChatBackend;
  const inbox: ChatMessage[] = [];
  b.start(events(inbox));
  cleanups.push(() => b.stop());
  return { b, inbox };
}

describe("桌面 ↔ 手機（分片＋錨點，ADR-0407）", () => {
  for (const [label, deskHome, phoneHome] of [
    ["同一座錨點", ANCHOR_RELAYS[0]!, ANCHOR_RELAYS[0]!],
    ["不同錨點（桌面錨點 2、手機錨點 1，2026-10-30 實機的配置）", ANCHOR_RELAYS[1]!, ANCHOR_RELAYS[0]!],
  ] as const) {
    it(`🔴 ${label}：桌面寄的手機收得到，手機寄的桌面也收得到`, async () => {
      const keys = crossShardKeys();
      const net = farm();
      const d = desktop(keys.desk, deskHome, net.connectorFor);
      const p = phone(keys.phone, phoneHome, net.connectorFor);
      d.b.addContact(p.b.selfNpub);
      p.b.addContact(d.b.selfNpub);
      await settle();

      d.b.sendMessage(p.b.self.pubkey, "桌面寄給手機");
      await settle();
      expect(p.inbox.map((m) => m.text)).toEqual(["桌面寄給手機"]);

      p.b.sendMessage(d.b.self.pubkey, "手機寄給桌面");
      await settle();
      expect(d.inbox.map((m) => m.text)).toEqual(["手機寄給桌面"]);
    });
  }

  it("kill-switch：localStorage nb.sharding=0 → 手機退回不分片（與桌面同一個開關）", async () => {
    localStorage.setItem("nb.sharding", "0");
    const keys = crossShardKeys();
    const net = farm();
    const home = ANCHOR_RELAYS[0]!;
    // 兩邊都關分片 → 都走主網址，照樣互通
    const store = new MemoryStorage();
    store.saveIdentity({ nsec: nsecEncode(keys.desk), name: "舊式" });
    const legacy = new RelayChatBackend(store, net.connectorFor(home), "舊式", {
      relayUrl: home,
      connectorFor: net.connectorFor,
      anchors: ANCHOR_RELAYS,
    });
    const legacyInbox: ChatMessage[] = [];
    legacy.start(events(legacyInbox));
    cleanups.push(() => legacy.stop());
    const p = phone(keys.phone, home, net.connectorFor);
    legacy.addContact(p.b.selfNpub);
    p.b.addContact(legacy.selfNpub);
    await settle();
    legacy.sendMessage(p.b.self.pubkey, "不分片寄的");
    await settle();
    expect(p.inbox.map((m) => m.text)).toEqual(["不分片寄的"]);
  });
});
