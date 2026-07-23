// 公共 TURN 短期憑證抓取（ADR-0243）：一般使用者的 WebRTC TURN 保底。
//
// Cloudflare TURN 用**短期憑證**（非靜態帳密）——由 relay Worker 的 `/turn` 端點以 secret
// 換發（見 relay/src/worker.ts）。客戶端於開機抓一次、快取、到期前刷新，餵進 `buildRtcConfig`
// 既有的 `turnServers`（沿用企業 TURN 的注入點，Fix-First 不另闢路徑）。
//
// **未設定即 no-op**：Worker 未配 secret 時 `/turn` 回 204 → 這裡回 `[]` → 退回純 STUN，
// 不壞任何東西。任何網路/解析失敗同樣回 `[]`——TURN 只是保底，抓不到不能拖垮通話建立。

/** ICE URL 合法 scheme（防端點回應被竄改注入 http/js 之類）。 */
const ICE_SCHEME = /^(stun|turn|turns):/i;

/** 注入用的最小 fetch 介面（避開 DOM/node fetch 型別差異，測試好替身）。 */
export interface TurnHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type TurnFetch = (url: string, init?: { method?: string }) => Promise<TurnHttpResponse>;

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

/** 從 relay 的 `/turn` 端點抓短期 TURN 憑證。任何失敗/未設定 → `[]`（no-op，退回純 STUN）。 */
export async function fetchTurnServers(endpoint: string, fetchFn: TurnFetch = defaultFetch): Promise<RTCIceServer[]> {
  try {
    const res = await fetchFn(endpoint, { method: "GET" });
    if (res.status === 204 || !res.ok) return []; // 204＝Worker 未配 secret；非 2xx＝故障——皆 no-op
    return parseTurnResponse(await res.json());
  } catch {
    return []; // 離線/DNS/解析失敗——TURN 是保底，抓不到不拖垮通話
  }
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
