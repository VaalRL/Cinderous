// 節點一致性黑箱探測（ADR-0092）：對候選/成員 relay 跑可驗證的**行為**檢查，結果餵給
// core 的 evaluateAdmission 決定分級收錄。只驗行為——relay 內部（是否偷記）技術上無法稽核，
// 系統的隱私防線是結構性的（E2E/TTL），不依賴信任營運者。
//
// I/O 層，模式同 bootstrap/health-check.ts 的 probe/publishEvent（同屬網路探測、非單元測試對象；
// 純決策邏輯 evaluateAdmission 在 @cinder/core 已測）。
import {
  buildAuthEvent,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type NodeConformance,
  type NostrEvent,
  type SecretKey,
} from "@cinder/core";

const TIMEOUT_MS = 8000;
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * 🔴 探測必須先做 NIP-42 AUTH（ADR-0123）。
 *
 * 我們的中繼是 `requireAuth: true`——未認證的 REQ 只會拿到 `["CLOSED", …]` ＋ `["AUTH", 挑戰]`，
 * **永遠不會有 EOSE**。而 `probeLive()` 只在收到 EOSE 才算成功 → 必然逾時 → `live: false`。
 *
 * 也就是說：**每一次 cron，我們自己的中繼站都被自己的健檢判定為「不存活」**，
 * 而那個結果會餵進 `health-check` 的滾動 uptime。這個 bug 一直都在。
 *
 * NIP-42 **不需要身分**——它只證明你掌握某把私鑰。所以探測當場產一把臨時金鑰即可。
 */
function autoAuth(ws: WebSocket, url: string, sk: SecretKey): (m: unknown[]) => void {
  return (m) => {
    if (m[0] === "AUTH" && typeof m[1] === "string") {
      ws.send(JSON.stringify(["AUTH", buildAuthEvent(m[1], url, sk)]));
    }
  };
}

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

/**
 * REQ→EOSE 存活探測（順帶驗對端確為 relay）。
 *
 * 先 AUTH（見 `autoAuth`），且 filter **必須具名**（ADR-0123：無 scope 的 filter 一律被拒）。
 * 用臨時金鑰當 `authors` ——順帶讓語意更精確：舊版的 `{kinds:[1], limit:0}` 其實是在問
 * 「你有任何 kind 1 嗎」，跟存活與否無關。
 */
export function probeLive(url: string): Promise<boolean> {
  const sk = generateSecretKey();
  return withWs(url, false, (ws, done) => {
    const onAuth = autoAuth(ws, url, sk);
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      ws.send(JSON.stringify(["REQ", "live", { kinds: [1], authors: [getPublicKey(sk)], limit: 0 }]));
    };
    // requireAuth 的中繼會先發挑戰；不要求認證的中繼不會 → 兩種都要能走通。
    ws.addEventListener("open", () => setTimeout(ask, 500));
    ws.addEventListener("message", (e) => {
      const m = parse(e.data);
      if (!m) return;
      onAuth(m);
      if (m[0] === "OK" && !asked) ask(); // AUTH 成功 → 立刻問（不必等那 500ms）
      if (m[0] === "EOSE" && m[1] === "live") done(true);
    });
  });
}

/** 送一個事件、等 OK，再 REQ 查它是否被回傳；「未回傳」＝true（符合不留存的期望）。 */
function publishThenAbsent(url: string, event: NostrEvent, filter: object): Promise<boolean> {
  const sk = generateSecretKey();
  return withWs(url, false, (ws, done) => {
    const onAuth = autoAuth(ws, url, sk);
    let sent = false;
    let asked = false;
    const send = () => {
      if (sent) return;
      sent = true;
      ws.send(JSON.stringify(["EVENT", event]));
    };
    ws.addEventListener("open", () => setTimeout(send, 500)); // 不要求認證的中繼：直接送
    ws.addEventListener("message", (e) => {
      const m = parse(e.data);
      if (!m) return;
      onAuth(m);
      if (m[0] === "OK" && m[1] !== event.id && !sent) {
        send(); // AUTH 的 OK → 現在可以送事件了
      } else if (!asked && m[0] === "OK" && m[1] === event.id) {
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
  // filter 必須具名（ADR-0123）：用事件自己的作者——語意也更精確（我在找**我剛送的那顆**）。
  return publishThenAbsent(url, evt, { ids: [evt.id], authors: [evt.pubkey] });
}

/** NIP-40：已過期事件不應被回傳（拒收或不留存皆可）。 */
export function probeRejectsExpired(url: string): Promise<boolean> {
  const evt = finalizeEvent(
    { kind: 1, created_at: nowSec(), tags: [["expiration", String(nowSec() - 3600)]], content: "expired" },
    generateSecretKey(),
  );
  // filter 必須具名（ADR-0123）：用事件自己的作者——語意也更精確（我在找**我剛送的那顆**）。
  return publishThenAbsent(url, evt, { ids: [evt.id], authors: [evt.pubkey] });
}

/** 跑完整一致性套件；uptimePct 由呼叫端（滾動記錄）提供。 */
export async function runConformance(url: string, uptimePct?: number): Promise<NodeConformance> {
  const live = await probeLive(url);
  if (!live) return { live: false, ephemeral: false, rejectsExpired: false, ...(uptimePct !== undefined ? { uptimePct } : {}) };
  const [ephemeral, rejectsExpired] = await Promise.all([probeEphemeralNotStored(url), probeRejectsExpired(url)]);
  return { live, ephemeral, rejectsExpired, ...(uptimePct !== undefined ? { uptimePct } : {}) };
}
