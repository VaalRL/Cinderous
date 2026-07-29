// 客戶端 relay 健檢（ADR-0275）：把原本只在 CI 跑的行為稽核下放給客戶端，
// 讓**使用者自填的 relay**（從前沒有被任何一層檢查過行為）也能被檢查。
//
// ## 為什麼不是每次連線都檢查
//
// 主動探測**會寫入事件**（送一顆再查是否還在，見 core `relay-probe.ts`）。每次連線都跑，
// 等於每次開 App 就對 relay 寫兩顆測試事件——流量、對方的反垃圾機制、以及我們自己的
// 免費額度都不划算。因此分三層、依成本決定頻率：
//
// | 層 | 檢查 | 成本 | 頻率 |
// | A | 對方有沒有發 AUTH 挑戰 | **零**（正常連線就看得到） | 永遠 |
// | B | NIP-11 文件 | 一次 HTTP GET | 快取 |
// | C | Ephemeral 語意／NIP-40 過期 | **會寫入事件** | **首次＋快取到期** |
//
// A 層最划算：「這個中繼不要求認證＝任何人都能看到你何時收到訊息」是研究中列出的**最大風險**，
// 而它完全免費。
//
// ## 官方錨點不重複檢查
//
// `relay-health.yml` 每小時已在探測錨點與候選站（ADR-0092）；客戶端再跑一次是純浪費。
//
// ## 結果只提示、不阻擋
//
// 使用者有權選擇連哪座中繼（去中心化本義）；我們的責任是讓他**知情**。

import { probeEphemeralNotStored, probeLive, probeRejectsExpired } from "@cinderous/core";

/** 單座 relay 的檢查結果。 */
export interface RelayCheck {
  /** 檢查時間（ms）。 */
  at: number;
  /** 活著（REQ→EOSE 成功）。 */
  live: boolean;
  /** Ephemeral 語意正確（轉發但不持久化）。 */
  ephemeral: boolean;
  /** 遵守 NIP-40 過期（不回傳已過期事件）。 */
  rejectsExpired: boolean;
  /**
   * 是否要求 NIP-42 AUTH（A 層被動觀察，由連線層回填；`undefined`＝尚未觀察到）。
   *
   * **false 是最重要的警訊**：不要求認證代表任何人都能訂閱 `#p: 你` 的收件匣，
   * 取得你每則訊息的到達時間與訊息量（內容仍加密）。
   */
  requiresAuth?: boolean;
}

/** 檢查結果的重驗週期（ms）：30 天。relay 的行為不會天天變，探測有寫入成本。 */
export const RELAY_CHECK_TTL_MS = 30 * 24 * 3600_000;

/** 快取鍵（裝置層——這是「這座 relay 的性質」，與誰在用無關）。 */
export function relayCheckKey(url: string): string {
  return `nb.relayCheck.${url}`;
}

/** 讀快取；不存在或格式壞回 null。 */
export function loadRelayCheck(url: string): RelayCheck | null {
  try {
    const raw = localStorage.getItem(relayCheckKey(url));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RelayCheck>;
    if (typeof v.at !== "number" || typeof v.live !== "boolean") return null;
    return {
      at: v.at,
      live: v.live,
      ephemeral: v.ephemeral === true,
      rejectsExpired: v.rejectsExpired === true,
      ...(typeof v.requiresAuth === "boolean" ? { requiresAuth: v.requiresAuth } : {}),
    };
  } catch {
    return null;
  }
}

export function saveRelayCheck(url: string, check: RelayCheck): void {
  try {
    localStorage.setItem(relayCheckKey(url), JSON.stringify(check));
  } catch {
    /* 配額／不可用時忽略：檢查是加分項，不該影響通訊 */
  }
}

/**
 * 是否該對這座 relay 跑主動探測（純函式，可測）。
 *
 * - **官方錨點不跑**：CI 每小時已在探測（ADR-0092），客戶端重複是浪費。
 * - 沒有快取＝首次見到這座 relay → 跑（這正是使用者該知道風險的時刻）。
 * - 快取超過 TTL → 重跑。
 */
export function shouldProbe(
  url: string,
  anchors: readonly string[],
  cached: RelayCheck | null,
  now = Date.now(),
): boolean {
  if (anchors.includes(url)) return false;
  if (!cached) return true;
  return now - cached.at > RELAY_CHECK_TTL_MS;
}

/**
 * 跑一次完整行為探測（C 層）。`live` 為 false 時不再跑其餘探測（連不上就沒有行為可測）。
 * 呼叫端負責先以 {@link shouldProbe} 判斷該不該跑。
 */
export async function probeRelay(url: string, now = Date.now()): Promise<RelayCheck> {
  const live = await probeLive(url);
  if (!live) return { at: now, live: false, ephemeral: false, rejectsExpired: false };
  const [ephemeral, rejectsExpired] = await Promise.all([
    probeEphemeralNotStored(url),
    probeRejectsExpired(url),
  ]);
  return { at: now, live, ephemeral, rejectsExpired };
}

/**
 * 首次／過期才探測，並寫回快取；不需探測時回既有快取（可能為 null）。
 * A 層觀察到的 `requiresAuth` 會被保留（探測不覆寫它）。
 */
export async function checkRelayOnce(
  url: string,
  anchors: readonly string[],
  now = Date.now(),
): Promise<RelayCheck | null> {
  const cached = loadRelayCheck(url);
  if (!shouldProbe(url, anchors, cached, now)) return cached;
  const fresh = await probeRelay(url, now);
  const merged: RelayCheck = {
    ...fresh,
    ...(cached?.requiresAuth !== undefined ? { requiresAuth: cached.requiresAuth } : {}),
  };
  saveRelayCheck(url, merged);
  return merged;
}

/**
 * A 層：記錄「這座 relay 是否要求 AUTH」（由連線層在觀察到／未觀察到挑戰時回填）。
 * **零成本**——正常連線就看得到，不需任何探測。
 */
export function recordAuthObservation(url: string, requiresAuth: boolean, now = Date.now()): void {
  const cached = loadRelayCheck(url);
  const next: RelayCheck = cached
    ? { ...cached, requiresAuth }
    : { at: now, live: true, ephemeral: false, rejectsExpired: false, requiresAuth };
  saveRelayCheck(url, next);
}

/** UI 分級（ADR-0275）：只提示、不阻擋。 */
export type RelayGrade = "ok" | "warn" | "down" | "unknown";

/**
 * 由檢查結果得出分級：
 * - `down`：連不上。
 * - `warn`：**不要求 AUTH**（收件匣公開可讀，最嚴重）或 Ephemeral／過期語意不符。
 * - `ok`：全數通過。
 * - `unknown`：尚未檢查（如官方錨點——由 CI 稽核，客戶端不重複）。
 */
export function relayGrade(check: RelayCheck | null): RelayGrade {
  if (!check) return "unknown";
  if (!check.live) return "down";
  if (check.requiresAuth === false) return "warn";
  if (!check.ephemeral || !check.rejectsExpired) return "warn";
  return "ok";
}
