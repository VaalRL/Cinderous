// 宿主層測試（ADR-0235 H1 後續）：以假的 Durable Object 執行環境跑**真正的** `RelayRoom`。
//
// ## 為什麼要測這一層
//
// H1 的 bug 不是「防護寫錯」，是「防護寫對了但從沒被接上」——`relay-core` 有 126 個測試全綠，
// 而 `worker.ts` 從未把參數傳進去。組裝層（宿主）沒人測，正是那個縫隙。
//
// 這裡不引入 miniflare／@cloudflare/vitest-pool-workers（重相依、且會拖累 CI），改用一個
// 最小的假 DO——它提供 `RelayRoom` 真正用到的那幾個 API（休眠式 WebSocket、DO SQLite、alarm），
// 於是我們測的是**真實的組裝與收發路徑**，包含最棘手的休眠→喚醒還原。

import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { buildAuthEvent, finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent, type SecretKey } from "@cinderous/core";
import { beforeAll, describe, expect, it } from "vitest";
import worker, { mintTurnResponse, RelayRoom, type Env } from "./worker.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

// ── 假 Durable Object 執行環境 ───────────────────────────────────────────────

/** 休眠式 WebSocket 的假替身：attachment 跨「休眠」存活、send 記進 sent。 */
class FakeWs {
  attachment: unknown = null;
  sent: string[] = [];
  closed = false;
  tags: string[] = [];
  serializeAttachment(o: unknown): void {
    this.attachment = o;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.closed = true;
  }
  /** 取出並清空目前收到的訊息（已解析）。 */
  drain(): unknown[] {
    const out = this.sent.map((s) => JSON.parse(s));
    this.sent = [];
    return out;
  }
}

/** `new WebSocketPair()` 的假替身：[client, server]。 */
class FakeWebSocketPair {
  0: FakeWs;
  1: FakeWs;
  constructor() {
    this[0] = new FakeWs();
    this[1] = new FakeWs();
  }
}

/**
 * 假 `DurableObjectState`：以 node:sqlite 撐起 `ctx.storage.sql`（跨「休眠」存活——因為同一個
 * FakeState 會被兩個 RelayRoom 共用，模擬記憶體清空但 storage 保留），並記住 acceptWebSocket
 * 掛上的連線與 tag。
 */
class FakeState {
  sockets: FakeWs[] = [];
  alarm: number | null = null;
  private readonly db = new DatabaseSync(":memory:");

  private raw(query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] {
    const stmt = this.db.prepare(query);
    if (/^\s*select/i.test(query)) return stmt.all(...bindings) as Record<string, unknown>[];
    stmt.run(...bindings);
    return [];
  }

  storage = {
    sql: {
      exec: (query: string, ...bindings: (string | number | null)[]) => ({
        toArray: () => this.raw(query, ...bindings),
      }),
    },
    getAlarm: async (): Promise<number | null> => this.alarm,
    setAlarm: async (t: number): Promise<void> => {
      this.alarm = t;
    },
  };

  blockConcurrencyWhile = async (fn: () => Promise<void>): Promise<void> => {
    await fn();
  };

  acceptWebSocket(ws: FakeWs, tags: string[]): void {
    ws.tags = tags;
    this.sockets.push(ws);
  }

  getWebSockets(tag?: string): FakeWs[] {
    return tag === undefined ? this.sockets : this.sockets.filter((w) => w.tags.includes(tag));
  }
}

// Workers 專屬的全域；Response(status:101) 在 undici 會拋（狀態超出 200–599），故一併換掉。
beforeAll(() => {
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = FakeWebSocketPair;
  (globalThis as unknown as { Response: unknown }).Response = class {
    constructor(
      public body: unknown,
      public init: unknown,
    ) {}
  };
});

const HOST = "cinder-relay.example";
const RELAY_URL = `wss://${HOST}`;

function newRoom(state: FakeState, env: Env = {} as Env): RelayRoom {
  return new RelayRoom(state as unknown as DurableObjectState, env);
}

/** 模擬一次連線升級：回傳伺服端 socket，其 attachment 內含 connId。 */
function open(room: RelayRoom, state: FakeState): FakeWs {
  const before = state.sockets.length;
  room.fetch(new Request(`https://${HOST}/`));
  return state.sockets[before]!; // 本次新掛上的伺服端連線
}

const connIdOf = (ws: FakeWs): string => (ws.attachment as { connId: string }).connId;

/** 對某連線送一則客戶端訊息並回傳其收到的回應（已解析、已清空）。 */
function send(room: RelayRoom, ws: FakeWs, msg: unknown[]): unknown[] {
  room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(msg));
  return ws.drain();
}

