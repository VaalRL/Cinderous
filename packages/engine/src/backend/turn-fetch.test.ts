import { describe, expect, it } from "vitest";
import { fetchTurnServers, parseTurnResponse, turnEndpointFromRelay, type TurnFetch } from "./turn-fetch.js";

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
    const servers = await fetchTurnServers("https://relay.example/turn", () => res(200, cfBody));
    expect(servers).toHaveLength(1);
    expect(servers[0]?.username).toBe("ephemeral-user");
  });

  it("204（Worker 未配 secret）→ []（退回純 STUN）", async () => {
    expect(await fetchTurnServers("https://relay.example/turn", () => res(204))).toEqual([]);
  });

  it("非 2xx → []", async () => {
    expect(await fetchTurnServers("https://relay.example/turn", () => res(500, {}))).toEqual([]);
  });

  it("fetch 拋（離線/DNS 失敗）→ []", async () => {
    expect(await fetchTurnServers("https://relay.example/turn", () => Promise.reject(new Error("offline")))).toEqual([]);
  });

  it("body 非 JSON（json() 拋）→ []", async () => {
    expect(await fetchTurnServers("https://relay.example/turn", () => res(200))).toEqual([]);
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
