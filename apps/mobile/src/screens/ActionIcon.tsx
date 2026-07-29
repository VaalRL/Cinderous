// 動作圖示（ADR-0282）：幾何取自 `@cinderous/theme` 的 `ACTION_ICONS`（跨前端 SSOT），
// 這裡只負責用 react-native-svg 畫出來——與 `MsgStatusIcon` 同一種分工。
import { ACTION_ICONS, type ActionIconName } from "@cinderous/theme";
import Svg, { Path } from "react-native-svg";

export function ActionIcon({
  name,
  color,
  size = 18,
}: {
  name: ActionIconName;
  /** 由呼叫端依情境決定的實際色（通常是主色）。 */
  color: string;
  size?: number;
}): JSX.Element {
  const icon = ACTION_ICONS[name];
  return (
    <Svg viewBox={icon.viewBox} width={size} height={size} fill="none">
      {icon.strokes.map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={icon.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}
