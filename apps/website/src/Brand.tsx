// Cinder 標記（原創）：一簇營火餘燼。隨明暗主題切換外框色，並帶暖光暈（夜裡的火光）。
import { useId } from "react";

export function CinderMark({ size = 40, theme = "dark" }: { size?: number; theme?: "light" | "dark" }): JSX.Element {
  const glow = useId().replace(/[:]/g, "");
  const square = theme === "dark" ? "#18231e" : "#0f2028"; // 夜森林框：暗模式較淺、亮模式較深，兩者皆可見
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="24" fill={square} />
      <circle cx="50" cy="53" r="26" fill="#ff7a2f" opacity="0.5" filter={`url(#${glow})`} />
      <circle cx="50" cy="50" r="30" fill="#ff7a2f" />
      <circle cx="50" cy="48" r="19" fill="#ffc24d" />
      <circle cx="44" cy="42" r="9" fill="#ffe6a3" />
    </svg>
  );
}
