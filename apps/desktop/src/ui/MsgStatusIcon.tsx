// 訊息狀態圖示（ADR-0095）：以 @cinder/theme 的共享幾何繪製，顏色走 currentColor
// （由 .tick--<status> 的 CSS 決定 muted／accent／danger），與行動端同一套語言。

import { MSG_STATUS_ICONS, type MsgStatusIconName } from "@cinder/theme";

export function MsgStatusIcon({ status, size = 13 }: { status: MsgStatusIconName; size?: number }): JSX.Element {
  const icon = MSG_STATUS_ICONS[status];
  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={icon.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon.strokes.map((d) => (
        <path key={d} d={d} />
      ))}
      {icon.dot ? <circle cx={icon.dot[0]} cy={icon.dot[1]} r={icon.dot[2]} fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}
