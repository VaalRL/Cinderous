import { describe, expect, it } from "vitest";
import { generateSecretKey, verifyHttpAuth } from "@cinderous/core";
import {
  TURN_TTL_FALLBACK_SEC,
  fetchTurnServers,
  parseTurnResponse,
  parseTurnTtl,
  turnEndpointFromRelay,
  turnRefreshDelayMs,
  type TurnFetch,
} from "./turn-fetch.js";

const SK = generateSecretKey();
const EP = "https://relay.example/turn";

// Cloudflare `/turn` 回應：iceServers 是**單一物件**（urls 陣列＋短期帳密）。
const cfBody = {
  iceServers: {
    urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
    username: "ephemeral-user",
    credential: "ephemeral-pass",
  },
};

function res(status: number, body?: unknown): ReturnType<TurnFetch> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(body)),
  });
}

describe("parseTurnResponse（正規化 Cloudflare TURN 回應，ADR-0243）", () => {
  it("單一 iceServers 物件 → RTCIceServer[]（帶帳密）", () => {
    expect(parseTurnResponse(cfBody)).toEqual([
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
        username: "ephemeral-user",
        credential: "ephemeral-pass",
      },
    ]);
  });

  it("iceServers 為陣列亦可（多筆）", () => {
    const arr = { iceServers: [{ urls: "turn:a:3478", username: "u", credential: "p" }, { urls: "stun:b:3478" }] };
    expect(parseTurnResponse(arr)).toEqual([
      { urls: ["turn:a:3478"], username: "u", credential: "p" },
      { urls: ["stun:b:3478"] },
    ]);
  });

  it("過濾非 ICE scheme 的 url（防端點回傳被竄改注入 http 等）", () => {
    const bad = { iceServers: { urls: ["http://evil.example/x", "turn:ok:3478"], username: "u", credential: "p" } };
    expect(parseTurnResponse(bad)).toEqual([{ urls: ["turn:ok:3478"], username: "u", credential: "p" }]);
  });

  it("全部 url 皆非法 → 丟棄該筆", () => {
    expect(parseTurnResponse({ iceServers: { urls: ["http://evil"], username: "u", credential: "p" } })).toEqual([]);
  });

  it("空 / 畸形輸入 → []（no-op）", () => {
    expect(parseTurnResponse(null)).toEqual([]);
    expect(parseTurnResponse(undefined)).toEqual([]);
    expect(parseTurnResponse({})).toEqual([]);
    expect(parseTurnResponse({ iceServers: null })).toEqual([]);
    expect(parseTurnResponse("nope")).toEqual([]);
  });
});

describe("fetchTurnServers（抓短期憑證，失敗一律 no-op）", () => {
  it("200＋合法 body → 伺服器清單", async () => {
    const { servers } = await fetchTurnServers(EP, SK, () => res(200, cfBody));
    expect(servers).toHaveLength(1);
    expect(servers[0]?.username).toBe("ephemeral-user");
  });

  it("204（Worker 未配 secret）→ 空清單（退回純 STUN）", async () => {
    expect((await fetchTurnServers(EP, SK, () => res(204))).servers).toEqual([]);
  });

  it("🔴 401（沒帶/帶錯授權）→ 空清單，不報錯（ADR-0342 §3.2）", async () => {
    // TURN 是保底，拿不到就純 STUN，不該拖垮通話建立。
    expect((await fetchTurnServers(EP, SK, () => res(401))).servers).toEqual([]);
  });

  it("非 2xx → 空清單", async () => {
    expect((await fetchTurnServers(EP, SK, () => res(500, {}))).servers).toEqual([]);
  });

  it("fetch 拋（離線/DNS 失敗）→ 空清單", async () => {
    expect((await fetchTurnServers(EP, SK, () => Promise.reject(new Error("offline")))).servers).toEqual([]);
  });

  it("body 非 JSON（json() 拋）→ 空清單", async () => {
    expect((await fetchTurnServers(EP, SK, () => res(200))).servers).toEqual([]);
  });

  it("🔴 帶上可被 relay 驗證的授權標頭，且綁定的是這個端點", async () => {
    let auth: string | undefined;
    await fetchTurnServers(EP, SK, (_u, init) => {
      auth = init?.headers?.Authorization;
      return res(200, cfBody);
    });
    expect(verifyHttpAuth(auth ?? null, EP, "GET")).not.toBeNull();
    // 對別的端點驗不過——證明簽的是這個 URL 而不是隨便一個。
    expect(verifyHttpAuth(auth ?? null, "https://other.example/turn", "GET")).toBeNull();
  });

  it("⓪ 回應帶 ttl → 一併回傳（ADR-0342 §2）", async () => {
    const r = await fetchTurnServers(EP, SK, () => res(200, { ...cfBody, ttl: 300 }));
    expect(r.ttlSeconds).toBe(300);
  });

  it("⓪ 回應沒有 ttl（舊版 Worker）→ undefined，由排程套用退路", async () => {
    const r = await fetchTurnServers(EP, SK, () => res(200, cfBody));
    expect(r.ttlSeconds).toBeUndefined();
  });
});