/** 完成一次 NIP-42 認證（correct challenge + relay tag），回傳是否成功。 */
function authenticate(room: RelayRoom, ws: FakeWs, sk: SecretKey, relayUrl = RELAY_URL): boolean {
  const challenge = challengeOf(ws);
  const ev = buildAuthEvent(challenge, relayUrl, sk);
  // 回應可能夾在未 drain 的初始挑戰之後，用型別找出那則 OK。
  const out = send(room, ws, ["AUTH", ev]) as [string, string, boolean, string][];
  return out.find((m) => m[0] === "OK")?.[2] === true;
}

/**
 * 取出連線的 AUTH 挑戰。**從 attachment 讀**（`ConnSnapshot.challenge`）而非 send 緩衝——
 * 挑戰在連線建立時就持久化，讀 attachment 不受「誰先 drain」的時序影響。
 */
function challengeOf(ws: FakeWs): string {
  const c = (ws.attachment as { challenge?: string } | null)?.challenge;
  if (!c) throw new Error("attachment 內無 challenge");
  return c;
}

const heartbeat = (sk: SecretKey, createdAt = Math.floor(Date.now() / 1000)): NostrEvent =>
  finalizeEvent({ kind: 20000, created_at: createdAt, tags: [], content: "" }, sk);

// ── 測試 ────────────────────────────────────────────────────────────────────

describe("RelayRoom — 連線與 NIP-42（真實宿主路徑）", () => {
  it("升級即發出 AUTH 挑戰，並存進 attachment（休眠可還原）", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    const msgs = ws.drain() as [string, string][];
    expect(msgs[0]?.[0]).toBe("AUTH");
    expect(typeof (ws.attachment as { connId: string }).connId).toBe("string");
  });

  it("正確 challenge + relay tag → 認證成功", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    expect(authenticate(room, ws, generateSecretKey())).toBe(true);
  });

  it("🔴 relay tag 指向別站 → 拒絕（宿主有把 request 主機接進 connect）", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    // challenge 是對的（模擬攻擊者從真中繼轉來的），但 relay tag 指向 evil。
    expect(authenticate(room, ws, generateSecretKey(), "wss://evil.example")).toBe(false);
  });
});

describe("RelayRoom — 濫用防護確實接上了（ADR-0235 H1 回歸）", () => {
  it("未來時戳被拒——證明 maxFutureSkewSec 有經 worker 傳進 core", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    const sk = generateSecretKey();
    authenticate(room, ws, sk);
    const future = heartbeat(sk, Math.floor(Date.now() / 1000) + 3600);
    const [ok] = send(room, ws, ["EVENT", future]) as [["OK", string, boolean, string]];
    expect(ok[2]).toBe(false);
    expect(ok[3]).toContain("時間戳");
  });

  it("重放同一事件被拒——證明 replayWindowSec 有接上（修正前 seenIds 永遠是空的）", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    const sk = generateSecretKey();
    authenticate(room, ws, sk);
    const beat = heartbeat(sk);
    const [first] = send(room, ws, ["EVENT", beat]) as [["OK", string, boolean, string]];
    expect(first[2]).toBe(true);
    const [second] = send(room, ws, ["EVENT", beat]) as [["OK", string, boolean, string]];
    expect(second[2]).toBe(false);
    expect(second[3]).toContain("duplicate");
  });

  it("未認證不得發布（requireAuth 有接上）", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    // 未認證的 EVENT：回應含拒絕 OK ＋ 重發的 AUTH 挑戰，故用型別找出那則 OK。
    const out = send(room, ws, ["EVENT", heartbeat(generateSecretKey())]) as [string, string, boolean, string][];
    const ok = out.find((m) => m[0] === "OK");
    expect(ok?.[2]).toBe(false);
    expect(String(ok?.[3])).toContain("auth-required");
  });
});

describe("RelayRoom — 收發與扇出", () => {
  it("認證後訂閱→他人發布→收到扇出（完整往返）", () => {
    const state = new FakeState();
    const room = newRoom(state);

    const watcherSk = generateSecretKey();
    const watcher = open(room, state);
    authenticate(room, watcher, watcherSk);
    const req = send(room, watcher, ["REQ", "s1", { kinds: [20000], authors: [getPublicKey(generateSecretKey())] }]);
    expect((req[0] as [string, string])[0]).toBe("EOSE");

    // watcher 訂閱自己的心跳作者集合太麻煩；改訂閱一個已知 sender。
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    send(room, watcher, ["REQ", "s2", { kinds: [20000], authors: [senderPk] }]);

    const sender = open(room, state);
    authenticate(room, sender, senderSk);
    const beat = heartbeat(senderSk);
    send(room, sender, ["EVENT", beat]);

    const got = watcher.drain() as [string, string, NostrEvent][];
    const evented = got.find((m) => m[0] === "EVENT" && m[1] === "s2");
    expect(evented?.[2]?.id).toBe(beat.id);
  });

  it("dispatch 只送給目標連線（tag 路由）", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const a = open(room, state);
    const b = open(room, state);
    a.drain();
    b.drain();
    // 對 a 送訊息，b 不應收到任何東西。
    send(room, a, ["REQ", "s1", { authors: [getPublicKey(generateSecretKey())] }]);
    expect(b.sent).toEqual([]);
  });
});

