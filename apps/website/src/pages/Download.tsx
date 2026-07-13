import type { Copy } from "../copy.js";
import { GITHUB_URL } from "../App.js";

export function Download({ c, onNode }: { c: Copy; onNode: () => void }): JSX.Element {
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <h2>{c.download_title}</h2>
        <p className="sec__lead">{c.download_desktop}</p>
        <div className="grid" style={{ marginBottom: 22 }}>
          {["Windows", "macOS", "Linux"].map((os) => (
            <div className="card" key={os}>
              <div className="card__ember" />
              <h3>{os}</h3>
              <p>{c.download_releases}</p>
            </div>
          ))}
        </div>
        <div className="cta" style={{ justifyContent: "flex-start" }}>
          <a className="btn btn--primary" href={`${GITHUB_URL}/releases`} target="_blank" rel="noreferrer">
            {c.download_releases}
          </a>
          <button type="button" className="btn" onClick={onNode}>
            {c.nav_node} →
          </button>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>
          {c.download_mobile}
        </p>
      </div>
    </section>
  );
}
