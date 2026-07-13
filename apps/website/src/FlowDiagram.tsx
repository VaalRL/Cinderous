// 訊息傳遞機制圖（原創 SVG，隨主題色）：寄件者 →〔Gift Wrap 密文〕→ 中繼站（只見密文）→ 收件者；
// 底部虛線＝WebRTC P2P 直連（檔案/在線/輸入中，不經中繼）。
import type { Copy } from "./copy.js";

function Person({ cx, glyph }: { cx: number; glyph: string }): JSX.Element {
  return (
    <g>
      <circle cx={cx} cy={92} r={36} fill="var(--surface)" stroke="var(--border)" strokeWidth={2} />
      <circle cx={cx} cy={84} r={11} fill="var(--muted)" />
      <path d={`M ${cx - 16} 110 a 16 14 0 0 1 32 0 Z`} fill="var(--muted)" />
      <title>{glyph}</title>
    </g>
  );
}

export function FlowDiagram({ c }: { c: Copy }): JSX.Element {
  return (
    <div className="diagram">
      <svg viewBox="0 0 820 250" width="100%" role="img" aria-label={c.how_title} style={{ display: "block" }}>
        <defs>
          <marker id="fdA" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent)" />
          </marker>
          <marker id="fdE" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,3 L0,6 Z" fill="var(--ember)" />
          </marker>
          <marker id="fdEs" markerWidth="10" markerHeight="10" refX="2" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M8,0 L0,3 L8,6 Z" fill="var(--ember)" />
          </marker>
        </defs>

        {/* 加密路徑標籤 */}
        <text x="410" y="26" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--accent)">
          {c.fd_encrypt}
        </text>

        {/* Alice → Relay → Bob（密文） */}
        <line x1="131" y1="92" x2="322" y2="92" stroke="var(--accent)" strokeWidth="2.5" markerEnd="url(#fdA)" />
        <line x1="498" y1="92" x2="689" y2="92" stroke="var(--accent)" strokeWidth="2.5" markerEnd="url(#fdA)" />

        {/* 中繼站 */}
        <rect x="330" y="60" width="160" height="64" rx="14" fill="var(--panel)" stroke="var(--border)" strokeWidth="2" />
        <text x="410" y="88" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink)">
          {c.fd_relay}
        </text>
        <text x="410" y="106" textAnchor="middle" fontSize="10.5" fill="var(--muted)">
          👁 ✕
        </text>
        <text x="410" y="146" textAnchor="middle" fontSize="12" fill="var(--muted)">
          {c.fd_relay_note}
        </text>

        {/* 人物 */}
        <Person cx={95} glyph={c.fd_alice} />
        <Person cx={725} glyph={c.fd_bob} />
        <text x="95" y="164" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">
          {c.fd_alice}
        </text>
        <text x="725" y="164" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">
          {c.fd_bob}
        </text>

        {/* P2P 直連（不經中繼） */}
        <path
          d="M 95 132 Q 410 240 725 132"
          fill="none"
          stroke="var(--ember)"
          strokeWidth="2.5"
          strokeDasharray="7 6"
          markerEnd="url(#fdE)"
          markerStart="url(#fdEs)"
        />
        <text x="410" y="232" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--ember)">
          {c.fd_p2p}
        </text>
      </svg>
    </div>
  );
}
