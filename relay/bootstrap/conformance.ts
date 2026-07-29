// 節點一致性稽核（ADR-0092）：對候選/成員 relay 跑可驗證的**行為**檢查，結果餵給
// core 的 evaluateAdmission 決定分級收錄。
//
// **探測本體已上移至 `@cinderous/core` 的 `relay-probe.ts`**（ADR-0275）——客戶端也要用同一套
// （使用者自填的 relay 從前沒有被任何一層檢查過行為）。此處轉引，CI 行為不變。
import {
  autoAuth,
  parse,
  probeEphemeralNotStored,
  probeLive,
  probeRejectsExpired,
  withWs,
  type NodeConformance,
} from "@cinderous/core";

// 轉引供既有呼叫端（health-check.ts）沿用原 import 路徑。
export { autoAuth, parse, probeEphemeralNotStored, probeLive, probeRejectsExpired, withWs };

/** 跑完整一致性套件；uptimePct 由呼叫端（滾動記錄）提供。 */
export async function runConformance(url: string, uptimePct?: number): Promise<NodeConformance> {
  const live = await probeLive(url);
  if (!live) return { live: false, ephemeral: false, rejectsExpired: false, ...(uptimePct !== undefined ? { uptimePct } : {}) };
  const [ephemeral, rejectsExpired] = await Promise.all([probeEphemeralNotStored(url), probeRejectsExpired(url)]);
  return { live, ephemeral, rejectsExpired, ...(uptimePct !== undefined ? { uptimePct } : {}) };
}