describe("RelayRoom — 休眠→喚醒還原（ADR-0059 + ADR-0235 H2）", () => {
  it("認證狀態跨休眠存活：喚醒後的新 RelayRoom 仍認得已認證連線", () => {
    const state = new FakeState();
    const room1 = newRoom(state);
    const ws = open(room1, state);
    authenticate(room1, ws, generateSecretKey());

    // 休眠：記憶體中的 RelayRoom 消失，但 storage 與 socket attachment 存活。
    const room2 = newRoom(state);
    // REQ 需要已認證；若還原成功，room2 直接回 EOSE 而非 auth-required。
    const out = send(room2, ws, ["REQ", "s1", { authors: [getPublicKey(generateSecretKey())] }]) as [string, string, string][];
    expect(out[0]?.[0]).toBe("EOSE");
    expect(JSON.stringify(out)).not.toContain("auth-required");
  });

  it("🔴 relayHost 跨休眠存活：喚醒後才認證，仍會驗 relay tag", () => {
    const state = new FakeState();
    const room1 = newRoom(state);
    const ws = open(room1, state); // 連線建立→challenge 與 relayHost 寫進 attachment
    const challenge = challengeOf(ws);

    // 休眠前尚未認證。喚醒後才送 AUTH——relayHost 必須從 attachment 還原，否則檢查靜默失效。
    const room2 = newRoom(state);
    const badAuth = buildAuthEvent(challenge, "wss://evil.example", generateSecretKey());
    const out = send(room2, ws, ["AUTH", badAuth]) as [string, string, boolean, string][];
    const ok = out.find((m) => m[0] === "OK");
    expect(ok?.[2]).toBe(false); // relayHost 有還原 → evil 被擋

    // 對照：同一喚醒後的 room，正確 relay tag 仍可認證成功。
    const ws2 = open(room2, state);
    expect(authenticate(room2, ws2, generateSecretKey())).toBe(true);
  });

  it("離線留言跨休眠存活（DO SQLite）：喚醒後仍查得到", () => {
    const state = new FakeState();
    const room1 = newRoom(state);

    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const senderSk = generateSecretKey();
    const sender = open(room1, state);
    authenticate(room1, sender, senderSk);
    const dm = finalizeEvent(
      { kind: 1059, created_at: Math.floor(Date.now() / 1000), tags: [["p", recipientPk]], content: "x" },
      senderSk,
    );
    send(room1, sender, ["EVENT", dm]);

    // 休眠 → 收件人上線拉取。
    const room2 = newRoom(state);
    const reader = open(room2, state);
    authenticate(room2, reader, recipientSk);
    const out = send(room2, reader, ["REQ", "inbox", { kinds: [1059], "#p": [recipientPk] }]) as [string, string, NostrEvent][];
    const evented = out.find((m) => m[0] === "EVENT");
    expect(evented?.[2]?.id).toBe(dm.id);
  });
});

describe("分片路由（ADR-0241 worker fetch）", () => {
  const routeOf = async (path: string): Promise<string> => {
    let routed = "";
    const env = {
      RELAY_ROOM: {
        idFromName: (n: string) => {
          routed = n;
          return {} as never;
        },
        get: () => ({ fetch: () => new Response(null, { status: 101 }) }),
      },
    } as unknown as Env;
    await worker.fetch(new Request(`https://${HOST}${path}`, { headers: { Upgrade: "websocket" } }), env);
    return routed;
  };

  it("/s/<prefix> → 訊息片", async () => {
    expect(await routeOf("/s/a")).toBe("shard-a");
  });
  it("/presence → presence 獨立層", async () => {
    expect(await routeOf("/presence")).toBe("presence");
  });
  it("/（舊客戶端）→ 舊全域 DO（遷移回退）", async () => {
    expect(await routeOf("/")).toBe("global");
  });
});

