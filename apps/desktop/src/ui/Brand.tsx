// Cinderous 品牌向量元件（原創，無第三方商標素材）。核心元素：一顆發光餘燼。
// CinderMark＝app 圖示/登入 logo（深藍夜底方磚 + 餘燼光球，桌面專屬設計）。
// CinderMascot＝吉祥物：已抽到 @cinderous/brand 作為桌面三欄與官網共用 SSOT（ADR-0247）；
// 此處 re-export，讓既有 `./Brand.js` import 路徑（ContactListWindow 等）不受影響、不建平行實作。
import { useId } from "react";

export { CinderMascot, type CinderMascotProps } from "@cinderous/brand";

/** 品牌記號：深藍夜底方磚 + 餘燼光球。 */
export function CinderMark({ size = 64 }: { size?: number }): JSX.Element {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Cinderous">
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
