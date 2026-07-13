import type { Theme } from "@cinder/theme";
import type { Copy } from "../copy.js";
import { CinderMark } from "../Brand.js";
import { FlowDiagram } from "../FlowDiagram.js";
import { OFFICIAL_DONATIONS } from "../donations.js";
import { GITHUB_URL } from "../App.js";

export function Home({
  c,
  theme,
  onNode,
  onDownload,
}: {
  c: Copy;
  theme: Theme;
  onNode: () => void;
  onDownload: () => void;
}): JSX.Element {
  const features = [
    { t: c.feat_e2e_t, b: c.feat_e2e_b },
    { t: c.feat_decentral_t, b: c.feat_decentral_b },
    { t: c.feat_local_t, b: c.feat_local_b },
    { t: c.feat_free_t, b: c.feat_free_b },
  ];
  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div className="hero__mark">
            <CinderMark size={84} theme={theme} />
          </div>
          <h1>{c.hero_title}</h1>
          <p className="hero__sub">{c.hero_subtitle}</p>
          <div className="cta">
            <button type="button" className="btn btn--primary" onClick={onDownload}>
              {c.hero_download}
            </button>
            <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
              {c.hero_github}
            </a>
          </div>
        </div>
      </header>

      <section className="sec">
        <div className="wrap">
          <h2>{c.features_title}</h2>
          <div className="grid grid--4">
            {features.map((f) => (
              <div className="card" key={f.t}>
                <div className="card__ember" />
                <h3>{f.t}</h3>
                <p>{f.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.how_title}</h2>
          <p className="sec__lead">{c.how_lead}</p>
          <FlowDiagram c={c} />
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.node_title}</h2>
          <p className="sec__lead">{c.node_intro}</p>
          <button type="button" className="btn" onClick={onNode}>
            {c.nav_node} →
          </button>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.donate_title}</h2>
          <p className="sec__lead">{c.donate_intro}</p>
          <div className="chips">
            {OFFICIAL_DONATIONS.map((d) => (
              <a className="btn" key={d.channel} href={d.url} target="_blank" rel="noreferrer">
                {d.label}
              </a>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {c.donate_disclaimer}
          </p>
        </div>
      </section>
    </>
  );
}
