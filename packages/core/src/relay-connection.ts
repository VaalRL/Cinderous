// 一條中繼連線＝一個只有這一座的 SDK RelayPool（ADR-0398、ADR-0400）。
//
// 正式環境（engine `webSocketConnector`）與記憶體測試網路（relay `createInMemoryRelayNetwork`）共用這一份：
// 測試走的路就是正式環境的路，SDK 的重連、NIP-42、補訂閱、驗簽去重在測試裡一樣成立。
import { RelayPool, type SocketLike } from "@cinderous/client";
import type { NostrEvent } from "./event.js";
import type { Filter } from "./presence.js";
import type { RelayClientHandlers } from "./relay-client.js";

export type { SocketLike } from "@cinderous/client";

/** 一條連線的狀態（供顯示連線/重連中）。 */
export type RelayConnectionState = "connecting" | "online" | "offline";

/**
 * 中繼以 1013 關閉＝這座暫時不能用（ADR-0395；SDK ADR 0097、0108）。
 * - `over-quota`：今天的額度用完，`resetsAt` 是下一個 00:00 UTC（Cloudflare 的每日額度重置時間）；
 * - `unavailable`：其他暫時的錯誤（儲存起不來、連線數滿了…）。
 * `retryAt` 是下一次重連的時間。
 */
export interface RelayUnavailable {
  kind: "over-quota" | "unavailable";
  retryAt: number;
  resetsAt?: number;
}

/**
 * 引擎對一條中繼連線的要求（ADR-0398）。
 *
 * - `publish`：即發即忘，結果經 `handlers.onOk` 回來（只有中繼真的回答了才回）。
 * - `subscribe`：同一個 `subId` 再訂一次＝換掉那個訂閱。
 */
export interface RelayConnection {
  publish(event: NostrEvent): void;
  subscribe(subId: string, filters: Filter[]): void;
  unsubscribe(subId: string): void;
  /** 停止重連並斷線（清除 hint、單次連線用完時釋放） */
  close?(): void;
}

export interface ConnectRelayOptions {
  /** 預設 `new WebSocket(url)`；記憶體測試網路注入自己的 socket（ADR-0400） */
  readonly createSocket?: (url: string) => SocketLike;
}

/**
 * 連上之後多久沒被關就算上線（ADR-0395）。中繼拒絕時是先**接受**升級、送 NOTICE、再關閉（ADR-0368／0387），
 * 所以 `open` 不等於上線。中繼先開口要求認證（AUTH 挑戰）就立刻算，不必等。
 */
const ONLINE_SETTLE_MS = 1000;
/**
 * 等中繼回 OK 最多多久（ADR-0398）：與外送匣的在途時間（`inflightTtlMs`）相同。SDK 預設 5 秒，
 * 比這短的話，晚到的 OK 會被丟掉，外送匣就分不出「收下了」與「沒消息」。
 */
const OK_WAIT_MS = 30_000;

/** 下一個 00:00 UTC——Cloudflare 每日額度的重置時間（SDK ADR 0097 的 NOTICE 也這樣說）。 */
function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * 這次發布 SDK 給的結果裡，中繼有沒有真的回答（ADR-0398）。`timeout`／`not connected`／`disconnected…` 是本機看到的，
 * 不轉給外送匣：舊版收不到 OK 時也什麼都不回，外送匣靠重連補送與在途逾時處理（ADR-0041）。
 */
function relayAnswered(reason: string): boolean {
  return reason !== "timeout" && reason !== "not connected" && !reason.startsWith("disconnected");
}

/**
 * 連上一座中繼（ADR-0398）：重連退避、1013 的冷卻、NIP-42、認證前被拒的重送、補訂閱（游標與禮物包的回溯窗）、
 * 驗簽與去重都由 SDK 負責；這裡只把它轉成 {@link RelayConnection} 與連線狀態。
 */
