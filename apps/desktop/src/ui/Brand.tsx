// Cinder 品牌向量元件（原創，無第三方商標素材）。核心元素：一顆發光餘燼。
// CinderMark＝app 圖示/登入 logo（深藍夜底方磚 + 餘燼光球）；
// CinderMascot＝吉祥物（MSN buddy 藍身 + 燭火頭），alert 態＝有新訊息（火更旺 + 紅點）。
import { useId } from "react";

/** 品牌記號：深藍夜底方磚 + 餘燼光球。 */
export function CinderMark({ size = 64 }: { size?: number }): JSX.Element {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Cinder">
      <defs>
        <radialGradient id={`${id}e`} cx="50%" cy="42%" r="58%">
          <stop offset="0%" stopColor="#fff1c4" />
          <stop offset="36%" stopColor="#ffc24d" />
          <stop offset="72%" stopColor="#ff7a2f" />
          <stop offset="100%" stopColor="#e24a2b" />
        </radialGradient>
        <radialGradient id={`${id}bg`} cx="50%" cy="16%" r="120%">
          <stop offset="0%" stopColor="#24406b" />
          <stop offset="62%" stopColor="#10203c" />
          <stop offset="100%" stopColor="#0a1122" />
        </radialGradient>
        <filter id={`${id}g`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="24" fill={`url(#${id}bg)`} />
      <circle cx="50" cy="52" r="30" fill="#ff7a2f" opacity="0.4" filter={`url(#${id}g)`} />
      <circle cx="50" cy="50" r="24" fill={`url(#${id}e)`} />
      <circle cx="44" cy="42" r="6.5" fill="#fff6dc" opacity="0.85" />
    </svg>
  );
}

const FLAME = "M60 4 C73 27 79 41 79 53 C79 64 71 69 60 69 C49 69 41 64 41 53 C41 41 47 27 60 4 Z";
const FLAME_TALL = "M60 -2 C76 24 84 40 84 53 C84 65 73 70 60 70 C47 70 36 65 36 53 C36 40 44 24 60 -2 Z";
const BODY =
  "M60 60 C39 60 30 73 28 91 C26 106 25 118 30 127 C32 132 38 135 47 135 L73 135 C82 135 88 132 90 127 C95 118 94 106 92 91 C90 73 81 60 60 60 Z";

/** 吉祥物：MSN buddy 藍身 + 燭火頭。alert＝有新訊息（火更旺 + 紅點）。 */
export function CinderMascot({ alert = false, size = 48 }: { alert?: boolean; size?: number }): JSX.Element {
  const id = useId().replace(/:/g, "");
  const height = Math.round((size * 150) / 120);
  const flame = alert ? FLAME_TALL : FLAME;
  // 身體色系跟隨主題色 --accent（ADR-0064）；頭的餘燼維持恆常。
  const accentVar = "var(--accent, #2f6cd6)";
  const bodyTop = `color-mix(in srgb, ${accentVar} 74%, #ffffff)`;
  const armHi = `color-mix(in srgb, ${accentVar} 42%, #ffffff)`;
  const bodyShadow = `color-mix(in srgb, ${accentVar} 45%, #000000)`;
  const handHi = `color-mix(in srgb, ${accentVar} 22%, #ffffff)`;
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 120 150"
      role="img"
      aria-label={alert ? "Cinder（有新訊息）" : "Cinder"}
    >
      <defs>
        <radialGradient id={`${id}e`} cx="50%" cy={alert ? "66%" : "64%"} r={alert ? "62%" : "60%"}>
          <stop offset="0%" stopColor={alert ? "#fff7d8" : "#fff1c4"} />
          <stop offset="38%" stopColor={alert ? "#ffcf5e" : "#ffc24d"} />
          <stop offset="72%" stopColor="#ff7a2f" />
          <stop offset="100%" stopColor="#e24a2b" />
        </radialGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: bodyTop }} />
          <stop offset="100%" style={{ stopColor: accentVar }} />
        </linearGradient>
        <filter id={`${id}g`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={alert ? 5 : 4} />
        </filter>
      </defs>
      <ellipse cx="60" cy="137" rx="35" ry="4.8" fill="#000" opacity="0.09" />
      <path d={flame} fill={alert ? "#ffab3d" : "#ff7a2f"} opacity={alert ? 0.4 : 0.26} filter={`url(#${id}g)`} />
      <path d="M40 86 C26 93 20 107 24 122" stroke={`url(#${id}b)`} strokeWidth="13" strokeLinecap="round" fill="none" />
      <path d="M80 86 C94 93 100 107 96 122" stroke={`url(#${id}b)`} strokeWidth="13" strokeLinecap="round" fill="none" />
      <path d="M39 84 C26 91 20 105 23 120" style={{ stroke: armHi }} strokeWidth="4.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M81 84 C94 91 100 105 97 120" style={{ stroke: armHi }} strokeWidth="4.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d={BODY} fill={`url(#${id}b)`} />
      <ellipse cx="60" cy="70" rx={alert ? 28 : 27} ry={alert ? 12 : 11} fill={alert ? "#ffab3d" : "#ffa24d"} opacity={alert ? 0.42 : 0.33} />
      <ellipse cx="48" cy="92" rx="12" ry="18" fill="#ffffff" opacity="0.13" />
      <ellipse cx="60" cy="124" rx="27" ry="12" style={{ fill: bodyShadow }} opacity="0.22" />
      <circle cx="20" cy="119" r="2.6" style={{ fill: handHi }} opacity="0.55" />
      <circle cx="100" cy="119" r="2.6" style={{ fill: handHi }} opacity="0.55" />
      <path d={flame} fill={`url(#${id}e)`} />
      <ellipse cx={alert ? 53 : 54} cy={alert ? 49 : 50} rx="2.6" ry="3.6" fill="#5a2410" />
      <ellipse cx={alert ? 67 : 66} cy={alert ? 49 : 50} rx="2.6" ry="3.6" fill="#5a2410" />
      <path
        d={alert ? "M54 57 Q60 65 66 57" : "M55 58 Q60 63 65 58"}
        stroke="#5a2410"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {alert ? (
        <g transform="translate(92 24)">
          <circle r="12" fill="#e5484d" />
          <text x="0" y="5" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="Segoe UI, sans-serif">
            1
          </text>
        </g>
      ) : null}
    </svg>
  );
}
