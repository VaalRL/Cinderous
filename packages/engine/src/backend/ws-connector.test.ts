// webSocketConnector：真實網路的連線改由 SDK 的 RelayPool 負責（ADR-0398），這裡測轉接層對引擎的承諾。
//
// - 什麼時候算上線、中繼暫時不能用（1013）時說出原因（ADR-0395）；
// - 重連退避、NIP-42 認證、認證前被拒的重送、補訂閱都交給 SDK——這裡只確認轉接後引擎看到的行為；
// - OK 只轉交「中繼真的回答了」的那些：逾時、沒連上、斷線不回報，交給外送匣的重連補送（ADR-0041）。
import { buildAuthEvent, finalizeEvent, generateSecretKey, type NostrEvent } from "@cinderous/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState, RelayUnavailable } from "./types.js";
import { RelayChatBackend, webSocketConnector } from "./relay-backend.js";
import { MemoryStorage } from "../storage/memory.js";

type Listener = (e: unknown) => void;

class FakeWebSocket {
  static all: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* 由測試觸發 close 事件 */
  }
  emit(type: string, e: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  /** 中繼端的動作 */
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }
  message(frame: unknown[]): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }
  closed(code: number, reason = ""): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
  /** 送出過的某種訊框（已解析） */
  frames(type: string): unknown[][] {
    return this.sent.map((s) => JSON.parse(s) as unknown[]).filter((f) => f[0] === type);
  }
}

const URL = "wss://relay.example";
const latest = () => FakeWebSocket.all[FakeWebSocket.all.length - 1]!;
/** 斷線的原因在同一個 tick 稍後才到（SDK 先改狀態、再回報拒收），轉接層等一個微任務才報離線 */
const tick = () => Promise.resolve();
const sk = generateSecretKey();
const signed = (content: string): NostrEvent =>
  finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content }, sk);

function connect(handlers: Parameters<ReturnType<typeof webSocketConnector>>[0] = {}) {
  const states: [ConnectionState, RelayUnavailable | undefined][] = [];
  const client = webSocketConnector(URL)(
    { authSigner: (challenge) => buildAuthEvent(challenge, URL, sk), ...handlers },
    (state, unavailable) => states.push([state, unavailable]),
  );
  return { states, client };
}

/** 邊緣探測（SDK ADR 0125）用的 fetch：預設像斷網（兩次都失敗），不碰真的網路 */
const offlineFetch = () => Promise.reject(new TypeError("Failed to fetch"));
/** 邊緣代答：一般請求被瀏覽器擋（沒有 CORS 標頭）、不透明請求成功 */
const edgeFetch = vi.fn((_url: string, init?: { mode?: string }) =>
  init?.mode === "no-cors" ? Promise.resolve({ type: "opaque", headers: { get: () => null } }) : offlineFetch(),
);

beforeEach(() => {
  FakeWebSocket.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 29, 3, 0, 0)); // 台灣 11:00
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", vi.fn(offlineFetch));
  edgeFetch.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("🔴 中繼額度用完（1013 over quota，ADR-0395）", () => {
  it("接受升級→NOTICE→1013：不算上線、帶原因與恢復時間、5 分鐘後才重連", async () => {
    const { states } = connect();
    const ws = latest();
    ws.open();
    ws.message(["NOTICE", "over quota: this relay has used up its storage write allowance for today …"]);
    ws.closed(1013, "over quota");
    await tick();

    expect(states.map(([s]) => s)).toEqual(["connecting", "offline"]);
    const info = states[1]![1]!;
    expect(info.kind).toBe("over-quota");
    expect(info.resetsAt).toBe(Date.UTC(2026, 9, 30, 0, 0, 0));
    expect(info.retryAt).toBe(Date.now() + 5 * 60_000);

    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(FakeWebSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.all).toHaveLength(2);
  });

  it("再被關一次還是等 5 分鐘（不會因為接受了升級就把退避歸零）", () => {
    connect();
    for (let i = 0; i < 3; i++) {
      latest().open();
      latest().closed(1013, "over quota");
      vi.advanceTimersByTime(5 * 60_000 - 1);
      expect(FakeWebSocket.all).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
    }
    expect(FakeWebSocket.all).toHaveLength(4);
  });

  it("1013 其他原因（temporarily unavailable）：kind=unavailable、沒有恢復時間", async () => {
    const { states } = connect();
    latest().open();
    latest().closed(1013, "temporarily unavailable");
    await tick();
    const info = states.at(-1)![1]!;
    expect(info.kind).toBe("unavailable");
    expect(info.resetsAt).toBeUndefined();
  });

  it("恢復後正常上線：offline 不再帶原因", async () => {
    const { states } = connect();
    latest().open();
    latest().closed(1013, "over quota");
    await tick();
    vi.advanceTimersByTime(5 * 60_000);
    latest().open();
    latest().message(["AUTH", "challenge"]);
    latest().closed(1006);
    await tick();
    expect(states.slice(-2)).toEqual([
      ["online", undefined],
      ["offline", undefined],
    ]);
  });
});

