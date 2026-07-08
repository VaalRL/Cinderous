// Composer Tab 縮排（純函式，供 textarea onKeyDown 使用）。
// Tab：無選取＝游標處插入 2 空白；選取跨行＝逐行縮排。Shift+Tab：逐行退排（tab 或最多 2 空白）。
// 2 空白 = markdown 清單的 1 層縮排（見 markdown.tsx indentDepth）。

export const INDENT = "  ";

export interface IndentResult {
  text: string;
  /** 縮排後應還原的選取起訖（游標位置）。 */
  start: number;
  end: number;
}

export function indentText(text: string, selStart: number, selEnd: number, dedent: boolean): IndentResult {
  const multiline = text.slice(selStart, selEnd).includes("\n");
  if (!dedent && !multiline) {
    // 單游標（或單行選取）：以縮排取代選取
    const caret = selStart + INDENT.length;
    return { text: text.slice(0, selStart) + INDENT + text.slice(selEnd), start: caret, end: caret };
  }
  // 行級操作：找出選取觸及的整行範圍
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const lineEndIdx = text.indexOf("\n", selEnd);
  const end = lineEndIdx === -1 ? text.length : lineEndIdx;
  let firstDelta = 0;
  let totalDelta = 0;
  const out = text
    .slice(lineStart, end)
    .split("\n")
    .map((line, i) => {
      if (dedent) {
        const removed = line.startsWith("\t") ? 1 : line.startsWith(INDENT) ? 2 : line.startsWith(" ") ? 1 : 0;
        if (i === 0) firstDelta = -removed;
        totalDelta -= removed;
        return line.slice(removed);
      }
      if (line.length === 0) return line; // 空行不縮
      if (i === 0) firstDelta = INDENT.length;
      totalDelta += INDENT.length;
      return INDENT + line;
    })
    .join("\n");
  const newStart = Math.max(lineStart, selStart + firstDelta);
  return {
    text: text.slice(0, lineStart) + out + text.slice(end),
    start: newStart,
    end: Math.max(newStart, selEnd + totalDelta),
  };
}
