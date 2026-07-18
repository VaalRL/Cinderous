// 多節點協作圖（原創 SVG，隨主題色）：你/好友各連任一可用中繼，密文可經任一節點轉發；
// 一座離線→自動改走其他座；可用節點由簽章清單決定；即時互動走 WebRTC P2P 直連。
import type { Copy } from "./copy.js";

function Person({ cx, cy }: { cx: number; cy: number }): JSX.Element {
  return (
    <g>
      <circle cx={cx} cy={cy} r={30} fill="var(--surface)" stroke="var(--border)" strokeWidth={2} />
      <circle cx={cx} cy={cy - 7} r={9} fill="var(--muted)" />
      <path d={`M ${cx - 13} ${cy + 15} a 13 12 0 0 1 26 0 Z`} fill="var(--muted)" />
    </g>
  );
}

function RelayNode({ cy, label, down }: { cy: number; label: string; down?: boolean }): JSX.Element {
  return (
    <g opacity={down ? 0.5 : 1}>
      <rect
        x={330}
        y={cy - 23}
        width={160}
        height={46}
        rx={12}
        fill="var(--panel)"
        stroke={down ? "var(--muted)" : "var(--border)"}
        strokeWidth={2}
        strokeDasharray={down ? "5 4" : undefined}
      />
      {down ? (
        <text x={355} y={cy + 5} textAnchor="middle" fontSize="15" fill="var(--muted)">
          ✕
        </text>
      ) : (
        <circle cx={355} cy={cy} r={7} fill="var(--ember)" />
      )}
      <text x={378} y={cy + 5} fontSize="14" fontWeight="700" fill="var(--ink)">
        {label}
      </text>
    </g>
  );
}

export function MultiNodeDiagram({ c }: { c: Copy }): JSX.Element {
  const YOU = { cx: 86, cy: 175 };
  const FRIEND = { cx: 734, cy: 175 };
  const nodes = [78, 175, 272]; // 三座中繼的 cy
  const solid = "var(--accent)";
  return (
    <div className="diagram">
      <svg viewBox="0 0 820 360" width="100%" role="img" aria-label={c.tech_multi_title} style={{ display: "block" }}>
        <defs>
          <marker id="mnA" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent)" />
          </marker>
          <marker id="mnE" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,3 L0,6 Z" fill="var(--ember)" />
          </marker>
          <marker id="mnEs" markerWidth="10" markerHeight="10" refX="2" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M8,0 L0,3 L8,6 Z" fill="var(--ember)" />
          </marker>
        </defs>

        {/* 頂部：簽章清單決定可用節點 */}
        <text x="410" y="24" textAnchor="middle" fontSize="12.5" fontWeight="700" fill="var(--accent)">
          {c.md_list}
        </text>

        {/* 你 → 各健康中繼 → 好友（密文，扇出＝可經任一節點） */}
        {nodes.map((cy, i) => {
          const down = i === 2;
          const stroke = down ? "var(--muted)" : solid;
          return (
            <g key={cy} opacity={down ? 0.5 : 1}>
              <line
                x1={YOU.cx + 34}
                y1={YOU.cy}
                x2={324}
                y2={cy}
                stroke={stroke}
                strokeWidth="2.5"
                strokeDasharray={down ? "6 5" : undefined}
                markerEnd={down ? undefined : "url(#mnA)"}
              />
              <line
                x1={496}
                y1={cy}
                x2={FRIEND.cx - 34}
                y2={FRIEND.cy}
                stroke={stroke}
                strokeWidth="2.5"
                strokeDasharray={down ? "6 5" : undefined}
                markerEnd={down ? undefined : "url(#mnA)"}
              />
            </g>
          );
        })}

        {/* 密文標籤 */}
        <text x="205" y="112" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--accent)">
          {c.md_cipher}
        </text>

        {/* 中繼節點 */}
        <RelayNode cy={nodes[0]!} label={c.md_anchorA} />
        <RelayNode cy={nodes[1]!} label={c.md_anchorB} />
        <RelayNode cy={nodes[2]!} label={c.md_community} down />
        <text x="410" y="312" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--muted)">
          {c.md_offline}
        </text>

        {/* 人物 */}
        <Person cx={YOU.cx} cy={YOU.cy} />
        <Person cx={FRIEND.cx} cy={FRIEND.cy} />
        <text x={YOU.cx} y={YOU.cy + 44} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">
          {c.fd_alice}
        </text>
        <text x={FRIEND.cx} y={FRIEND.cy + 44} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">
          {c.fd_bob}
        </text>

        {/* P2P 直連（不經中繼） */}
        <path
          d={`M ${YOU.cx} ${YOU.cy + 30} Q 410 372 ${FRIEND.cx} ${FRIEND.cy + 30}`}
          fill="none"
          stroke="var(--ember)"
          strokeWidth="2.5"
          strokeDasharray="7 6"
          markerEnd="url(#mnE)"
          markerStart="url(#mnEs)"
        />
        <text x="410" y="350" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--ember)">
          {c.fd_p2p}
        </text>
      </svg>
    </div>
  );
}