describe("🔴 主機有回應、回答的卻不是中繼（Cloudflare 1027 這類，ADR-0401；SDK ADR 0125）", () => {
  /** 還沒連上就斷（瀏覽器只看得到 1006），兩次 */
  const failTwice = async () => {
    latest().closed(1006);
    await tick();
    vi.advanceTimersByTime(500);
    latest().closed(1006);
    await vi.advanceTimersByTimeAsync(0); // 探測的兩個請求回來
  };

  it("探測判定邊緣代答：再報一次離線，帶 edge、恢復時間（下一個 00:00 UTC）與 5 分鐘後的重試", async () => {
    vi.stubGlobal("fetch", edgeFetch);
    const { states } = connect();
    await failTwice();
    expect(edgeFetch.mock.calls.map(([url]) => url)).toEqual(["https://relay.example", "https://relay.example"]);
    expect(states.at(-1)).toEqual([
      "offline",
      { kind: "edge", retryAt: Date.now() + 5 * 60_000, resetsAt: Date.UTC(2026, 9, 30, 0, 0, 0) },
    ]);
    // 重連等到那時（不是 1 秒後）
    const n = FakeWebSocket.all.length;
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(FakeWebSocket.all).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.all).toHaveLength(n + 1);
  });

  it("真的斷網（兩次請求都失敗）：照舊只報離線、不帶原因", async () => {
    const { states } = connect();
    await failTwice();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual(["offline", undefined]);
  });

  it("close() 之後探測才回來：不再回報", async () => {
    let answer: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, init?: { mode?: string }) =>
          new Promise((resolve, reject) => {
            answer = () => (edgeFetch(url, init) as Promise<unknown>).then(resolve, reject);
          }),
      ),
    );
    const { states, client } = connect();
    latest().closed(1006);
    await tick();
    vi.advanceTimersByTime(500);
    latest().closed(1006);
    await tick();
    const n = states.length;
    client.close?.();
    answer();
    await vi.advanceTimersByTimeAsync(0);
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toHaveLength(n);
  });
});

describe("什麼時候算上線（ADR-0395）", () => {
  it("中繼先開口（AUTH 挑戰）就立刻上線", () => {
    const { states } = connect();
    latest().open();
    expect(states.map(([s]) => s)).toEqual(["connecting"]);
    latest().message(["AUTH", "challenge"]);
    expect(states.map(([s]) => s)).toEqual(["connecting", "online"]);
  });

  it("不開口的中繼：連上 1 秒沒被關就算上線", () => {
    const { states } = connect();
    latest().open();
    vi.advanceTimersByTime(999);
    expect(states.map(([s]) => s)).toEqual(["connecting"]);
    vi.advanceTimersByTime(1);
    expect(states.map(([s]) => s)).toEqual(["connecting", "online"]);
  });

  it("close() 之後不再重連、也不再回報狀態", async () => {
    const { states, client } = connect();
    latest().open();
    vi.advanceTimersByTime(1000);
    client.close?.();
    await tick();
    const n = states.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.all).toHaveLength(1);
    expect(states).toHaveLength(n);
  });
});

describe("重連退避交給 SDK（DEFAULT_RECONNECT_DELAYS_MS、撐過 30 秒才歸零）", () => {
  it("連不上：0.5 秒、1 秒、2 秒…", () => {
    connect();
    latest().closed(1006);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.all).toHaveLength(2);
    latest().closed(1006);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.all).toHaveLength(3);
  });

  it("上線撐過 30 秒才斷：退避歸零；連上就被關的不歸零", () => {
    connect();
    latest().closed(1006);
    vi.advanceTimersByTime(500);
    latest().open();
    latest().closed(1006); // 連上就被關：照樣往下一段（1 秒）
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.all).toHaveLength(3);
    latest().open();
    vi.advanceTimersByTime(30_000);
    latest().closed(1006);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.all).toHaveLength(4);
  });
});