describe("分片血條隔離（ADR-0241）", () => {
  it("一片收畸形訊息（不拋）不影響另一片：他片的離線留言照樣查得到", () => {
    // shard-A：塞畸形訊息（模擬攻擊/崩潰路徑，C1 已保證不拋）——完全獨立的 state/DO。
    const stateA = new FakeState();
    const roomA = newRoom(stateA);
    const wsA = open(roomA, stateA);
    wsA.drain();
    expect(() => roomA.webSocketMessage(wsA as unknown as WebSocket, "not json{{{")).not.toThrow();

    // shard-B：另一個獨立 DO——存一則離線留言。
    const stateB = new FakeState();
    const roomB = newRoom(stateB);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const senderSk = generateSecretKey();
    const sender = open(roomB, stateB);
    authenticate(roomB, sender, senderSk);
    const dm = finalizeEvent(
      { kind: 1059, created_at: Math.floor(Date.now() / 1000), tags: [["p", recipientPk]], content: "x" },
      senderSk,
    );
    send(roomB, sender, ["EVENT", dm]);

    // shard-A 的故障不影響 shard-B：B 的收件人照常拉到留言（血條＝一崩 1/N）。
    const reader = open(roomB, stateB);
    authenticate(roomB, reader, recipientSk);
    const out = send(roomB, reader, ["REQ", "inbox", { kinds: [1059], "#p": [recipientPk] }]) as [
      string,
      string,
      NostrEvent,
    ][];
    expect(out.find((m) => m[0] === "EVENT")?.[2]?.id).toBe(dm.id);
  });
});

describe("RelayRoom — 崩潰韌性（ADR-0235 C1 宿主層）", () => {
  it("畸形訊息不會讓房間拋例外（單一惡意訊息不打掛全域 DO）", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    ws.drain();
    expect(() => room.webSocketMessage(ws as unknown as WebSocket, "not json{{{")).not.toThrow();
    // tags 為物件的畸形事件（能通過驗簽卻讓 tags.find 拋）——解析層擋下，回 NOTICE。
    const sk = generateSecretKey();
    authenticate(room, ws, sk);
    const good = heartbeat(sk);
    expect(() =>
      room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(["EVENT", { ...good, tags: {} }])),
    ).not.toThrow();
  });

  it("webSocketClose 清掉連線且不拋", () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = open(room, state);
    expect(() => room.webSocketClose(ws as unknown as WebSocket)).not.toThrow();
    expect(ws.closed).toBe(true);
  });
});

describe("公共 TURN 端點（/turn，ADR-0243）", () => {
  const cfBody = JSON.stringify({
    iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "p" },
  });
  const okFetch = (async () =>
    ({ ok: true, status: 201, text: async () => cfBody }) as unknown as Response) as typeof fetch;
  // 本檔的 beforeAll 把全域 Response 換成只存 {body, init} 的替身（見上）；照其形狀斷言。
  const stub = (r: Response) => r as unknown as { body: unknown; init: { status?: number; headers?: Record<string, string> } };

  it("未配 secret → 204（客戶端退回純 STUN，no-op）", async () => {
    const r = stub(await mintTurnResponse({} as Env, okFetch));
    expect(r.init.status).toBe(204);
    expect(r.body).toBeNull();
  });

  it("配好 secret → 200＋Cloudflare 憑證 body＋CORS", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 201, text: async () => cfBody } as unknown as Response;
    }) as typeof fetch;
    const env = { TURN_KEY_ID: "key123", TURN_API_TOKEN: "tok", TURN_TTL_SECONDS: "3600" } as Env;
    const r = stub(await mintTurnResponse(env, spy));
    expect(r.init.status).toBe(200);
    expect(r.init.headers?.["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(r.body as string)).toEqual(JSON.parse(cfBody));
    // 打對 Cloudflare API、帶 Bearer token 與 ttl。
    expect(seen?.url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate");
    expect((seen?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(seen?.init?.body as string)).toEqual({ ttl: 3600 });
  });

  it("Cloudflare 回非 2xx → 204（保底抓不到不讓客戶端報錯）", async () => {
    const bad = (async () => ({ ok: false, status: 500, text: async () => "" }) as unknown as Response) as typeof fetch;
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    expect(stub(await mintTurnResponse(env, bad)).init.status).toBe(204);
  });

  it("fetch 拋 → 204", async () => {
    const boom = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    expect(stub(await mintTurnResponse(env, boom)).init.status).toBe(204);
  });

  it("TTL 未設 → 預設 86400", async () => {
    let body: string | undefined;
    const spy = (async (_url: string, init?: RequestInit) => {
      body = init?.body as string;
      return { ok: true, status: 201, text: async () => cfBody } as unknown as Response;
    }) as typeof fetch;
    await mintTurnResponse({ TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env, spy);
    expect(JSON.parse(body as string)).toEqual({ ttl: 86400 });
  });
});
