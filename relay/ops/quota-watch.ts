// 錨點額度警示的執行端（ADR-0427）：`.github/workflows/quota-watch.yml` 每 3 小時跑一次。
//
// 環境變數（GitHub secrets）：每座錨點一組 `CF_QUOTA_<n>_ACCOUNT`＋`CF_QUOTA_<n>_TOKEN`（n＝1, 2, …），
// token 只需要 **Account Analytics: Read**。兩座錨點在不同 Cloudflare 帳號，所以各一把。
//
// 輸出：
//   - stdout／`--out <檔案>`：全部錨點的 Markdown 報告（issue 內文用）
//   - `$GITHUB_OUTPUT` 的 `alert=true|false`
// 任何一座查詢失敗＝結束碼 1（workflow 變紅、GitHub 寄信）——查不到不能當成沒事。
import { appendFileSync, writeFileSync } from "node:fs";
import { evaluateUsage, parseUsage, quotaQuery, quotaReport, quotaVars, utcDate } from "./quota.js";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

interface Anchor {
  name: string;
  account: string;
  token: string;
}

function anchorsFromEnv(env: NodeJS.ProcessEnv): Anchor[] {
  const out: Anchor[] = [];
  for (let n = 1; n <= 9; n++) {
    const account = env[`CF_QUOTA_${n}_ACCOUNT`];
    const token = env[`CF_QUOTA_${n}_TOKEN`];
    if (!account && !token) continue;
    if (!account || !token) throw new Error(`錨點 ${n} 的 CF_QUOTA_${n}_ACCOUNT／CF_QUOTA_${n}_TOKEN 只設了一個`);
    out.push({ name: `錨點 ${n}`, account, token });
  }
  if (out.length === 0) throw new Error("沒有設定任何錨點（CF_QUOTA_1_ACCOUNT／CF_QUOTA_1_TOKEN）");
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const threshold = Number(process.env.QUOTA_THRESHOLD ?? "0.7");
  const date = utcDate(new Date());

  const sections: string[] = [];
  let alert = false;
  let failed = false;
  for (const a of anchorsFromEnv(process.env)) {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ query: quotaQuery(), variables: quotaVars(a.account, date) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const usage = parseUsage(await res.json());
      const findings = evaluateUsage(usage, threshold);
      if (findings.length > 0) alert = true;
      sections.push(quotaReport(a.name, date, usage, findings));
    } catch (e) {
      failed = true;
      // 訊息裡不會有 token（token 只在請求標頭）
      sections.push(`### ${a.name}\n\n查詢失敗：${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  const md = [`門檻：免費額度的 ${Math.round(threshold * 100)}%。額度每天 00:00 UTC 重算。`, "", ...sections].join("\n");
  console.log(md);
  if (outFile) writeFileSync(outFile, md);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `alert=${alert}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  if (failed) process.exit(1);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
