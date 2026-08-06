// 公共 TURN 短期憑證抓取（ADR-0243）：一般使用者的 WebRTC TURN 保底。
//
// Cloudflare TURN 用**短期憑證**（非靜態帳密）——由 relay Worker 的 `/turn` 端點以 secret
// 換發（見 relay/src/worker.ts），餵進 `buildRtcConfig` 既有的 `turnServers`
// （沿用企業 TURN 的注入點，Fix-First 不另闢路徑）。
//
// ## ⓪ 刷新排程必須跟著 TTL（ADR-0342 §2）
//
// 🔴 這個檔頭原本寫「到期前刷新」，但**呼叫端是寫死 6 小時**的，而且回應根本沒有 ttl 欄位
// ——客戶端無從得知憑證多久過期。站方把 TTL 縮短（ADR-0336 §3.1）之後，憑證在客戶端
// 不知情的情況下過期，TURN 形同失效。⇒ Worker 現在會回傳 `ttl`，呼叫端依它排程。
//
// ## 需要簽章（ADR-0342 §3.2）
//
// `/turn` 現在要求 NIP-98 風格的授權標頭，未帶回 **401**。所以這裡要拿到身分金鑰才能抓。
//
// **未設定即 no-op**：Worker 未配 secret 時 `/turn` 回 204 → 這裡回 `[]` → 退回純 STUN，
// 不壞任何東西。任何網路/解析失敗同樣回 `[]`——TURN 只是保底，抓不到不能拖垮通話建立。

import { buildHttpAuthEvent, httpAuthHeader, type SecretKey } from "@cinderous/core";

/** ICE URL 合法 scheme（防端點回應被竄改注入 http/js 之類）。 */
const ICE_SCHEME = /^(stun|turn|turns):/i;

/** 注入用的最小 fetch 介面（避開 DOM/node fetch 型別差異，測試好替身）。 */
export interface TurnHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type TurnFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<TurnHttpResponse>;

/** 抓取結果：伺服器清單＋憑證有效秒數（供呼叫端排程刷新）。 */
export interface TurnResult {
  servers: RTCIceServer[];
  /** Worker 回報的憑證有效秒數；缺席＝舊版 Worker（見 `TURN_TTL_FALLBACK_SEC`）。 */
  ttlSeconds?: number;
}

/**
 * `ttl` 缺席時的退路（ADR-0342 §2）。
 *
 * 舊版 Worker 用的是 86400（1 天），1 小時對它非常安全。**刻意不用更短的值**
 * ——那會在正常情況下浪費請求並吃掉速率限制配額。
 */
export const TURN_TTL_FALLBACK_SEC = 3600;

const defaultFetch: TurnFetch = (url, init) =>
  (globalThis.fetch as unknown as TurnFetch)(url, init);

/**
 * 正規化 Cloudflare `/turn` 回應為 `RTCIceServer[]`。回應的 `iceServers` 可能是單一物件
 * 或陣列；只保留 urls 為合法 ICE scheme 的條目，帳密原樣帶過。任何畸形 → `[]`。
 */
export function parseTurnResponse(json: unknown): RTCIceServer[] {
  if (!json || typeof json !== "object") return [];
  const ice = (json as { iceServers?: unknown }).iceServers;
  const list = Array.isArray(ice) ? ice : ice && typeof ice === "object" ? [ice] : [];
  const out: RTCIceServer[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const rawUrls = (entry as { urls?: unknown }).urls;
    const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls]).filter(
      (u): u is string => typeof u === "string" && ICE_SCHEME.test(u),
    );
    if (urls.length === 0) continue;
    const server: RTCIceServer = { urls };
    const username = (entry as { username?: unknown }).username;
    const credential = (entry as { credential?: unknown }).credential;
    if (typeof username === "string") server.username = username;
    if (typeof credential === "string") server.credential = credential;
    out.push(server);
  }
  return out;
}

/** 取出 Worker 回報的憑證有效秒數（ADR-0342 §2）；缺席或畸形 → undefined。 */
export function parseTurnTtl(json: unknown): number | undefined {
  if (!json || typeof json !== "object") return undefined;
  const ttl = (json as { ttl?: unknown }).ttl;
  return typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : undefined;
}

/**
 * 從 relay 的 `/turn` 端點抓短期 TURN 憑證。任何失敗/未設定 → 空清單（no-op，退回純 STUN）。
 *
 * ⚠ **401 也是空清單**：那代表本端沒帶或帶錯授權（ADR-0342 §3.2）。仍然不報錯——
 * TURN 是保底，拿不到就純 STUN，不該拖垮通話建立。
 */
export async function fetchTurnServers(
  endpoint: string,
  sk: SecretKey,
  fetchFn: TurnFetch = defaultFetch,
): Promise<TurnResult> {
  try {
    const auth = httpAuthHeader(buildHttpAuthEvent(endpoint, "GET", sk));
    const res = await fetchFn(endpoint, { method: "GET", headers: { Authorization: auth } });
    if (res.status === 204 || !res.ok) return { servers: [] }; // 204＝未配 secret；401＝授權問題；其餘＝故障
    const json = await res.json();
    const ttl = parseTurnTtl(json);
    return { servers: parseTurnResponse(json), ...(ttl !== undefined ? { ttlSeconds: ttl } : {}) };
  } catch {
    return { servers: [] }; // 離線/DNS/解析失敗——TURN 是保底，抓不到不拖垮通話
  }
}

/**
 * 下次刷新要等多久（毫秒）。**半個 TTL**，夾在 [60s, 6h]。
 *
 * 下限防止極短 TTL 把客戶端變成打樁機（也會撞上速率限制）；
 * 上限維持舊行為的節奏，避免憑證長效時無謂地常刷。
 */
export function turnRefreshDelayMs(ttlSeconds: number | undefined): number {
  const ttl = ttlSeconds ?? TURN_TTL_FALLBACK_SEC;
  return Math.min(6 * 3600_000, Math.max(60_000, Math.floor((ttl / 2) * 1000)));
}

/** 由 relay URL（`wss://host`）推導其 `/turn` 端點（`https://host/turn`）。非 ws(s) → undefined。 */
export function turnEndpointFromRelay(relayUrl: string | undefined): string | undefined {
  const u = relayUrl?.trim();
  if (!u || !/^wss?:\/\//i.test(u)) return undefined;
  try {
    const parsed = new URL(u);
    const scheme = parsed.protocol.toLowerCase() === "wss:" ? "https:" : "http:";
    return `${scheme}//${parsed.host.toLowerCase()}/turn`;
  } catch {
    return undefined;
  }
}
