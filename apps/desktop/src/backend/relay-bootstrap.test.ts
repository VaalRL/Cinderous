import {
  generateSecretKey,
  getPublicKey,
  signRelayList,
  type NostrEvent,
  type RelayClient,
  type RelayClientHandlers,
} from "@nostr-buddy/core";
import { createInMemoryRelayNetwork } from "@nostr-buddy/relay";
import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import { RELAY_STALE_MS, RelayChatBackend } from "./relay-backend.js";
import type { RelayConnector } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/**
 * 多座 relay farm：每座一個 in-memory 網路，可個別「下架」（publish 被丟棄 +
 * 對已連上的 backend 觸發 offline 狀態）。模擬 Node1 下架、錨點/node2 存活。
 */
function relayFarm(urls: string[]) {
  const nets: Record<string, ReturnType<typeof createInMemoryRelayNetwork>> = {};
  const statusCbs: Record<string, ((s: "connecting" | "online" | "offline") => void)[]> = {};
  const down = new Set<string>();
  for (const u of urls) {
    nets[u] = createInMemoryRelayNetwork();
    statusCbs[u] = [];
  }
  let n = 0;
  const connector = (url: string): RelayConnector => (h: RelayClientHandlers, onStatus) => {
    if (onStatus) {
      statusCbs[url]!.push(onStatus);
      onStatus(down.has(url) ? "offline" : "online");
    }
    const real = nets[url]!.connect(`c${n++}`, h);
    const wrapped = {
      publish: (e: Parameters<RelayClient["publish"]>[0]) => {
        if (!down.has(url)) real.publish(e);
      },
      subscribe: (...a: Parameters<RelayClient["subscribe"]>) => real.subscribe(...a),
      unsubscribe: (...a: Parameters<RelayClient["unsubscribe"]>) => real.unsubscribe(...a),
      receive: (...a: Parameters<RelayClient["receive"]>) => real.receive(...a),
      close: () => {},
    };
    return wrapped as unknown as RelayClient;
  };
  const spy = (url: string, filter: object): NostrEvent[] => {
    const got: NostrEvent[] = [];
    const c = nets[url]!.connect(`spy${n++}`, { onEvent: (_s, e) => got.push(e) });
    c.subscribe("spy", [filter as never]);
    return got;
  };
  const setDown = (url: string) => {
    down.add(url);
    for (const cb of statusCbs[url]!) cb("offline");
  };
  const publishRaw = (url: string, event: NostrEvent) => nets[url]!.connect(`pub${n++}`, {}).publish(event);
  return { connector, spy, setDown, publishRaw };
}

