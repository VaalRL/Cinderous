import type { Theme } from "@cinderous/theme";
import type { Copy } from "../copy.js";
import { CinderMark } from "../Brand.js";
import { OFFICIAL_DONATIONS } from "../donations.js";
import { GITHUB_URL, WEBAPP_URL } from "../App.js";

// 首頁（ADR-0187）：闡述核心價值觀與「取回通訊自主權」的願景。技術細節移至技術原理頁。
export function Home({
  c,
  theme,
  onNode,
  onTech,
}: {
  c: Copy;
  theme: Theme;
  onNode: () => void;
  onTech: () => void;
}): JSX.Element {
  const values = [
    { t: c.val_autonomy_t, b: c.val_autonomy_b },
    { t: c.val_privacy_t, b: c.val_privacy_b },
    { t: c.val_decentral_t, b: c.val_decentral_b },
    { t: c.val_free_t, b: c.val_free_b },
  ];
  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div className="hero__mark">
            <CinderMark size={84} theme={theme} />
          </div>
          <p className="eyebrow">{c.hero_eyebrow}</p>
          <h1>{c.hero_title}</h1>
          <p className="hero__sub">{c.hero_subtitle}</p>
          <div className="cta">
            <a
              className="btn btn--primary"
              href={`${GITHUB_URL}/releases`}
              target="_blank"
              rel="noreferrer"
            >
              {c.hero_download}
            </a>
            <a className="btn" href={WEBAPP_URL} target="_blank" rel="noreferrer">
              {c.hero_webapp}
            </a>
            <button type="button" className="btn" onClick={onTech}>
              {c.hero_tech} →
            </button>
            <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
              {c.hero_github}
            </a>
          </div>
        </div>
      </header>

      <section className="sec">
        <div className="wrap">
          <h2>{c.vision_title}</h2>
          <p className="sec__lead" style={{ maxWidth: 760 }}>
            {c.vision_body}
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.values_title}</h2>
          <div className="grid grid--4">
            {values.map((v) => (
              <div className="card" key={v.t}>
                <div className="card__ember" />
                <h3>{v.t}</h3>
                <p>{v.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.store_title}</h2>
          <p className="sec__lead" style={{ maxWidth: 760 }}>
            {c.store_lead}
          </p>
          <div className="grid">
            {[
              { t: c.store_desktop_t, b: c.store_desktop_b },
              { t: c.store_web_t, b: c.store_web_b },
              { t: c.store_mobile_t, b: c.store_mobile_b },
            ].map((s) => (
              <div className="card" key={s.t}>
                <div className="card__ember" />
                <h3>{s.t}</h3>
                <p>{s.b}</p>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            <strong>{c.store_relay_t}</strong> — {c.store_relay_b}
          </p>
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
