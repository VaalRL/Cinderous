// UI 字串的行內標記（`**粗體**`、`` `程式碼` ``）→ 巢狀 <Text>，放在外層 <Text> 裡用。
// 解析在 `@cinderous/i18n` 的 `richSegments`，與桌面共用。不碰 innerHTML。
import { Fragment, type ReactNode } from "react";
import { richSegments } from "@cinderous/i18n";
import { Text } from "react-native-web";

export function rich(text: string): ReactNode[] {
  return richSegments(text).map((s, i) =>
    s.kind === "bold" ? (
      <Text key={i} style={{ fontWeight: "700" }}>
        {s.text}
      </Text>
    ) : s.kind === "code" ? (
      <Text key={i} style={{ fontFamily: "monospace" }}>
        {s.text}
      </Text>
    ) : (
      <Fragment key={i}>{s.text}</Fragment>
    ),
  );
}
