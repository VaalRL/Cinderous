// Release notes（ADR-0227 P4）：build-time 由 vite `define` 注入（`__RELEASES__`），
// 源自 docs/releases.json（單一雙語來源）；供設定「關於」區依語系顯示本版更新記錄。
export interface ReleaseNote {
  version: string;
  date: string;
  /** `false`＝未發布（hold 草稿）；供更新偵測排除（ADR-0228）。缺省視為已發布。 */
  released?: boolean;
  /** 繁體中文條目。 */
  zh: string[];
  /** 英文條目。 */
  en: string[];
}

export const RELEASES: ReleaseNote[] = __RELEASES__;

/** 取指定版本的 note；找不到回最新（第一筆）。 */
export function releaseFor(version: string): ReleaseNote | undefined {
  return RELEASES.find((r) => r.version === version) ?? RELEASES[0];
}

/** 發版條目的一段：純文字、`**粗體**`、或 `` `程式碼` ``。 */
export interface NoteSegment {
  kind: "text" | "bold" | "code";
  text: string;
}

/**
 * 把 releases.json 的條目拆成段落（只認 `**…**` 與 `` `…` ``，GitHub 發版說明用的就這兩種）。
 * 回傳純資料、由 React 渲染成元素——不碰 innerHTML，條目內容再怎麼寫都不會變成 HTML。
 * 沒配對的標記原樣當文字。
 */
export function noteSegments(line: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ kind: "text", text: line.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "bold", text: m[1] } : { kind: "code", text: m[2] ?? "" });
    last = re.lastIndex;
  }
  if (last < line.length || out.length === 0) out.push({ kind: "text", text: line.slice(last) });
  return out;
}
