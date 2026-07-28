import type { Copy } from "../copy.js";

// 比較頁（ADR-0254）：與 Signal/LINE/WhatsApp 的誠實比較表——含對我方不利的列
// （前向保密、功能成熟度），誠實即賣點；FS 列的 Cinderous 格由測試鎖住不得為 ✓（ADR-0245 硬閘）。
// 只用文字名稱、不用任何第三方 logo（商標，ADR-0166）；表尾附商標聲明與資料時間。
export function Compare({ c }: { c: Copy }): JSX.Element {
  const rows: { label: string; cells: [string, string, string, string] }[] = [
    { label: c.cp_r1, cells: [c.cp_r1a, c.cp_r1b, c.cp_r1c, c.cp_r1d] },
    { label: c.cp_r2, cells: [c.cp_r2a, c.cp_r2b, c.cp_r2c, c.cp_r2d] },
    { label: c.cp_r3, cells: [c.cp_r3a, c.cp_r3b, c.cp_r3c, c.cp_r3d] },
    { label: c.cp_r4, cells: [c.cp_r4a, c.cp_r4b, c.cp_r4c, c.cp_r4d] },
    { label: c.cp_r5, cells: [c.cp_r5a, c.cp_r5b, c.cp_r5c, c.cp_r5d] },
    { label: c.cp_r6, cells: [c.cp_r6a, c.cp_r6b, c.cp_r6c, c.cp_r6d] },
    { label: c.cp_r7, cells: [c.cp_r7a, c.cp_r7b, c.cp_r7c, c.cp_r7d] },
    { label: c.cp_r8, cells: [c.cp_r8a, c.cp_r8b, c.cp_r8c, c.cp_r8d] },
    { label: c.cp_r9, cells: [c.cp_r9a, c.cp_r9b, c.cp_r9c, c.cp_r9d] },
    { label: c.cp_r10, cells: [c.cp_r10a, c.cp_r10b, c.cp_r10c, c.cp_r10d] },
  ];
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }} data-testid="compare">
      <div className="wrap">
        <h2>{c.cp_title}</h2>
        <p className="sec__lead" style={{ maxWidth: 760 }}>
          {c.cp_lead}
        </p>

        <div className="table-wrap" style={{ marginTop: 26 }}>
          <table data-testid="compare-table">
            <thead>
              <tr>
                <th scope="col">{c.cp_colDim}</th>
                <th scope="col" className="cmp__us">
                  Cinderous
                </th>
                <th scope="col">Signal</th>
                <th scope="col">LINE</th>
                <th scope="col">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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

        <p className="hint" style={{ marginTop: 14 }}>
          {c.cp_note1}
        </p>
        <p className="hint" data-testid="compare-note">
          {c.cp_note}
        </p>
      </div>
    </section>
  );
}
