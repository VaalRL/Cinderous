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
import { buildAuthEvent, buildHttpAuthEvent, finalizeEvent, minePow, generateSecretKey, getPublicKey, httpAuthHeader, type NostrEvent, type SecretKey } from "@cinderous/core";
import { beforeAll, describe, expect, it } from "vitest";
import worker, { mintTurnResponse, turnPreflightResponse, RelayRoom, type Env } from "./worker.js";
import { MAX_MESSAGES_PER_MINUTE } from "./host-config.js";

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

  /** key-value storage（ADR-0366 用它記住本實例的車道政策）；與 sql 同樣跨「休眠」保留。 */
  kv = new Map<string, unknown>();

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
    get: async <T>(key: string): Promise<T | undefined> => this.kv.get(key) as T | undefined,
    put: async (key: string, value: unknown): Promise<void> => {
      this.kv.set(key, value);
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
      public init?: { status?: number },
    ) {}
    /** 真 Response 有；替身漏了會讓「回幾號」這類斷言永遠拿到 undefined。 */
    get status(): number {
      return this.init?.status ?? 200;
    }
  };
});

const nowSec = (): number => Math.floor(Date.now() / 1000);
const HOST = "cinder-relay.example";
const RELAY_URL = `wss://${HOST}`;

function newRoom(state: FakeState, env: Env = {} as Env): RelayRoom {
  return new RelayRoom(state as unknown as DurableObjectState, env);
}

/**
 * 模擬一次連線升級：回傳伺服端 socket，其 attachment 內含 connId。
 *
 * `fetch` 自 ADR-0366 起是 async（要把車道政策寫進 storage 釘住），故此 helper 也是。
 * `lane` 未指定＝嚴格平面，與路由方對 `/`、`/s/<n>`、`/presence` 的判定一致。
 */
async function open(room: RelayRoom, state: FakeState, lane: "strict" | "app" = "strict"): Promise<FakeWs> {
  const before = state.sockets.length;
  // 政策由**路徑**決定（與 worker 路由同一個 `routeForPath`），故這裡也用路徑。
  await room.fetch(new Request(`https://${HOST}${lane === "app" ? "/app/testgame" : "/"}`));
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
  it("升級即發出 AUTH 挑戰，並存進 attachment（休眠可還原）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    const msgs = ws.drain() as [string, string][];
    expect(msgs[0]?.[0]).toBe("AUTH");
    expect(typeof (ws.attachment as { connId: string }).connId).toBe("string");
  });

  it("正確 challenge + relay tag → 認證成功", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    expect(authenticate(room, ws, generateSecretKey())).toBe(true);
  });

  it("🔴 relay tag 指向別站 → 拒絕（宿主有把 request 主機接進 connect）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    // challenge 是對的（模擬攻擊者從真中繼轉來的），但 relay tag 指向 evil。
    expect(authenticate(room, ws, generateSecretKey(), "wss://evil.example")).toBe(false);
  });
});

describe("RelayRoom — 濫用防護確實接上了（ADR-0235 H1 回歸）", () => {
  it("未來時戳被拒——證明 maxFutureSkewSec 有經 worker 傳進 core", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    const sk = generateSecretKey();
    authenticate(room, ws, sk);
    const future = heartbeat(sk, Math.floor(Date.now() / 1000) + 3600);
    const [ok] = send(room, ws, ["EVENT", future]) as [["OK", string, boolean, string]];
    expect(ok[2]).toBe(false);
    expect(ok[3]).toContain("時間戳");
  });

  it("重放同一事件被拒——證明 replayWindowSec 有接上（修正前 seenIds 永遠是空的）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    const sk = generateSecretKey();
    authenticate(room, ws, sk);
    const beat = heartbeat(sk);
    const [first] = send(room, ws, ["EVENT", beat]) as [["OK", string, boolean, string]];
    expect(first[2]).toBe(true);
    const [second] = send(room, ws, ["EVENT", beat]) as [["OK", string, boolean, string]];
    expect(second[2]).toBe(false);
    expect(second[3]).toContain("duplicate");
  });

  it("未認證不得發布（requireAuth 有接上）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    // 未認證的 EVENT：回應含拒絕 OK ＋ 重發的 AUTH 挑戰，故用型別找出那則 OK。
    const out = send(room, ws, ["EVENT", heartbeat(generateSecretKey())]) as [string, string, boolean, string][];
    const ok = out.find((m) => m[0] === "OK");
    expect(ok?.[2]).toBe(false);
    expect(String(ok?.[3])).toContain("auth-required");
  });
});

