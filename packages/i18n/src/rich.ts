// UI 字串與發版條目的行內標記：只認 `**粗體**` 與 `` `程式碼` ``。
//
// 不用訊息的完整 Markdown 渲染器：那邊把 `_x_` 當斜體，`MAX_TTL_DAYS` 這類設定名會被拆壞。
// 回傳純資料，由各端（桌面 React、手機 react-native-web）渲染成元素——不碰 innerHTML。

/** 一段：純文字、粗體、或程式碼。 */
export interface RichSegment {
  kind: "text" | "bold" | "code";
  text: string;
}

const MARK = /\*\*(.+?)\*\*|`([^`]+)`/gs;

/** 拆成段落；沒配對的標記原樣當文字。 */
export function richSegments(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  const re = new RegExp(MARK.source, MARK.flags);
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : { kind: "code", text: m[2] ?? "" });
    last = re.lastIndex;
  }
  if (last < text.length || out.length === 0) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** 拿掉標記、只留文字：給渲染不了的地方（原生 confirm／alert、系統通知、手機的訊息氣泡）。 */
export function stripRich(text: string): string {
  return richSegments(text)
    .map((s) => s.text)
    .join("");
}
