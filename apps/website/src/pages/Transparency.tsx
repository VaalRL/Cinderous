import { useEffect, useState } from "react";
import type { NostrEvent } from "@cinderous/core";
import type { Copy } from "../copy.js";
import { type FundsData, runwayMonths, verifyFunds } from "../funds.js";

type State = { status: "loading" } | { status: "fail" } | { status: "ok"; data: FundsData };

export function Transparency({ c }: { c: Copy }): JSX.Element {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // base-aware：專案頁部署於 /Cinderous/，BASE_URL 帶尾斜線（根站時為 "/"）
        const res = await fetch(`${import.meta.env.BASE_URL}funds.json`, { cache: "no-store" });
        const event = (await res.json()) as NostrEvent;
        const data = verifyFunds(event); // 用釘死的透明度公鑰驗簽（fail-closed）
        if (cancelled) return;
        setState(data ? { status: "ok", data } : { status: "fail" });
      } catch {
        if (!cancelled) setState({ status: "fail" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="sec" style={{ borderTop: "none", paddingTop: 32 }}>
      <div className="wrap">
        <h2>{c.tr_title}</h2>
        <p className="hint">{c.tr_intro}</p>

        {state.status === "loading" ? <p className="hint">{c.tr_loading}</p> : null}
        {state.status === "fail" ? <p className="warn">{c.tr_failClosed}</p> : null}

        {state.status === "ok" ? (
          <>
            <p>
              <span className="badge">⚠ {c.tr_placeholderNote}</span>
            </p>
            <div className="runway">
              <div className="hint">{c.tr_runway}</div>
              <div className="runway__big">{formatRunway(runwayMonths(state.data))}</div>
              <div className="hint">{c.tr_months}</div>
              <div className="stat-row">
                <span className="stat">
                  {c.tr_balance}：<b>{money(state.data.balance, state.data.currency)}</b>
                </span>
                <span className="stat">
                  {c.tr_burn}：<b>{money(state.data.monthlyBurn, state.data.currency)}</b>
                </span>
                <span className="stat">
                  {c.tr_updatedAt}：<b>{new Date(state.data.updatedAt).toLocaleString()}</b>
                </span>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                {c.tr_notRealtime}
              </p>
            </div>

            <h2 style={{ fontSize: 20 }}>{c.tr_allocations}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{c.tr_col_period}</th>
                    <th>{c.tr_col_nodeOps}</th>
                    <th>{c.tr_col_bonuses}</th>
                    <th>{c.tr_col_other}</th>
                    <th>{c.tr_col_note}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.allocations.map((a) => (
                    <tr key={a.period}>
                      <td>{a.period}</td>
                      <td>{money(a.nodeOps, state.data.currency)}</td>
                      <td>{money(a.bonuses, state.data.currency)}</td>
                      <td>{money(a.other, state.data.currency)}</td>
                      <td>{a.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function formatRunway(months: number): string {
  if (!isFinite(months)) return "∞";
  return months.toFixed(1);
}
function money(n: number, currency: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}
