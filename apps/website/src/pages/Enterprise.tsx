import type { Copy } from "../copy.js";
import { GITHUB_URL } from "../App.js";

// 企業版頁（ADR-0246）：同一套開源核心、封閉自架部署。強調 allowlist 封閉節點、組織名冊、
// 離職接管（無金鑰託管）、公司政策與資料主權——中繼全程只見密文。
export function Enterprise({ c }: { c: Copy }): JSX.Element {
  const cards = [
    { t: c.ent_closed_t, b: c.ent_closed_b },
    { t: c.ent_roster_t, b: c.ent_roster_b },
    { t: c.ent_offboard_t, b: c.ent_offboard_b },
    { t: c.ent_policy_t, b: c.ent_policy_b },
    { t: c.ent_sovereign_t, b: c.ent_sovereign_b },
    { t: c.ent_open_t, b: c.ent_open_b },
  ];
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }} data-testid="enterprise">
      <div className="wrap">
        <h2>{c.ent_title}</h2>
        <p className="sec__lead" style={{ maxWidth: 760 }}>
          {c.ent_intro}
        </p>

        <div className="grid" style={{ marginTop: 30 }}>
          {cards.map((card) => (
            <div className="card" key={card.t}>
              <div className="card__ember" />
              <h3>{card.t}</h3>
              <p>{card.b}</p>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: 22, marginTop: 40 }}>{c.ent_deploy_t}</h2>
        <p className="sec__lead">{c.ent_deploy_b}</p>

        <p className="hint" style={{ marginTop: 14 }}>
          {c.ent_note}
        </p>

        <div className="cta" style={{ justifyContent: "flex-start", marginTop: 26 }}>
          <a className="btn btn--primary" href={`${GITHUB_URL}/blob/main/docs/SELF-HOSTING.md`} target="_blank" rel="noreferrer">
            {c.ent_cta}
          </a>
        </div>
      </div>
    </section>
  );
}
