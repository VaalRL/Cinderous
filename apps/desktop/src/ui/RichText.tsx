import { Fragment } from "react";
import { richSegments } from "@cinderous/i18n";

/**
 * UI 字串的行內標記（`**粗體**`、`` `程式碼` ``）渲染成元素；其餘照原文（換行交給 CSS 的 pre-wrap）。
 * 解析在 `@cinderous/i18n` 的 `richSegments`，手機端共用同一份。不碰 innerHTML。
 */
export function RichText({ text }: { text: string }): JSX.Element {
  return (
    <>
      {richSegments(text).map((s, i) =>
        s.kind === "bold" ? (
          <strong key={i}>{s.text}</strong>
        ) : s.kind === "code" ? (
          <code key={i}>{s.text}</code>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}
