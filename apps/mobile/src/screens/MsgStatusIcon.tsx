// 訊息狀態圖示（ADR-0095）：與桌面**同一套**幾何（@cinder/theme 的 MSG_STATUS_ICONS）。
//
// 目前行動端跑在 react-native-web（DOM），故直接用內嵌 <svg>。移植到真正的 React Native 時，
// 只需把 svg/path/circle 換成 react-native-svg 的 Svg/Path/Circle——幾何與色角色皆不變（共享 SSOT）。

import { MSG_STATUS_ICONS, type MsgStatusIconName } from "@cinder/theme";

export function MsgStatusIcon({
  status,
  color,
  size = 13,
}: {
  status: MsgStatusIconName;
  /** 依 tone 由呼叫端決定的實際色（muted／accent／danger）。 */
  color: string;
  size?: number;
}): JSX.Element {
  const icon = MSG_STATUS_ICONS[status];
  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={icon.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon.strokes.map((d) => (
        <path key={d} d={d} />
      ))}
      {icon.dot ? <circle cx={icon.dot[0]} cy={icon.dot[1]} r={icon.dot[2]} fill={color} stroke="none" /> : null}
    </svg>
  );
}