describe("RelayRoom — 收發與扇出", () => {
  it("認證後訂閱→他人發布→收到扇出（完整往返）", async () => {
    const state = new FakeState();
    const room = newRoom(state);

    const watcherSk = generateSecretKey();
    const watcher = await open(room, state);
    authenticate(room, watcher, watcherSk);
    const req = send(room, watcher, ["REQ", "s1", { kinds: [20000], authors: [getPublicKey(generateSecretKey())] }]);
    expect((req[0] as [string, string])[0]).toBe("EOSE");

    // watcher 訂閱自己的心跳作者集合太麻煩；改訂閱一個已知 sender。
    const senderSk = generateSecretKey();
    const senderPk = getPublicKey(senderSk);
    send(room, watcher, ["REQ", "s2", { kinds: [20000], authors: [senderPk] }]);

    const sender = await open(room, state);
    authenticate(room, sender, senderSk);
    const beat = heartbeat(senderSk);
    send(room, sender, ["EVENT", beat]);

    const got = watcher.drain() as [string, string, NostrEvent][];
    const evented = got.find((m) => m[0] === "EVENT" && m[1] === "s2");
    expect(evented?.[2]?.id).toBe(beat.id);
  });

  it("dispatch 只送給目標連線（tag 路由）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const a = await open(room, state);
    const b = await open(room, state);
    a.drain();
    b.drain();
    // 對 a 送訊息，b 不應收到任何東西。
    send(room, a, ["REQ", "s1", { authors: [getPublicKey(generateSecretKey())] }]);
    expect(b.sent).toEqual([]);
  });
});

describe("RelayRoom — 休眠→喚醒還原（ADR-0059 + ADR-0235 H2）", () => {
  it("認證狀態跨休眠存活：喚醒後的新 RelayRoom 仍認得已認證連線", async () => {
    const state = new FakeState();
    const room1 = newRoom(state);
    const ws = await open(room1, state);
    authenticate(room1, ws, generateSecretKey());

    // 休眠：記憶體中的 RelayRoom 消失，但 storage 與 socket attachment 存活。
    const room2 = newRoom(state);
    // REQ 需要已認證；若還原成功，room2 直接回 EOSE 而非 auth-required。
    const out = send(room2, ws, ["REQ", "s1", { authors: [getPublicKey(generateSecretKey())] }]) as [string, string, string][];
    expect(out[0]?.[0]).toBe("EOSE");
    expect(JSON.stringify(out)).not.toContain("auth-required");
  });

  it("🔴 relayHost 跨休眠存活：喚醒後才認證，仍會驗 relay tag", async () => {
    const state = new FakeState();
    const room1 = newRoom(state);
    const ws = await open(room1, state); // 連線建立→challenge 與 relayHost 寫進 attachment
    const challenge = challengeOf(ws);

    // 休眠前尚未認證。喚醒後才送 AUTH——relayHost 必須從 attachment 還原，否則檢查靜默失效。
    const room2 = newRoom(state);
    const badAuth = buildAuthEvent(challenge, "wss://evil.example", generateSecretKey());
    const out = send(room2, ws, ["AUTH", badAuth]) as [string, string, boolean, string][];
    const ok = out.find((m) => m[0] === "OK");
    expect(ok?.[2]).toBe(false); // relayHost 有還原 → evil 被擋

    // 對照：同一喚醒後的 room，正確 relay tag 仍可認證成功。
    const ws2 = await open(room2, state);
    expect(authenticate(room2, ws2, generateSecretKey())).toBe(true);
  });

  it("離線留言跨休眠存活（DO SQLite）：喚醒後仍查得到", async () => {
    const state = new FakeState();
    const room1 = newRoom(state);

    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const senderSk = generateSecretKey();
    const sender = await open(room1, state);
    authenticate(room1, sender, senderSk);
    const dm = finalizeEvent(
      { kind: 1059, created_at: Math.floor(Date.now() / 1000), tags: [["p", recipientPk]], content: "x" },
      senderSk,
    );
    send(room1, sender, ["EVENT", dm]);

    // 休眠 → 收件人上線拉取。
    const room2 = newRoom(state);
    const reader = await open(room2, state);
    authenticate(room2, reader, recipientSk);
    const out = send(room2, reader, ["REQ", "inbox", { kinds: [1059], "#p": [recipientPk] }]) as [string, string, NostrEvent][];
    const evented = out.find((m) => m[0] === "EVENT");
    expect(evented?.[2]?.id).toBe(dm.id);
  });
});

