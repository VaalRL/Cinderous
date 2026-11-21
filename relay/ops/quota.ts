// 錨點額度警示（ADR-0427）：查 Cloudflare 免費方案的每日用量，接近上限就提早通知維運者。
//
// 起因：2026-10-22 錨點 1 的 DO 讀取列數在 00–05 UTC 用掉 535 萬列（免費上限 500 萬），
// 之後整天停擺，直到有人發現才知道。用量 Cloudflare 儀表板看得到，但沒有人會每天去看。
//
// 這裡只放純函式（查詢字串、回應解析、判定、報告），真的打 API 在 `quota-watch.ts`。
// 查詢只用唯讀的 Account Analytics 權限，不碰任何事件內容。

/** Workers 免費方案的每日上限（00:00 UTC 重算）與儲存總量。 */
export const FREE_LIMITS = {
  workerRequests: 100_000,
  doRequests: 100_000,
  rowsRead: 5_000_000,
  rowsWritten: 100_000,
  storedBytes: 5_000_000_000,
} as const;

export type QuotaMetric = keyof typeof FREE_LIMITS;

export interface Usage {
  workerRequests: number;
  doRequests: number;
  rowsRead: number;
  rowsWritten: number;
  storedBytes: number;
}

export interface Finding {
  metric: QuotaMetric;
  used: number;
  limit: number;
  ratio: number;
}

const LABEL: Record<QuotaMetric, string> = {
  workerRequests: "Worker 請求",
  doRequests: "DO 請求",
  rowsRead: "DO 讀取列數",
  rowsWritten: "DO 寫入列數",
  storedBytes: "DO 儲存（總量）",
};

/** 一次查四項；別名讓回應形狀固定。 */
export function quotaQuery(): string {
  return `query Quota($account: string!, $date: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workers: workersInvocationsAdaptive(limit: 1, filter: { date_geq: $date, date_leq: $date }) {
        sum { requests }
      }
      doInvocations: durableObjectsInvocationsAdaptiveGroups(limit: 1, filter: { date_geq: $date, date_leq: $date }) {
        sum { requests }
      }
      doPeriodic: durableObjectsPeriodicGroups(limit: 1, filter: { date_geq: $date, date_leq: $date }) {
        sum { rowsRead rowsWritten }
      }
      doStorage: durableObjectsSqlStorageGroups(limit: 100, filter: { date_geq: $date, date_leq: $date }) {
        max { storedBytes }
        dimensions { namespaceId }
      }
    }
  }
}`;
}

export function quotaVars(account: string, date: string): { account: string; date: string } {
  return { account, date };
}

/** 額度以 UTC 日計。 */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

type Num = number | null | undefined;
interface Raw {
  data?: {
    viewer?: {
      accounts?: Array<{
        workers?: Array<{ sum?: { requests?: Num } }>;
        doInvocations?: Array<{ sum?: { requests?: Num } }>;
        doPeriodic?: Array<{ sum?: { rowsRead?: Num; rowsWritten?: Num } }>;
        doStorage?: Array<{ max?: { storedBytes?: Num } }>;
      }>;
    };
  } | null;
  errors?: Array<{ message?: string }> | null;
}

const total = <T>(rows: T[] | undefined, pick: (r: T) => Num): number =>
  (rows ?? []).reduce((n, r) => n + (Number(pick(r)) || 0), 0);

/**
 * 🔴 API 回錯誤或找不到帳號都要丟出來：token 過期時若安靜地當成 0，
 * 這個警示就會在最需要時說「一切正常」。workflow 失敗會寄信給維運者。
 */
export function parseUsage(json: unknown): Usage {
  const raw = json as Raw;
  if (raw?.errors && raw.errors.length > 0) {
    throw new Error(`Cloudflare GraphQL 錯誤：${raw.errors.map((e) => e.message ?? "?").join("; ")}`);
  }
  const acct = raw?.data?.viewer?.accounts?.[0];
  if (!acct) throw new Error("查不到這個 Cloudflare 帳號（account id 錯了，或 token 沒有這個帳號的權限）");
  return {
    workerRequests: total(acct.workers, (r) => r.sum?.requests),
    doRequests: total(acct.doInvocations, (r) => r.sum?.requests),
    rowsRead: total(acct.doPeriodic, (r) => r.sum?.rowsRead),
    rowsWritten: total(acct.doPeriodic, (r) => r.sum?.rowsWritten),
    storedBytes: total(acct.doStorage, (r) => r.max?.storedBytes),
  };
}

/** 到門檻（預設 70%）的項目，最嚴重的排前面。 */
export function evaluateUsage(u: Usage, threshold = 0.7): Finding[] {
  return (Object.keys(FREE_LIMITS) as QuotaMetric[])
    .map((metric) => ({ metric, used: u[metric], limit: FREE_LIMITS[metric], ratio: u[metric] / FREE_LIMITS[metric] }))
    .filter((f) => f.ratio >= threshold)
    .sort((a, b) => b.ratio - a.ratio);
}

/** 一座錨點的 Markdown 報告（issue 內文與 workflow 摘要共用）。 */
export function quotaReport(anchor: string, date: string, u: Usage, findings: Finding[]): string {
  const hot = new Set(findings.map((f) => f.metric));
  const rows = (Object.keys(FREE_LIMITS) as QuotaMetric[]).map((m) => {
    const pct = ((u[m] / FREE_LIMITS[m]) * 100).toFixed(1);
    return `| ${hot.has(m) ? "🔴 " : ""}${LABEL[m]} | ${u[m].toLocaleString("en-US")} | ${FREE_LIMITS[m].toLocaleString("en-US")} | ${pct}% |`;
  });
  return [`### ${anchor}（${date} UTC，到目前為止）`, "", "| 項目 | 用量 | 免費上限 | 比例 |", "| --- | ---: | ---: | ---: |", ...rows, ""].join("\n");
}
