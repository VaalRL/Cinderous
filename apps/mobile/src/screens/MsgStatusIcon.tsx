// 訊息狀態圖示（ADR-0095）：與桌面**同一套**幾何（@cinderous/theme 的 MSG_STATUS_ICONS）。
//
// 用 react-native-svg（Expo/RN 生態標準，且 react-native-web 亦可用）——不再內嵌 DOM <svg>，
// 故本元件可原樣移植到真正的 React Native：Metro 會自行挑 native 實作，web 端則由
// vite.config 的別名指到其 web 實作（見該檔註解）。

import { MSG_STATUS_ICONS, type MsgStatusIconName } from "@cinderous/theme";
import Svg, { Circle, Path } from "react-native-svg";

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
    <Svg viewBox={icon.viewBox} width={size} height={size} fill="none">
      {icon.strokes.map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={icon.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
      {icon.dot ? <Circle cx={icon.dot[0]} cy={icon.dot[1]} r={icon.dot[2]} fill={color} /> : null}
    </Svg>
  );
}
