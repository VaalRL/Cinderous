// 限時訊息的重繪時鐘（ADR-0406）：在下一則訊息到期的那一刻更新 `now`，讓畫面自己換成「訊息已到期」。
//
// 桌面是每秒掃一次（App.tsx）；手機只排**一個**計時器到最近的到期時刻——沒有限時訊息就完全不跑，
// 省電。到期判斷本身用 engine 的 `isExpired`，與桌面同一個定義。
import { nextExpiryAt } from "@cinderous/engine";
import { useEffect, useState } from "react";

/** setTimeout 能排的最長延遲（約 24.8 天）；更遠的到期時刻先排到這裡，醒來再排下一段。 */
const MAX_DELAY = 2 ** 31 - 1;

export function useExpiryClock(msgs: Iterable<{ expiresAt?: number }>): number {
  const [now, setNow] = useState(() => Date.now());
  const next = nextExpiryAt(msgs, now);
  useEffect(() => {
    if (next === undefined) return;
    // +50ms：計時器可能早一點點醒，醒來時要確定已經過了到期時刻。
    const id = setTimeout(() => setNow(Date.now()), Math.min(Math.max(next - Date.now(), 0) + 50, MAX_DELAY));
    return () => clearTimeout(id);
  }, [next]);
  return now;
}