describe("⓪ 刷新排程跟著 TTL（ADR-0342 §2）", () => {
  it("parseTurnTtl 只收正整數，其餘一律 undefined", () => {
    expect(parseTurnTtl({ ttl: 300 })).toBe(300);
    expect(parseTurnTtl({ ttl: 300.7 })).toBe(300);
    for (const bad of [{ ttl: 0 }, { ttl: -1 }, { ttl: "300" }, { ttl: NaN }, {}, null, "x"]) {
      expect(parseTurnTtl(bad)).toBeUndefined();
    }
  });

  it("🔴 半個 TTL——這正是先前寫死 6 小時所缺的", () => {
    expect(turnRefreshDelayMs(600)).toBe(300_000);
    expect(turnRefreshDelayMs(7200)).toBe(3600_000);
  });

  it("🔴 TTL 300（站方現行設定）→ 2.5 分鐘刷新一次，而不是 6 小時", () => {
    // 舊行為（6h）會讓 5 分鐘就過期的憑證在客戶端不知情下失效，TURN 形同不存在。
    expect(turnRefreshDelayMs(300)).toBe(150_000);
  });

  it("下限 60 秒——極短 TTL 不得把客戶端變成打樁機（也會撞速率限制）", () => {
    expect(turnRefreshDelayMs(10)).toBe(60_000);
    expect(turnRefreshDelayMs(1)).toBe(60_000);
  });

  it("上限 6 小時——憑證長效時不必無謂常刷", () => {
    expect(turnRefreshDelayMs(86400)).toBe(6 * 3600_000);
  });

  it("ttl 缺席 → 退回預設（對舊版 Worker 的 86400 很安全）", () => {
    expect(turnRefreshDelayMs(undefined)).toBe((TURN_TTL_FALLBACK_SEC / 2) * 1000);
  });
});

describe("turnEndpointFromRelay（由 relay URL 推導 /turn 端點）", () => {
  it("wss → https、ws → http，補 /turn", () => {
    expect(turnEndpointFromRelay("wss://cinder-relay.example.workers.dev")).toBe(
      "https://cinder-relay.example.workers.dev/turn",
    );
    expect(turnEndpointFromRelay("ws://localhost:8787")).toBe("http://localhost:8787/turn");
  });

  it("忽略尾斜線與路徑，只取 host", () => {
    expect(turnEndpointFromRelay("wss://relay.example/")).toBe("https://relay.example/turn");
  });

  it("非法/空 → undefined", () => {
    expect(turnEndpointFromRelay(undefined)).toBeUndefined();
    expect(turnEndpointFromRelay("http://not-ws")).toBeUndefined();
    expect(turnEndpointFromRelay("")).toBeUndefined();
  });
});