describe("發布與 OK（外送匣只看中繼真的回答的，ADR-0041）", () => {
  it("還沒連上就發布：先排著，連上才送", () => {
    const { client } = connect();
    const e = signed("早到");
    client.publish(e);
    expect(latest().sent).toEqual([]);
    latest().open();
    expect(latest().frames("EVENT").map((f) => (f[1] as NostrEvent).id)).toEqual([e.id]);
  });

  it("OK true／duplicate＝收下；OK false 帶中繼的原文", async () => {
    const onOk = vi.fn();
    const { client } = connect({ onOk });
    latest().open();
    const [a, b, c] = [signed("a"), signed("b"), signed("c")];
    for (const e of [a, b, c]) client.publish(e);
    latest().message(["OK", a.id, true, ""]);
    latest().message(["OK", b.id, false, "duplicate: have it"]);
    latest().message(["OK", c.id, false, "blocked: quota: full"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onOk.mock.calls).toEqual([
      [a.id, true, ""],
      [b.id, true, ""],
      [c.id, false, "blocked: quota: full"],
    ]);
  });

  it("等 OK 等到 30 秒內都算數（外送匣的在途時間）；斷線或逾時不回報", async () => {
    const onOk = vi.fn();
    const { client } = connect({ onOk });
    latest().open();
    const [slow, lost] = [signed("slow"), signed("lost")];
    client.publish(slow);
    vi.advanceTimersByTime(20_000);
    latest().message(["OK", slow.id, true, ""]);
    client.publish(lost);
    latest().closed(1006);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(onOk.mock.calls).toEqual([[slow.id, true, ""]]);
  });

  it("🔴 認證前送出被回 auth-required：認證完成後自動重送，不往上報拒收（原 ADR-0385）", async () => {
    const onOk = vi.fn();
    const { client } = connect({ onOk });
    const ws = latest();
    ws.open();
    const e = signed("beat");
    client.publish(e);
    ws.message(["AUTH", "c1"]);
    ws.message(["OK", e.id, false, "auth-required: please auth"]);
    const auth = ws.frames("AUTH")[0]![1] as NostrEvent;
    expect(auth.tags).toContainEqual(["challenge", "c1"]);
    ws.message(["OK", auth.id, true, ""]);
    expect(ws.frames("EVENT").filter((f) => (f[1] as NostrEvent).id === e.id)).toHaveLength(2);
    ws.message(["OK", e.id, true, ""]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onOk.mock.calls).toEqual([[e.id, true, ""]]);
  });
});

describe("訂閱（subId 對應一個 SDK 訂閱，補訂閱交給 SDK）", () => {
  const filters = [{ kinds: [1], authors: ["ab".repeat(32)] }];

  it("事件帶回引擎的 subId；SDK 先驗簽，假簽章的丟掉", () => {
    const got: [string, string][] = [];
    const { client } = connect({ onEvent: (sub, e) => got.push([sub, e.content]) });
    latest().open();
    client.subscribe("all", filters as never);
    const [req] = latest().frames("REQ");
    const good = signed("good");
    latest().message(["EVENT", req![1], good]);
    latest().message(["EVENT", req![1], { ...signed("bad"), content: "tampered" }]);
    expect(got).toEqual([["all", "good"]]);
  });

  it("同一個 subId、同樣的 filter 再訂一次：不送新的 REQ（引擎每次上線都會重訂）", () => {
    const { client } = connect();
    latest().open();
    client.subscribe("all", filters as never);
    client.subscribe("all", filters as never);
    expect(latest().frames("REQ")).toHaveLength(1);
    expect(latest().frames("CLOSE")).toHaveLength(0);
  });

  it("filter 變了：關掉舊的、送新的；空的 filter＝只關掉", () => {
    const { client } = connect();
    latest().open();
    client.subscribe("all", filters as never);
    client.subscribe("all", [{ kinds: [2] }] as never);
    expect(latest().frames("REQ")).toHaveLength(2);
    expect(latest().frames("CLOSE")).toHaveLength(1);
    client.subscribe("all", []);
    expect(latest().frames("REQ")).toHaveLength(2);
    expect(latest().frames("CLOSE")).toHaveLength(2);
  });

  it("重連：SDK 自己補送訂閱；引擎上線後重訂同樣的 filter 不會多送一次", () => {
    const { client } = connect();
    latest().open();
    client.subscribe("all", filters as never);
    latest().closed(1006);
    vi.advanceTimersByTime(500);
    latest().open();
    vi.advanceTimersByTime(1000); // 上線 → 引擎會重訂
    client.subscribe("all", filters as never);
    expect(latest().frames("REQ")).toHaveLength(1);
  });

  it("unsubscribe：送 CLOSE，重連後不再補送", () => {
    const { client } = connect();
    latest().open();
    client.subscribe("x", filters as never);
    client.unsubscribe("x");
    expect(latest().frames("CLOSE")).toHaveLength(1);
    latest().closed(1006);
    vi.advanceTimersByTime(500);
    latest().open();
    expect(latest().frames("REQ")).toHaveLength(0);
  });
});

describe("引擎把原因交給 UI（ADR-0395）", () => {
  it("home 中繼額度用完：onConnection 帶 over-quota；之後一直是離線，不會閃回上線", async () => {
    const seen: [ConnectionState, RelayUnavailable | undefined][] = [];
    const backend = new RelayChatBackend(new MemoryStorage(), webSocketConnector(URL), "Alice", { relayUrl: URL });
    backend.start({ onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {}, onConnection: (s, u) => seen.push([s, u]) });
    const home = FakeWebSocket.all.find((w) => w.url === URL)!;
    home.open();
    home.message(["NOTICE", "over quota: …"]);
    home.closed(1013, "over quota");
    await tick();
    expect(seen.at(-1)?.[0]).toBe("offline");
    expect(seen.at(-1)?.[1]?.kind).toBe("over-quota");
    expect(seen.map(([s]) => s)).not.toContain("online");
    backend.stop();
  });
});