describe("NIP-11 端點（ADR-0260 worker fetch）", () => {
  // 本檔的全域 `Response` 是假的（見 beforeAll）——只記 body 與 init，故這樣拆。
  const get = async (
    headers: Record<string, string> = {},
    env: Partial<Env> = {},
  ): Promise<{ body: string; status?: number; headers?: Record<string, string> }> => {
    const r = (await worker.fetch(new Request(`https://${HOST}/`, { headers }), env as Env)) as unknown as {
      body: string;
      init: { status?: number; headers?: Record<string, string> };
    };
    return { body: r.body, ...r.init };
  };
  const docOf = async (env: Partial<Env> = {}): Promise<Record<string, unknown>> =>
    JSON.parse((await get({ Accept: "application/nostr+json" }, env)).body) as Record<string, unknown>;

  it("不帶 Accept → 維持純文字 200（健康檢查契約不破，ADR-0089）", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toBe("Cinderous relay");
  });

  it("帶 application/nostr+json → 回 NIP-11 文件（含 CORS，瀏覽器版要跨源抓）", async () => {
    const r = await get({ Accept: "application/nostr+json" });
    expect(r.status).toBe(200);
    expect(r.headers?.["content-type"]).toContain("application/nostr+json");
    expect(r.headers?.["Access-Control-Allow-Origin"]).toBe("*");
    const doc = JSON.parse(r.body) as Record<string, unknown>;
    expect(doc.supported_nips).toContain(62);
    // worker 的 RelayCore 恆為 requireAuth: true——文件必須據實反映，不能各說各話。
    expect((doc.limitation as Record<string, unknown>).auth_required).toBe(true);
  });

  it("營運者填了贊助管道就出現在文件裡（ADR-0089 的入口終於有載體）", async () => {
    const doc = await docOf({
      DONATE_GITHUB_SPONSORS: "https://github.com/sponsors/op",
      RELAY_CONTACT: "op@example.com",
    });
    expect(doc.cinder_donations).toEqual({ github_sponsors: "https://github.com/sponsors/op" });
    expect(doc.contact).toBe("op@example.com");
  });

  it("未填贊助管道＝整個欄位不出現（客戶端據此不顯示贊助卡）", async () => {
    expect("cinder_donations" in (await docOf())).toBe(false);
  });

  it("站方 TTL 上限反映在 retention（企業站放寬後客戶端看得到）", async () => {
    expect((await docOf({ MAX_TTL_DAYS: "90" })).retention).toEqual([{ time: 90 * 86_400 }]);
  });
});


describe("第三方車道路由（ADR-0366 worker fetch）", () => {
  /** 回傳 [DO 名, DO 收到的路徑, HTTP 狀態]。 */
  const route = async (path: string): Promise<[string, string, number]> => {
    let doName = "";
    let seenPath = "";
    const env = {
      RELAY_ROOM: {
        idFromName: (n: string) => {
          doName = n;
          return {} as never;
        },
        get: () => ({
          fetch: (req: Request) => {
            seenPath = new URL(req.url).pathname;
            return new Response(null, { status: 101 });
          },
        }),
      },
    } as unknown as Env;
    const res = await worker.fetch(
      new Request(`https://${HOST}${path}`, { headers: { Upgrade: "websocket" } }),
      env,
    );
    return [doName, seenPath, res.status];
  };

  it("/app/<laneId> → 車道 DO", async () => {
    const [doName, , status] = await route("/app/elementalist");
    expect(doName).toMatch(/^app-[0-7]$/);
    expect(status).toBe(101);
  });

  it("🔴 request 原封不動轉給 DO——政策由 DO 自己對同一路徑算，兩邊不可能不一致", async () => {
    for (const p of ["/", "/s/a", "/presence", "/app/elementalist"]) {
      const [, seenPath] = await route(p);
      expect(seenPath, p).toBe(p);
    }
  });

  it("🔴 認不得的路徑回 404，且**根本不碰 DO**", async () => {
    for (const p of ["/s/zz", "/s/ab", "/nope", "/app"]) {
      const [doName, , status] = await route(p);
      expect(status, p).toBe(404);
      expect(doName, p).toBe(""); // idFromName 沒被呼叫
    }
  });
});

