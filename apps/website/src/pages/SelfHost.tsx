// 自架完整教學（ADR-0357）。
//
// ## 🔴 這一頁只教學、不動作
//
// ADR-0090 的硬隔離鐵則：官網與 E2E 通訊平面完全分離，永不接觸使用者資料、金鑰或 npub，
// 零追蹤零 cookie。所以這裡**不收 token、沒有任何會回傳的表單、不做部署動作**。
//
// 直接後果：本頁**無法**告訴使用者「你部署成功了」——那需要一個回呼，而回呼就是狀態。
// 因此教學改為教他**自己怎麼確認**（`/healthz`，ADR-0354）。這不是缺漏，是鐵則的代價。
//
// 「Deploy to Cloudflare」按鈕是**純外連**：點下去之後的事全部發生在使用者與 Cloudflare
// 之間，官網不知道、也不該知道結果。

import type { Copy } from "../copy.js";
import type { Locale } from "@cinderous/i18n";
import { GITHUB_URL } from "../App.js";

/** Cloudflare 的計價頁——費用條件會變，我們導向它而不是自己下結論（ADR-0357 §4）。 */
const CF_PRICING = "https://developers.cloudflare.com/workers/platform/pricing/";

export function SelfHost({ c, locale }: { c: Copy; locale: Locale }): JSX.Element {
  const routes = [
    { name: c.sh_r1, level: c.sh_r1_level, time: c.sh_r1_time, who: c.sh_r1_who },
    { name: c.sh_r2, level: c.sh_r2_level, time: c.sh_r2_time, who: c.sh_r2_who },
    { name: c.sh_r3, level: c.sh_r3_level, time: c.sh_r3_time, who: c.sh_r3_who },
  ];
  const steps = [c.sh_a_s1, c.sh_a_s2, c.sh_a_s3, c.sh_a_s4, c.sh_a_s5];
  const errors = [
    { t: c.sh_err1_t, b: c.sh_err1_b },
    { t: c.sh_err2_t, b: c.sh_err2_b },
    { t: c.sh_err3_t, b: c.sh_err3_b },
    { t: c.sh_err4_t, b: c.sh_err4_b },
  ];
  const limits = [c.sh_limit1, c.sh_limit2, c.sh_limit3];
  const docs = locale === "zh-Hant" ? "docs/SELF-HOSTING.md" : "docs/SELF-HOSTING.en.md";

  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }} data-testid="selfhost">
      <div className="wrap">
        <h2>{c.sh_title}</h2>
        <p className="sec__lead">{c.sh_lead}</p>

        <h3 style={{ marginTop: 30 }}>{c.sh_getTitle}</h3>
        <p>{c.sh_getBody}</p>

        <h3 style={{ marginTop: 30 }}>{c.sh_pickTitle}</h3>
        <table className="cmp" data-testid="sh-routes">
          <thead>
            <tr>
              <th>{c.sh_col_route}</th>
              <th>{c.sh_col_level}</th>
              <th>{c.sh_col_time}</th>
              <th>{c.sh_col_who}</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.level}</td>
                <td>{r.time}</td>
                <td>{r.who}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ marginTop: 34 }}>{c.sh_a_title}</h3>
        <div className="steps" data-testid="sh-route-app">
          {steps.map((body, i) => (
            <div className="step" key={body}>
              <div className="step__n">{i + 1}</div>
              <div>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 34 }}>{c.sh_b_title}</h3>
        <p>{c.sh_b_body}</p>
        {/* 🔴 這兩個限制不寫出來，使用者會以為它跟路線一一樣，然後卡在「然後呢」。 */}
        <p className="sec__lead" data-testid="sh-deploy-warn">
          {c.sh_b_warn}
        </p>

        <h3 style={{ marginTop: 34 }}>{c.sh_c_title}</h3>
        <p>{c.sh_c_body}</p>
        {/* 指令一律 npx：pnpm 10 擋建置腳本，`pnpm dlx wrangler` 會以 ERR_PNPM_IGNORED_BUILDS 中止。 */}
        <pre className="code" data-testid="sh-commands">
          <code>
            {[
              "git clone " + GITHUB_URL + " cinder && cd cinder",
              "pnpm install",
              "cd relay",
              "npx --yes wrangler@4 login",
              "pnpm run deploy",
            ].join("\n")}
          </code>
        </pre>
        <p className="sec__lead">{c.sh_c_unified}</p>
        <pre className="code" data-testid="sh-commands-unified">
          <code>pnpm run deploy:unified</code>
        </pre>

        <h3 style={{ marginTop: 34 }}>{c.sh_cost_title}</h3>
        <p>{c.sh_cost_body}</p>
        <div className="cta" style={{ justifyContent: "flex-start", marginTop: 14 }}>
          <a className="btn" href={CF_PRICING} target="_blank" rel="noreferrer">
            {c.sh_cost_link}
          </a>
        </div>

        <h3 style={{ marginTop: 34 }}>{c.sh_after_title}</h3>
        <p>{c.sh_after_body}</p>

        <h3 style={{ marginTop: 34 }}>{c.sh_err_title}</h3>
        <div className="grid" data-testid="sh-errors">
          {errors.map((e) => (
            <div className="card" key={e.t}>
              <div className="card__ember" />
              <h3>{e.t}</h3>
              <p>{e.b}</p>
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 34 }}>{c.sh_limits_title}</h3>
        <ul data-testid="sh-limits">
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>

        <div className="cta" style={{ justifyContent: "flex-start", marginTop: 26 }}>
          <a className="btn btn--primary" href={`${GITHUB_URL}/blob/main/${docs}`} target="_blank" rel="noreferrer">
            {c.sh_docs}
          </a>
        </div>
      </div>
    </section>
  );
}
