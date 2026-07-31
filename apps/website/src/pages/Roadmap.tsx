import type { Copy } from "../copy.js";

export function Roadmap({ c }: { c: Copy }): JSX.Element {
  const planned = [
    { t: c.roadmap_p_mobile_t, b: c.roadmap_p_mobile_b },
    { t: c.roadmap_p_push_t, b: c.roadmap_p_push_b },
    { t: c.roadmap_p_desktop_t, b: c.roadmap_p_desktop_b },
    { t: c.roadmap_p_domain_t, b: c.roadmap_p_domain_b },
  ];
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <h2>{c.roadmap_title}</h2>
        <p className="sec__lead">{c.roadmap_intro}</p>

        <div className="card" style={{ marginTop: 24 }}>
          <div className="card__ember" />
          <h3>{c.roadmap_shipped_t}</h3>
          <p>{c.roadmap_shipped_b}</p>
        </div>

        {/*
          ADR-0306 D2：前向保密**只在這裡**以事實陳述出現——不進首頁功能表、
          不進比較表（`cp_r9a` 由 Compare.test 鎖為「開發中」）、不進行銷文案。
          放這裡的理由：想要的人拿得到，而「宣稱」這件事留到審計通過再說。
        */}
        <div className="card" style={{ marginTop: 24 }} data-testid="roadmap-fs">
          <div className="card__ember" />
          <h3>{c.roadmap_fs_t}</h3>
          <p>{c.roadmap_fs_b}</p>
        </div>

        <h2 style={{ fontSize: 22, marginTop: 34 }}>{c.roadmap_planned_t}</h2>
        <div className="grid" style={{ marginTop: 16 }}>
          {planned.map((s) => (
            <div className="card" key={s.t}>
              <div className="card__ember" />
              <h3>{s.t}</h3>
              <p>{s.b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