describe("RelayRoom — 車道政策釘住（ADR-0366）", () => {
  it("車道連線放行標籤訂閱；嚴格平面同一個 filter 被擋", async () => {
    const laneState = new FakeState();
    const laneRoom = newRoom(laneState);
    const lane = await open(laneRoom, laneState, "app");
    // 車道不要求 AUTH，可直接訂閱（ADR-0366 §決策 5 的 requireAuth: false）
    expect(send(laneRoom, lane, ["REQ", "s", { kinds: [1078], "#w": ["world-1"] }])).toContainEqual([
      "EOSE",
      "s",
    ]);

    const strictState = new FakeState();
    const strictRoom = newRoom(strictState);
    const strict = await open(strictRoom, strictState);
    const out = send(strictRoom, strict, ["REQ", "s", { kinds: [1078], "#w": ["world-1"] }]);
    // 嚴格平面先要 AUTH；就算認證了也會因為沒有 #p/authors 而被擋（見 relay-core 測試）。
    expect(JSON.stringify(out)).toContain("auth-required");
  });

  it("🔴 政策跨休眠存活：喚醒後的新 RelayRoom 仍是車道", async () => {
    const state = new FakeState();
    await open(newRoom(state), state, "app");
    // 休眠＝記憶體清空、storage 保留 ⇒ 新實例從 storage 還原政策
    const woken = newRoom(state);
    const ws = await open(woken, state, "app");
    expect(send(woken, ws, ["REQ", "s", { kinds: [1078], "#w": ["w"] }])).toContainEqual(["EOSE", "s"]);
  });

  it("🔴 釘住之後收到不同政策 → 409，不切換（同一份儲存不可被兩套規則讀寫）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    await open(room, state, "app");
    const res = await room.fetch(new Request(`https://${HOST}/`)); // 同一顆 DO 收到嚴格平面的路徑
    expect(res.status).toBe(409);
  });

  it("認不得的路徑漏進 DO 時一律當嚴格（fail-closed 的底線；正常情況 worker 已先 404）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    await room.fetch(new Request(`https://${HOST}/s/zz`));
    expect(state.kv.get("cinder:lane-profile")).toBe("strict");
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
  it("一片收畸形訊息（不拋）不影響另一片：他片的離線留言照樣查得到", async () => {
    // shard-A：塞畸形訊息（模擬攻擊/崩潰路徑，C1 已保證不拋）——完全獨立的 state/DO。
    const stateA = new FakeState();
    const roomA = newRoom(stateA);
    const wsA = await open(roomA, stateA);
    wsA.drain();
    expect(() => roomA.webSocketMessage(wsA as unknown as WebSocket, "not json{{{")).not.toThrow();

    // shard-B：另一個獨立 DO——存一則離線留言。
    const stateB = new FakeState();
    const roomB = newRoom(stateB);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const senderSk = generateSecretKey();
    const sender = await open(roomB, stateB);
    authenticate(roomB, sender, senderSk);
    const dm = finalizeEvent(
      { kind: 1059, created_at: Math.floor(Date.now() / 1000), tags: [["p", recipientPk]], content: "x" },
      senderSk,
    );
    send(roomB, sender, ["EVENT", dm]);

    // shard-A 的故障不影響 shard-B：B 的收件人照常拉到留言（血條＝一崩 1/N）。
    const reader = await open(roomB, stateB);
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
  it("畸形訊息不會讓房間拋例外（單一惡意訊息不打掛全域 DO）", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
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

  it("webSocketClose 清掉連線且不拋", async () => {
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state);
    expect(() => room.webSocketClose(ws as unknown as WebSocket)).not.toThrow();
    expect(ws.closed).toBe(true);
  });
});

describe("公共 TURN 端點（/turn，ADR-0243／0342）", () => {
  const cfJson = { iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "p" } };
  const cfBody = JSON.stringify(cfJson);
  const okFetch = (async () =>
    ({ ok: true, status: 201, text: async () => cfBody, json: async () => cfJson }) as unknown as Response) as typeof fetch;
  // 本檔的 beforeAll 把全域 Response 換成只存 {body, init} 的替身（見上）；照其形狀斷言。
  const stub = (r: Response) => r as unknown as { body: unknown; init: { status?: number; headers?: Record<string, string> } };

  const TURN_URL = "https://relay.example/turn";
  const authSk = generateSecretKey();
  /** 帶合法 NIP-98 授權的請求（ADR-0342 §3.2）。 */
  const authed = (url = TURN_URL): Request =>
    ({
      url,
      method: "GET",
      headers: { get: (h: string) => (h === "Authorization" ? httpAuthHeader(buildHttpAuthEvent(url, "GET", authSk)) : null) },
    }) as unknown as Request;
  /** 未帶授權。 */
  const bare = (url = TURN_URL): Request =>
    ({ url, method: "GET", headers: { get: () => null } }) as unknown as Request;

  it("未配 secret → 204（客戶端退回純 STUN，no-op）", async () => {
    const r = stub(await mintTurnResponse({} as Env, authed(), okFetch));
    expect(r.init.status).toBe(204);
    expect(r.body).toBeNull();
  });

  it("配好 secret → 200＋Cloudflare 憑證 body＋CORS", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 201, text: async () => cfBody, json: async () => cfJson } as unknown as Response;
    }) as typeof fetch;
    const env = { TURN_KEY_ID: "key123", TURN_API_TOKEN: "tok", TURN_TTL_SECONDS: "3600" } as Env;
    const r = stub(await mintTurnResponse(env, authed(), spy));
    expect(r.init.status).toBe(200);
    expect(r.init.headers?.["Access-Control-Allow-Origin"]).toBe("*");
    // ⓪ ADR-0342 §2：回應要**帶上 ttl**，客戶端才知道何時該刷新。
    expect(JSON.parse(r.body as string)).toEqual({ ...cfJson, ttl: 3600 });
    // 打對 Cloudflare API、帶 Bearer token 與 ttl。
    expect(seen?.url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate");
    expect((seen?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(seen?.init?.body as string)).toEqual({ ttl: 3600 });
  });

  it("Cloudflare 回非 2xx → 204（保底抓不到不讓客戶端報錯）", async () => {
    const bad = (async () => ({ ok: false, status: 500, text: async () => "" }) as unknown as Response) as typeof fetch;
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    expect(stub(await mintTurnResponse(env, authed(), bad)).init.status).toBe(204);
  });

  it("fetch 拋 → 204", async () => {
    const boom = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    expect(stub(await mintTurnResponse(env, authed(), boom)).init.status).toBe(204);
  });

  it("🔴 未帶授權 → 401（**不是 204**——204 的語意是站方未配置，兩者不可混）", async () => {
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    expect(stub(await mintTurnResponse(env, bare(), okFetch)).init.status).toBe(401);
  });

  it("🔴 對別的 URL 簽的授權不能拿來打 /turn", async () => {
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    const wrong = {
      url: TURN_URL,
      method: "GET",
      headers: {
        get: (h: string) =>
          h === "Authorization" ? httpAuthHeader(buildHttpAuthEvent("https://relay.example/other", "GET", authSk)) : null,
      },
    } as unknown as Request;
    expect(stub(await mintTurnResponse(env, wrong, okFetch)).init.status).toBe(401);
  });

  it("⚠ 未配 secret 時先回 204，不因缺授權而變 401（站方未配置的語意優先）", async () => {
    expect(stub(await mintTurnResponse({} as Env, bare(), okFetch)).init.status).toBe(204);
  });

  it("超過取得速率 → 429，且**不去跟 Cloudflare 換憑證**", async () => {
    let called = 0;
    const spy = (async () => {
      called++;
      return { ok: true, status: 201, json: async () => cfJson } as unknown as Response;
    }) as typeof fetch;
    const env = {
      TURN_KEY_ID: "k",
      TURN_API_TOKEN: "t",
      TURN_LIMIT: { limit: async () => ({ success: false }) },
    } as unknown as Env;
    expect(stub(await mintTurnResponse(env, authed(), spy)).init.status).toBe(429);
    expect(called, "被限速就不該再花一次換發").toBe(0);
  });

  it("未綁定 TURN_LIMIT ⇒ 不限速（本地開發/測試沒有這個 binding，不該因此壞掉）", async () => {
    const env = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    expect(stub(await mintTurnResponse(env, authed(), okFetch)).init.status).toBe(200);
  });

  it("🔴 審查 #1：CORS 預檢必須在授權檢查之前放行，且帶 Allow-Headers: Authorization", () => {
    // `Authorization` 不是 CORS 安全列表標頭 ⇒ 瀏覽器（含 Tauri／Capacitor webview）會先送
    // OPTIONS。若讓它走進換發流程會回 401 且無 CORS 標頭 ⇒ 瀏覽器擋掉整個請求、TURN 靜默失效。
    const r = stub(turnPreflightResponse());
    expect(r.init.status).toBe(204);
    expect(r.init.headers?.["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(r.init.headers?.["Access-Control-Allow-Methods"]).toContain("GET");
    expect(r.init.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("🔴 審查 #1：**每一種**回應都要帶 CORS（否則瀏覽器讀不到狀態、分不出被擋或未配置）", async () => {
    const envOff = {} as Env;
    const envOn = { TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env;
    const limited = {
      TURN_KEY_ID: "k",
      TURN_API_TOKEN: "t",
      TURN_LIMIT: { limit: async () => ({ success: false }) },
    } as unknown as Env;
    for (const [label, r] of [
      ["204 未配置", stub(await mintTurnResponse(envOff, bare(), okFetch))],
      ["401 未授權", stub(await mintTurnResponse(envOn, bare(), okFetch))],
      ["429 限速", stub(await mintTurnResponse(limited, authed(), okFetch))],
      ["200 正常", stub(await mintTurnResponse(envOn, authed(), okFetch))],
    ] as const) {
      expect(r.init.headers?.["Access-Control-Allow-Origin"], label).toBe("*");
    }
  });

  it("🔴 審查 #2：速率限制以 **IP** 計數——pubkey 由請求方自選、換一把不用錢", async () => {
    let key: string | undefined;
    const env = {
      TURN_KEY_ID: "k",
      TURN_API_TOKEN: "t",
      TURN_LIMIT: { limit: async (o: { key: string }) => ((key = o.key), { success: true }) },
    } as unknown as Env;
    const withIp = {
      url: TURN_URL,
      method: "GET",
      headers: {
        get: (h: string) =>
          h === "Authorization"
            ? httpAuthHeader(buildHttpAuthEvent(TURN_URL, "GET", authSk))
            : h === "CF-Connecting-IP"
              ? "203.0.113.7"
              : null,
      },
    } as unknown as Request;
    await mintTurnResponse(env, withIp, okFetch);
    expect(key, "以 pubkey 計數等於沒有限制").toBe("203.0.113.7");
    expect(key).not.toBe(getPublicKey(authSk));
  });

  it("沒有 CF-Connecting-IP（本地/測試）→ 退回 pubkey，不因此壞掉", async () => {
    let key: string | undefined;
    const env = {
      TURN_KEY_ID: "k",
      TURN_API_TOKEN: "t",
      TURN_LIMIT: { limit: async (o: { key: string }) => ((key = o.key), { success: true }) },
    } as unknown as Env;
    await mintTurnResponse(env, authed(), okFetch);
    expect(key).toBe(getPublicKey(authSk));
  });

  it("TTL 未設 → 預設 86400", async () => {
    let body: string | undefined;
    const spy = (async (_url: string, init?: RequestInit) => {
      body = init?.body as string;
      return { ok: true, status: 201, text: async () => cfBody, json: async () => cfJson } as unknown as Response;
    }) as typeof fetch;
    const r = stub(await mintTurnResponse({ TURN_KEY_ID: "k", TURN_API_TOKEN: "t" } as Env, authed(), spy));
    expect(JSON.parse(body as string)).toEqual({ ttl: 86400 });
    // 回應帶的 ttl 必須與送給 Cloudflare 的一致（唯一真實來源，ADR-0342 §2）。
    expect((JSON.parse(r.body as string) as { ttl: number }).ttl).toBe(86400);
  });
});

describe("統一節點：選配靜態資產（ADR-0354）", () => {
  /**
   * 假的 `ASSETS` 綁定（Workers Static Assets 的 Fetcher）。
   * 記下它收到的 URL，並回一個可辨識的 body——用來斷言「這個請求真的被交給資產了」。
   */
  const fakeAssets = (): { binding: NonNullable<Env["ASSETS"]>; seen: string[] } => {
    const seen: string[] = [];
    const binding = {
      fetch: (req: Request) => {
        seen.push(new URL(req.url).pathname);
        return new Response("<!doctype html>index", { status: 200 });
      },
    } as unknown as NonNullable<Env["ASSETS"]>;
    return { binding, seen };
  };

  const get = async (
    path: string,
    env: Partial<Env>,
    headers: Record<string, string> = {},
  ): Promise<{ body: string; status: number | undefined }> => {
    const r = (await worker.fetch(new Request(`https://${HOST}${path}`, { headers }), env as Env)) as unknown as {
      body: string;
      init: { status?: number };
    };
    return { body: r.body, status: r.init?.status };
  };

  it("未綁定 ASSETS（純 relay，預設模式）→ `/` 維持純文字（現況不變）", async () => {
    const r = await get("/", {});
    expect(r.status).toBe(200);
    expect(r.body).toBe("Cinderous relay");
  });

  it("🔴 `/healthz` 回的是 `ok`——文件、官網與 App 的探測都照這個字串判斷", async () => {
    // 先前它回 `Cinderous relay`，而 ADR-0356、自架文件、官網中英文案與 `cf_verify_healthz`
    // 全都寫 `ok`。每個照著教學做的自架者都會得出「我的節點壞了」的結論。
    expect((await get("/healthz", {})).body).toBe("ok");
  });

  it("綁定 ASSETS → `/` 交給資產（SPA 首頁；回退由 not_found_handling 處理）", async () => {
    const { binding, seen } = fakeAssets();
    const r = await get("/", { ASSETS: binding });
    expect(r.body).toContain("index");
    expect(seen).toEqual(["/"]);
  });

  it("綁定 ASSETS → 深層路徑也交給資產（`/chat/npub1…` 由 SPA 回退接手）", async () => {
    const { binding, seen } = fakeAssets();
    await get("/chat/npub1abc", { ASSETS: binding });
    expect(seen).toEqual(["/chat/npub1abc"]);
  });

  it("🔴 綁定 ASSETS → `/healthz` **不得**被資產吃掉（自架文件與 PaaS 健康檢查靠它，ADR-0089）", async () => {
    const { binding, seen } = fakeAssets();
    const r = await get("/healthz", { ASSETS: binding });
    expect(r.body).toBe("ok");
    expect(seen).toEqual([]);
  });

  it("🔴 綁定 ASSETS → NIP-11 仍優先於資產（社群探測不能拿到 HTML）", async () => {
    const { binding, seen } = fakeAssets();
    const r = await get("/", { ASSETS: binding }, { Accept: "application/nostr+json" });
    expect((JSON.parse(r.body) as { name: string }).name).toBe("Cinderous relay");
    expect(seen).toEqual([]);
  });

  it("🔴 綁定 ASSETS → `/turn` 仍優先於資產（通話保底不能變成 HTML）", async () => {
    const { binding, seen } = fakeAssets();
    const r = await get("/turn", { ASSETS: binding });
    expect(r.status).toBe(204); // 未配 secret＝no-op，但確實走到 TURN 分支
    expect(seen).toEqual([]);
  });

  it("🔴 綁定 ASSETS → 帶 Upgrade 的 `/` 仍到 DO（wrangler 需配 run_worker_first；程式碼側先擋住）", async () => {
    const { binding, seen } = fakeAssets();
    let routed = "";
    const env = {
      ASSETS: binding,
      RELAY_ROOM: {
        idFromName: (n: string) => {
          routed = n;
          return {} as never;
        },
        get: () => ({ fetch: () => new Response(null, { status: 101 }) }),
      },
    } as unknown as Env;
    await worker.fetch(new Request(`https://${HOST}/`, { headers: { Upgrade: "websocket" } }), env);
    expect(routed).toBe("global"); // ADR-0241 舊客戶端回退路徑
    expect(seen).toEqual([]); // 資產沒碰到這個請求
  });
});

describe("NIP-11 依路徑回該車道的文件（ADR-0366 P1 #6）", () => {
  const docAt = async (path: string): Promise<Record<string, unknown>> => {
    const res = await worker.fetch(
      new Request(`https://${HOST}${path}`, { headers: { Accept: "application/nostr+json" } }),
      {} as Env,
    );
    return JSON.parse((res as unknown as { body: string }).body) as Record<string, unknown>;
  };

  it("嚴格平面：要求 AUTH、具名訂閱", async () => {
    const doc = await docAt("/");
    expect((doc.limitation as Record<string, unknown>).auth_required).toBe(true);
    expect(doc.cinder_subscription_scope).toBe("named");
  });

  it("第三方車道：不要求 AUTH、接受標籤訂閱", async () => {
    const doc = await docAt("/app/elementalist");
    expect((doc.limitation as Record<string, unknown>).auth_required).toBe(false);
    expect(doc.cinder_subscription_scope).toBe("tagged");
  });

  it("🔴 認不得的路徑給嚴格版——問錯路徑不該拿到比較寬鬆的描述", async () => {
    expect((await docAt("/nope")).cinder_subscription_scope).toBe("named");
  });

  it("兩種路徑都報得出時鐘窗", async () => {
    for (const p of ["/", "/app/x"]) {
      expect((await docAt(p)).cinder_max_past_skew_sec, p).toBeGreaterThan(0);
    }
  });
});

describe("車道 PoW（ADR-0366 P2 #11）", () => {
  const publish = async (env: Env, lane: "strict" | "app", difficulty: number) => {
    const state = new FakeState();
    const room = newRoom(state, env);
    const ws = await open(room, state, lane);
    const sk = generateSecretKey();
    const e = minePow({ kind: 1078, created_at: nowSec(), tags: [["t", "g"]], content: "x" }, sk, difficulty);
    return send(room, ws, ["EVENT", e])[0] as [string, string, boolean, string];
  };

  it("未設 APP_LANE_POW → 車道照收未挖礦的持久化事件（預設不打開）", async () => {
    expect((await publish({} as Env, "app", 0))[2]).toBe(true);
  });

  it("設了就生效：未挖礦的事件被拒、挖過的收下", async () => {
    const env = { APP_LANE_POW: "8" } as Env;
    const rejected = await publish(env, "app", 0);
    expect(rejected[2]).toBe(false);
    expect(rejected[3]).toContain("pow");
    expect((await publish(env, "app", 8))[2]).toBe(true);
  });

  it("🔴 同一個變數對嚴格平面無效——自架者設錯不會鎖死自己的訊息平面", async () => {
    const env = { APP_LANE_POW: "8" } as Env;
    const state = new FakeState();
    const room = newRoom(state, env);
    const ws = await open(room, state); // 嚴格
    // 嚴格平面要 AUTH，先認證再發一顆沒挖過的持久化事件。
    const sk = generateSecretKey();
    const challenge = (ws.drain()[0] as [string, string])[1];
    send(room, ws, ["AUTH", buildAuthEvent(challenge, RELAY_URL, sk)]);
    const e = finalizeEvent({ kind: 1078, created_at: nowSec(), tags: [], content: "x" }, sk);
    const ok = send(room, ws, ["EVENT", e])[0] as [string, string, boolean, string];
    expect(ok[2]).toBe(true); // 沒有 PoW 也收得下
  });
});

describe("車道的成本護欄（ADR-0366 §容量）", () => {
  /** 以 IP 為鍵的升級速率限制替身；記下每次被問到的 key。 */
  const limiter = (allow: boolean) => {
    const keys: string[] = [];
    return {
      keys,
      binding: {
        limit: (opts: { key: string }) => {
          keys.push(opts.key);
          return Promise.resolve({ success: allow });
        },
      },
    };
  };

  /** 送一次升級請求；回傳 [狀態碼, 是否碰到 DO]。 */
  const upgrade = async (path: string, env: Partial<Env>, ip?: string): Promise<[number, boolean]> => {
    let touchedDo = false;
    const full = {
      ...env,
      RELAY_ROOM: {
        idFromName: () => {
          touchedDo = true;
          return {} as never;
        },
        get: () => ({ fetch: () => new Response(null, { status: 101 }) }),
      },
    } as unknown as Env;
    const headers: Record<string, string> = { Upgrade: "websocket" };
    if (ip !== undefined) headers["CF-Connecting-IP"] = ip;
    const res = await worker.fetch(new Request(`https://${HOST}${path}`, { headers }), full);
    return [res.status, touchedDo];
  };

  it("車道升級超過 IP 限額：429，且**根本不碰 DO**", async () => {
    const { binding, keys } = limiter(false);
    const [status, touchedDo] = await upgrade("/app/testgame", { APP_LANE_LIMIT: binding }, "203.0.113.7");
    expect(status).toBe(429);
    expect(touchedDo).toBe(false);
    expect(keys).toEqual(["203.0.113.7"]); // 以 IP 計數，不是 pubkey——換一把金鑰是微秒級的事
  });

  it("額度內照常升級", async () => {
    const { binding } = limiter(true);
    const [status, touchedDo] = await upgrade("/app/testgame", { APP_LANE_LIMIT: binding }, "203.0.113.7");
    expect(status).toBe(101);
    expect(touchedDo).toBe(true);
  });

  it("🔴 嚴格平面不受此限制——那裡是本專案自己的使用者，且要求 NIP-42", async () => {
    const { binding, keys } = limiter(false);
    for (const path of ["/", "/s/a", "/presence"]) {
      const [status] = await upgrade(path, { APP_LANE_LIMIT: binding }, "203.0.113.7");
      expect(status, path).toBe(101);
    }
    expect(keys).toEqual([]);
  });

  it("沒有 CF-Connecting-IP 就不限——不是把所有人塞進同一個桶", async () => {
    // 該標頭由 Cloudflare 填寫、客戶端偽造不了；缺了代表根本不在 CF 後面，
    // 此時用單一 key 會讓**所有人共用一個額度**，第一個濫用者就把全站擋死。
    const { binding, keys } = limiter(false);
    const [status] = await upgrade("/app/testgame", { APP_LANE_LIMIT: binding });
    expect(status).toBe(101);
    expect(keys).toEqual([]);
  });

  it("沒綁定＝不限速（本地開發與自架站不該因此壞掉）", async () => {
    const [status] = await upgrade("/app/testgame", {}, "203.0.113.7");
    expect(status).toBe(101);
  });

  it("每連線訊息上限觸發時，宿主送出 NOTICE 之後真的把連線關掉", async () => {
    // 用 CLOSE 灌：它不佔訂閱數上限，測的就是「訊息次數」本身。
    const state = new FakeState();
    const room = newRoom(state);
    const ws = await open(room, state, "app");
    for (let i = 0; i < MAX_MESSAGES_PER_MINUTE; i += 1) {
      send(room, ws, ["CLOSE", "s1"]);
      expect(ws.closed, `第 ${i + 1} 則就被關掉了`).toBe(false);
    }
    const out = send(room, ws, ["CLOSE", "s1"]);
    expect((out[0] as string[])[0]).toBe("NOTICE");
    expect(String((out[0] as string[])[1])).toMatch(/rate-limited/);
    expect(ws.closed).toBe(true);
  });
});
