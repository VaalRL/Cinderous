import type { Copy } from "../copy.js";
import { FlowDiagram } from "../FlowDiagram.js";

// 技術原理頁（ADR-0187）：闡述 Cinderous 如何在不信任伺服器的前提下安全送達訊息。
export function Tech({ c }: { c: Copy }): JSX.Element {
  const pillars = [
    { t: c.feat_e2e_t, b: c.feat_e2e_b },
    { t: c.feat_decentral_t, b: c.feat_decentral_b },
    { t: c.feat_local_t, b: c.feat_local_b },
    { t: c.feat_free_t, b: c.feat_free_b },
  ];
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <h2>{c.tech_title}</h2>
        <p className="sec__lead">{c.tech_intro}</p>

        <h2 style={{ fontSize: 22, marginTop: 34 }}>{c.how_title}</h2>
        <p className="sec__lead">{c.how_lead}</p>
        <FlowDiagram c={c} />

        <h2 style={{ fontSize: 22, marginTop: 40 }}>{c.features_title}</h2>
        <div className="grid grid--4">
          {pillars.map((p) => (
            <div className="card" key={p.t}>
              <div className="card__ember" />
              <h3>{p.t}</h3>
              <p>{p.b}</p>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 30 }}>
          <div className="card__ember" />
          <h3>{c.tech_proto_t}</h3>
          <p>{c.tech_proto_b}</p>
        </div>
      </div>
    </section>
  );
}
