import type { Copy } from "../copy.js";
import { GITHUB_URL } from "../App.js";
import { routeHref, type Route } from "../routes.js";
import type { Locale } from "@cinderous/i18n";

// 企業版頁（ADR-0246）：同一套開源核心、封閉自架部署。強調 allowlist 封閉節點、組織名冊、
// 離職接管（無金鑰託管）、公司政策與資料主權——中繼全程只見密文。
// 「與常見選擇的差異」段（ADR-0255）：按**類別**比（雲端套件／自架開源／E2E 自架）、只打隱私
// 主權軸——功能廣度不是主場，開頭直說；表尾誠實限制段（合規匯出設計上做不到、SSO/SCIM 未提供）。
export function Enterprise({ c, locale }: { c: Copy; locale: Locale }): JSX.Element {
  const cards = [
    { t: c.ent_closed_t, b: c.ent_closed_b },
    { t: c.ent_roster_t, b: c.ent_roster_b },
    { t: c.ent_offboard_t, b: c.ent_offboard_b },
    { t: c.ent_policy_t, b: c.ent_policy_b },
    { t: c.ent_sovereign_t, b: c.ent_sovereign_b },
    { t: c.ent_open_t, b: c.ent_open_b },
  ];
  const cmpRows: { label: string; cells: [string, string, string, string] }[] = [
    { label: c.ec_r1, cells: [c.ec_r1a, c.ec_r1b, c.ec_r1c, c.ec_r1d] },
    { label: c.ec_r2, cells: [c.ec_r2a, c.ec_r2b, c.ec_r2c, c.ec_r2d] },
    { label: c.ec_r3, cells: [c.ec_r3a, c.ec_r3b, c.ec_r3c, c.ec_r3d] },
    { label: c.ec_r4, cells: [c.ec_r4a, c.ec_r4b, c.ec_r4c, c.ec_r4d] },
    { label: c.ec_r5, cells: [c.ec_r5a, c.ec_r5b, c.ec_r5c, c.ec_r5d] },
  ];
  const compareRoute: Route = { view: "compare", locale };
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

        {/* 與常見選擇的差異（ADR-0255）：類別比、隱私主權軸限定。 */}
        <h2 style={{ fontSize: 22, marginTop: 40 }}>{c.ent_cmp_title}</h2>
        <p className="sec__lead" style={{ maxWidth: 760 }}>
          {c.ent_cmp_lead}
        </p>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table data-testid="ent-compare-table">
            <thead>
              <tr>
                <th scope="col">{c.cp_colDim}</th>
                <th scope="col" className="cmp__us">
                  Cinderous
                </th>
                <th scope="col">{c.ent_cmp_colCloud}</th>
                <th scope="col">{c.ent_cmp_colSelf}</th>
                <th scope="col">{c.ent_cmp_colE2e}</th>
              </tr>
            </thead>
            <tbody>
              {cmpRows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="cmp__us">{r.cells[0]}</td>
                  <td>{r.cells[1]}</td>
                  <td>{r.cells[2]}</td>
                  <td>{r.cells[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 14 }} data-testid="ent-compare-note">
          {c.ent_cmp_note}
        </p>
        <p style={{ marginTop: 6 }}>
          <a href={routeHref(compareRoute)}>{c.ent_cmp_more}</a>
        </p>

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
