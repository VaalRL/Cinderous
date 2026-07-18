import type { Copy } from "../copy.js";
import { GITHUB_URL } from "../App.js";

export function Node({ c }: { c: Copy }): JSX.Element {
  const steps = [
    { t: c.node_step1_t, b: c.node_step1_b },
    { t: c.node_step2_t, b: c.node_step2_b },
    { t: c.node_step3_t, b: c.node_step3_b },
  ];
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <h2>{c.node_title}</h2>
        <p className="sec__lead">{c.node_intro}</p>

        <h2 style={{ fontSize: 22, marginTop: 34 }}>{c.node_how_t}</h2>
        <p className="sec__lead">{c.node_how_b}</p>
        <div className="steps">
          {steps.map((s, i) => (
            <div className="step" key={s.t}>
              <div className="step__n">{i + 1}</div>
              <div>
                <h3>{s.t}</h3>
                <p>{s.b}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid" style={{ marginTop: 30 }}>
          <div className="card">
            <div className="card__ember" />
            <h3>{c.node_pool_t}</h3>
            <p>{c.node_pool_b}</p>
          </div>
          <div className="card">
            <div className="card__ember" />
            <h3>{c.node_donate_t}</h3>
            <p>{c.node_donate_b}</p>
          </div>
        </div>

        <div className="cta" style={{ justifyContent: "flex-start", marginTop: 26 }}>
          <a className="btn btn--primary" href={`${GITHUB_URL}/blob/main/docs/SELF-HOSTING.md`} target="_blank" rel="noreferrer">
            {c.node_docs}
          </a>
        </div>
      </div>
    </section>
  );
}