export function connectRelay(
  url: string,
  handlers: RelayClientHandlers,
  onStatus?: (state: RelayConnectionState, unavailable?: RelayUnavailable) => void,
  options: ConnectRelayOptions = {},
): RelayConnection {
  /** 這條連線算上線了沒（ADR-0395）：`open` 之後，中繼要求認證或撐過 {@link ONLINE_SETTLE_MS}。 */
  let online = false;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  /** 這次斷線的原因（1013）：SDK 先改狀態、同一個 tick 稍後才回報拒收，所以離線晚一個微任務才報 */
  let unavailable: RelayUnavailable | undefined;
  /** 還沒連上時的發布：連上再送（與舊版相同；可靠訊息另有外送匣補送） */
  let pending: NostrEvent[] = [];
  const subs = new Map<string, { key: string; sub: { close(): void } }>();

  const isOpen = () => pool.status().get(url) === "open";
  const goOnline = () => {
    if (online || stopped || !isOpen()) return;
    online = true;
    clearTimeout(settle);
    onStatus?.("online");
  };
  const authSigner = handlers.authSigner;
  const pool = new RelayPool({
    urls: [url],
    publishTimeoutMs: OK_WAIT_MS,
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
    // NIP-42：SDK 組好 kind 22242 的範本，簽章交給呼叫端（各連線用的金鑰不同：身分、配對房間、一次性查詢）
    ...(authSigner
      ? {
          identity: {
            sign: (template: { tags: string[][] }) => {
              goOnline(); // 中繼開口要求認證＝這座能服務（先報上線，與舊版的順序相同）
              const challenge = template.tags.find((t) => t[0] === "challenge")?.[1] ?? "";
              return authSigner(challenge) as never;
            },
          },
        }
      : {}),
    onRelayReject: (_url, rejection) => {
      if (rejection.source !== "close" || rejection.kind !== "unavailable") return;
      // 1013：這座暫時不能用（ADR-0395）——說出原因；重連時間以 SDK 的健康標記為準
      const now = Date.now();
      const mark = pool.relayHealth().get(url)?.marks.find((m) => m.kind === "unavailable");
      const overQuota = /^over quota/i.test(rejection.reason);
      unavailable = {
        kind: overQuota ? "over-quota" : "unavailable",
        retryAt: mark?.until ?? now,
        ...(overQuota ? { resetsAt: nextUtcMidnight(now) } : {}),
      };
    },
    ...(handlers.onNotice ? { onRelayProblem: (_url: string, reason: string) => handlers.onNotice?.(reason) } : {}),
  });

  const send = (event: NostrEvent) => {
    void pool.publish(event as never).then((result) => {
      if (stopped) return;
      if (result.accepted.includes(url)) {
        handlers.onOk?.(event.id, true, "");
        return;
      }
      const rejected = result.rejected.find((r) => r.url === url);
      if (rejected && relayAnswered(rejected.reason)) handlers.onOk?.(event.id, false, rejected.reason);
    });
  };

  pool.onStatusChange((_url, status) => {
    if (stopped) return;
    if (status === "connecting") {
      onStatus?.("connecting");
    } else if (status === "open") {
      settle = setTimeout(goOnline, ONLINE_SETTLE_MS);
      const queued = pending;
      pending = [];
      for (const event of queued) send(event);
    } else {
      online = false;
      clearTimeout(settle);
      queueMicrotask(() => {
        if (stopped) return;
        const reason = unavailable;
        unavailable = undefined;
        onStatus?.("offline", reason);
      });
    }
  });

  const connection: RelayConnection = {
    publish: (event) => {
      if (isOpen()) send(event);
      else pending.push(event);
    },
    subscribe: (subId, filters) => {
      const key = JSON.stringify(filters);
      const current = subs.get(subId);
      if (current?.key === key) return; // 引擎每次上線都會重訂；SDK 已經自己補送過了
      current?.sub.close();
      subs.delete(subId);
      if (filters.length === 0) return;
      const sub = pool.subscribe(filters as never, {
        onEvent: (event) => handlers.onEvent?.(subId, event as unknown as NostrEvent),
        onEose: () => handlers.onEose?.(subId),
      });
      subs.set(subId, { key, sub });
    },
    unsubscribe: (subId) => {
      subs.get(subId)?.sub.close();
      subs.delete(subId);
    },
    close: () => {
      stopped = true;
      clearTimeout(settle);
      pool.close();
    },
  };
  pool.connect();
  return connection;
}
