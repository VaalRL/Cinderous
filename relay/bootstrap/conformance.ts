// 節點一致性黑箱探測（ADR-0092）：對候選/成員 relay 跑可驗證的**行為**檢查，結果餵給
// core 的 evaluateAdmission 決定分級收錄。只驗行為——relay 內部（是否偷記）技術上無法稽核，
// 系統的隱私防線是結構性的（E2E/TTL），不依賴信任營運者。
//
// I/O 層，模式同 bootstrap/health-check.ts 的 probe/publishEvent（同屬網路探測、非單元測試對象；
// 純決策邏輯 evaluateAdmission 在 @cinder/core 已測）。
import { finalizeEvent, generateSecretKey, type NodeConformance, type NostrEvent } from "@cinder/core";

const TIMEOUT_MS = 8000;
const nowSec = () => Math.floor(Date.now() / 1000);

/** 開 WS 跑一段互動，統一逾時/清理；逾時或錯誤回 fallback。 */
function withWs<T>(url: string, fallback: T, run: (ws: WebSocket, done: (v: T) => void) => void): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    const done = (v: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(fallback), TIMEOUT_MS);
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve(fallback);
      return;
    }
    ws.addEventListener("error", () => done(fallback));
    ws.addEventListener("close", () => done(fallback));
    run(ws, done);
  });
}

function parse(data: unknown): unknown[] | null {
  try {
    const m = JSON.parse(typeof data === "string" ? data : "");
    return Array.isArray(m) ? m : null;
  } catch {
    return null;
  }
}

/** REQ→EOSE 存活探測（順帶驗對端確為 relay）。 */
export function probeLive(url: string): Promise<boolean> {
  return withWs(url, false, (ws, done) => {
    ws.addEventListener("open", () => ws.send(JSON.stringify(["REQ", "live", { kinds: [1], limit: 0 }])));
    ws.addEventListener("message", (e) => {
      const m = parse(e.data);
      if (m && m[0] === "EOSE" && m[1] === "live") done(true);
    });
  });
}

/** 送一個事件、等 OK，再 REQ 查它是否被回傳；「未回傳」＝true（符合不留存的期望）。 */
function publishThenAbsent(url: string, event: NostrEvent, filter: object): Promise<boolean> {
  return withWs(url, false, (ws, done) => {
    let asked = false;
    ws.addEventListener("open", () => ws.send(JSON.stringify(["EVENT", event])));
    ws.addEventListener("message", (e) => {
      const m = parse(e.data);
      if (!m) return;
      if (!asked && m[0] === "OK" && m[1] === event.id) {
        asked = true;
        ws.send(JSON.stringify(["REQ", "conf", filter]));
      } else if (asked && m[0] === "EVENT" && (m[2] as { id?: string })?.id === event.id) {
        done(false); // 竟被回傳 → 有留存 → 不符
      } else if (asked && m[0] === "EOSE") {
        done(true); // 查完沒回傳該事件 → 未留存 → 符合
      }
    });
  });
}

/** Ephemeral（kind 20000–29999）語意：轉發但不持久化——事後查不到。 */
export function probeEphemeralNotStored(url: string): Promise<boolean> {
  const evt = finalizeEvent({ kind: 20099, created_at: nowSec(), tags: [], content: "conformance" }, generateSecretKey());
  return publishThenAbsent(url, evt, { ids: [evt.id] });
}

/** NIP-40：已過期事件不應被回傳（拒收或不留存皆可）。 */
export function probeRejectsExpired(url: string): Promise<boolean> {
  const evt = finalizeEvent(
    { kind: 1, created_at: nowSec(), tags: [["expiration", String(nowSec() - 3600)]], content: "expired" },
    generateSecretKey(),
  );
  return publishThenAbsent(url, evt, { ids: [evt.id] });
}

/** 跑完整一致性套件；uptimePct 由呼叫端（滾動記錄）提供。 */
export async function runConformance(url: string, uptimePct?: number): Promise<NodeConformance> {
  const live = await probeLive(url);
  if (!live) return { live: false, ephemeral: false, rejectsExpired: false, ...(uptimePct !== undefined ? { uptimePct } : {}) };
  const [ephemeral, rejectsExpired] = await Promise.all([probeEphemeralNotStored(url), probeRejectsExpired(url)]);
  return { live, ephemeral, rejectsExpired, ...(uptimePct !== undefined ? { uptimePct } : {}) };
}