describe("混合式引導路由：Node1 下架後自動遷移（ADR-0039）", () => {
  it("錨點冗餘廣播：home(Node1) 下架後 A→B 訊息仍經錨點送達", () => {
    const farm = relayFarm(["wss://node1", "wss://anchor"]);
    const mk = (name: string, store: MemoryStorage, onMessage?: (m: ChatMessage) => void) =>
      new RelayChatBackend(store, farm.connector("wss://node1"), name, {
        relayUrl: "wss://node1",
        connectorFor: farm.connector,
        anchors: ["wss://anchor"],
      });
    const aMsgs: ChatMessage[] = [];
    const bMsgs: ChatMessage[] = [];
    const a = mk("A", new MemoryStorage());
    const b = mk("B", new MemoryStorage());
    a.start({ ...noop, onMessage: (_pk, m) => aMsgs.push(m) });
    b.start({ ...noop, onMessage: (_pk, m) => bMsgs.push(m) });
    a.addContact(b.selfNpub); // 無 hint（原本同在 Node1）
    b.addContact(a.selfNpub);

    // 基線：Node1 在線時直達
    a.sendMessage(b.self.pubkey, "hi-before");
    expect(bMsgs.map((m) => m.text)).toContain("hi-before");

    // Node1 下架
    farm.setDown("wss://node1");
    const dmOnAnchor = farm.spy("wss://anchor", { kinds: [KIND_DM], "#p": [b.self.pubkey] });
    a.sendMessage(b.self.pubkey, "hi-after");

    // 經錨點冗餘廣播送達 B（B 收件箱掛在錨點引導座上）
    expect(bMsgs.map((m) => m.text)).toContain("hi-after");
    expect(dmOnAnchor.length).toBeGreaterThanOrEqual(1);
    a.stop();
    b.stop();
  });

  it("home 自動遞補：Node1 長期離線後 effective home 切為錨點、selfShareUri 更新", () => {
    vi.useFakeTimers();
    try {
      const farm = relayFarm(["wss://node1", "wss://anchor"]);
      const switched: string[] = [];
      const a = new RelayChatBackend(new MemoryStorage(), farm.connector("wss://node1"), "A", {
        relayUrl: "wss://node1",
        connectorFor: farm.connector,
        anchors: ["wss://anchor"],
        onHomeSwitched: (u) => switched.push(u),
      });
      a.start(noop);
      expect(a.selfShareUri.endsWith("@wss://node1")).toBe(true);

      farm.setDown("wss://node1");
      vi.advanceTimersByTime(RELAY_STALE_MS + 2000); // 觸發 render tick 的 maybeSucceedHome

      expect(switched).toEqual(["wss://anchor"]);
      expect(a.selfShareUri.endsWith("@wss://anchor")).toBe(true);
      a.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("帶內清單學習：維護者簽章清單經錨點傳入 → node2 成為引導座並收件", () => {
    const maintSk = generateSecretKey();
    const maintPk = getPublicKey(maintSk);
    const farm = relayFarm(["wss://node1", "wss://anchor", "wss://node2"]);
    const store = new MemoryStorage();
    const b = new RelayChatBackend(new MemoryStorage(), farm.connector("wss://node2"), "B", {
      relayUrl: "wss://node2",
      connectorFor: farm.connector,
    });
    const bMsgs: ChatMessage[] = [];
    const a = new RelayChatBackend(store, farm.connector("wss://node1"), "A", {
      relayUrl: "wss://node1",
      connectorFor: farm.connector,
      anchors: ["wss://anchor"],
      maintainerPubkey: maintPk,
    });
    a.start(noop);
    b.start({ ...noop, onMessage: (_pk, m) => bMsgs.push(m) });

    // 維護者在錨點發佈簽章清單（含 node2）→ A 已訂閱錨點的清單事件
    const list = signRelayList({ relays: ["wss://node2"], updatedAt: 1000 }, maintSk);
    farm.publishRaw("wss://anchor", list);

    // A 採用清單並持久化；node2 成為引導座
    expect(store.loadBootstrapList()?.relays).toContain("wss://node2");

    // A 對 B（home=node2，A 無 hint→home node1）送訊：node1 在線會直達 node1，
    // 但 B 的收件箱也掛在 node2；為驗證 node2 座生效，令 node1 下架後再送。
    a.addContact(b.selfNpub);
    farm.setDown("wss://node1");
    a.sendMessage(b.self.pubkey, "via-node2");
    expect(bMsgs.map((m) => m.text)).toContain("via-node2");
    a.stop();
    b.stop();
  });

  it("偽造清單（非維護者簽章）不被採用", () => {
    const maintSk = generateSecretKey();
    const maintPk = getPublicKey(maintSk);
    const evilSk = generateSecretKey();
    const farm = relayFarm(["wss://node1", "wss://anchor"]);
    const store = new MemoryStorage();
    const a = new RelayChatBackend(store, farm.connector("wss://node1"), "A", {
      relayUrl: "wss://node1",
      connectorFor: farm.connector,
      anchors: ["wss://anchor"],
      maintainerPubkey: maintPk,
    });
    a.start(noop);
    const forged = signRelayList({ relays: ["wss://evil"], updatedAt: 9999 }, evilSk);
    farm.publishRaw("wss://anchor", forged);
    expect(store.loadBootstrapList()).toBeNull();
    a.stop();
  });
});

const KIND_DM = 1059;
