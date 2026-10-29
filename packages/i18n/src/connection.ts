// 連線列文案（ADR-0395）：桌面與行動端共用，避免兩邊各寫一套判斷。
import { translate } from "./index.js";
import type { Locale } from "./messages.js";

type ConnState = "connecting" | "online" | "offline";

/** 與 `@cinderous/engine` 的 `RelayUnavailable` 同形（i18n 不依賴引擎，只取用得到的欄位）。 */
export interface RelayUnavailableInfo {
  kind: "over-quota" | "unavailable" | "edge";
  retryAt: number;
  resetsAt?: number;
}

/**
 * 收到新的連線狀態之後，畫面該記著的「暫時不能用」原因。
 * 重試中（`connecting`）沿用上一次的原因——否則每 5 分鐘一次的重試會讓原因閃掉一下；
 * 真的上線、或一般斷線（沒帶原因）才清掉。
 */
export function nextRelayUnavailable(
  prev: RelayUnavailableInfo | undefined,
  state: ConnState,
  unavailable: RelayUnavailableInfo | undefined,
): RelayUnavailableInfo | undefined {
  return state === "connecting" ? (unavailable ?? prev) : unavailable;
}

/** 連線列的文字（只在非 online 時顯示）。`timeZone` 只給測試用；預設是裝置的時區。 */
export function connectionBannerText(
  locale: Locale | string,
  state: Exclude<ConnState, "online">,
  unavailable: RelayUnavailableInfo | undefined,
  timeZone?: string,
): string {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) });
  if (unavailable?.kind === "over-quota" && unavailable.resetsAt !== undefined) {
    return translate(locale, "conn_overQuota", { time: at(unavailable.resetsAt) });
  }
  if (unavailable?.kind === "edge" && unavailable.resetsAt !== undefined) {
    return translate(locale, "conn_edge", { time: at(unavailable.resetsAt) });
  }
  if (unavailable) return translate(locale, "conn_unavailable", { time: at(unavailable.retryAt) });
  return translate(locale, state === "connecting" ? "conn_connecting" : "conn_offline");
}
