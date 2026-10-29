// webSocketConnector 對「中繼暫時不能用」的處理（ADR-0395）。
//
// 中繼的額度用完時（SDK ADR 0097／ADR-0387），它會先**接受**升級、送一則 NOTICE、再以 1013 關閉。
// 舊版把 `open` 當成上線：退避歸零（每秒重連一次）、畫面在上線/斷線之間閃、原因被丟掉。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState, RelayUnavailable } from "./types.js";
import { RelayChatBackend, webSocketConnector } from "./relay-backend.js";
import { MemoryStorage } from "../storage/memory.js";

type Listener = (e: unknown) => void;

class FakeWebSocket {
  static all: FakeWebSocket[] = [];
  readonly sent: string[] = [];
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
    this.emit("open");
  }
  message(frame: unknown[]): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }
  closed(code: number, reason = ""): void {
    this.emit("close", { code, reason });
  }
}

const URL = "wss://relay.example";
const latest = () => FakeWebSocket.all[FakeWebSocket.all.length - 1]!;

function connect() {
  const states: [ConnectionState, RelayUnavailable | undefined][] = [];
  webSocketConnector(URL)({}, (state, unavailable) => states.push([state, unavailable]));
  return states;
}

beforeEach(() => {
  FakeWebSocket.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 29, 3, 0, 0)); // 台灣 11:00
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("🔴 中繼額度用完（1013 over quota）", () => {
  it("接受升級→NOTICE→1013：不算上線、帶原因與恢復時間、5 分鐘後才重連", () => {
    const states = connect();
    const ws = latest();
    ws.open();
    ws.message(["NOTICE", "over quota: this relay has used up its storage write allowance for today …"]);
    ws.closed(1013, "over quota");

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

  it("1013 其他原因（temporarily unavailable）：kind=unavailable、沒有恢復時間", () => {
    const states = connect();
    latest().open();
    latest().closed(1013, "temporarily unavailable");
    const info = states.at(-1)![1]!;
    expect(info.kind).toBe("unavailable");
    expect(info.resetsAt).toBeUndefined();
  });

  it("恢復後正常上線：offline 不再帶原因", () => {
    const states = connect();
    latest().open();
    latest().closed(1013, "over quota");
    vi.advanceTimersByTime(5 * 60_000);
    latest().open();
    latest().message(["AUTH", "challenge"]);
    latest().closed(1006);
    expect(states.slice(-2)).toEqual([
      ["online", undefined],
      ["offline", undefined],
    ]);
  });
});

describe("什麼時候算上線（ADR-0395）", () => {
  it("中繼先開口（AUTH）就立刻上線", () => {
    const states = connect();
    latest().open();
    expect(states.map(([s]) => s)).toEqual(["connecting"]);
    latest().message(["AUTH", "challenge"]);
    expect(states.map(([s]) => s)).toEqual(["connecting", "online"]);
  });

  it("不開口的中繼：連上 1 秒沒被關就算上線", () => {
    const states = connect();
    latest().open();
    vi.advanceTimersByTime(999);
    expect(states.map(([s]) => s)).toEqual(["connecting"]);
    vi.advanceTimersByTime(1);
    expect(states.map(([s]) => s)).toEqual(["connecting", "online"]);
  });

  it("上線過的連線一般斷線：退避歸零、1 秒後重連", () => {
    connect();
    latest().closed(1006); // 連不上兩次：退避到 2 秒、4 秒
    vi.advanceTimersByTime(1000);
    latest().closed(1006);
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.all).toHaveLength(3);
    latest().open();
    latest().message(["AUTH", "c"]);
    latest().closed(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.all).toHaveLength(4);
  });

  it("還沒上線就被一般關閉：退避照樣加倍（1 秒、2 秒…）", () => {
    connect();
    latest().open();
    latest().closed(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.all).toHaveLength(2);
    latest().open();
    latest().closed(1006);
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.all).toHaveLength(3);
  });
});

describe("引擎把原因交給 UI（ADR-0395）", () => {
  it("home 中繼額度用完：onConnection 帶 over-quota；之後一直是離線，不會閃回上線", () => {
    const seen: [ConnectionState, RelayUnavailable | undefined][] = [];
    const backend = new RelayChatBackend(new MemoryStorage(), webSocketConnector(URL), "Alice", { relayUrl: URL });
    backend.start({ onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {}, onConnection: (s, u) => seen.push([s, u]) });
    const home = FakeWebSocket.all.find((w) => w.url === URL)!;
    home.open();
    home.message(["NOTICE", "over quota: …"]);
    home.closed(1013, "over quota");
    expect(seen.at(-1)?.[0]).toBe("offline");
    expect(seen.at(-1)?.[1]?.kind).toBe("over-quota");
    expect(seen.map(([s]) => s)).not.toContain("online");
    backend.stop();
  });
});
