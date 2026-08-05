// 斜線指令的 composer 比對（ADR-0309）：行首 `/` → 命令候選。
//
// 純函式，沿用 ADR-0037／0050 的「只看游標前尾端」慣例（游標視為在文字結尾）。
// 本模組只認識 `{ id, aliases }`——命令的**行為**留在各端 UI，core 不認識 React 或 localStorage。
// 放在 core 讓桌面與（日後的）行動端共用同一份比對規則。
//
// **絕不外送**：比對在本機已解密的草稿上進行，不進任何事件、不寫 rumor、不同步到其他裝置
// （同 `calc.ts`／`date-detect.ts`）。

/** 命令目錄項；`aliases` 供繁中等別名前綴比對。 */
export interface SlashCommand {
  id: string;
  aliases?: string[];
}

/** 建議列上限。 */
export const SLASH_SUGGEST_MAX = 8;

export interface SlashSuggest {
  /** `/` 在文字中的索引（供替換）。 */
  start: number;
  /** `/` 後已輸入的片段（不含 `/`）。 */
  query: string;
  /** 過濾後的候選（id 或別名前綴命中）。 */
  commands: SlashCommand[];
}

/**
 * 擷取進行中的斜線 token 並過濾命令目錄：
 * `/` 須位於草稿開頭或某行開頭，其後到結尾不含空白與第二個 `/`。
 *
 * 空查詢（只打了 `/`）即列出全部——與 ADR-0037 的「≥2 字」不同，因為行首 `/` 是刻意輸入，
 * 不像貼圖觸發字那樣任何字元都可能誤觸。無命中回傳 null（不顯示空列）。
 */
export function suggestSlash(text: string, commands: SlashCommand[]): SlashSuggest | null {
  const m = /(?:^|\n)\/([^\s/]*)$/.exec(text);
  if (!m) return null;
  const query = m[1] ?? "";
  const start = text.length - query.length - 1; // `/` 的位置
  const q = query.toLowerCase();
  const list = commands.filter((c) => matchesPrefix(c, q)).slice(0, SLASH_SUGGEST_MAX);
  if (list.length === 0) return null;
  return { start, query, commands: list };
}

function matchesPrefix(cmd: SlashCommand, q: string): boolean {
  if (q.length === 0) return true;
  if (cmd.id.toLowerCase().startsWith(q)) return true;
  return (cmd.aliases ?? []).some((a) => a.toLowerCase().startsWith(q));
}

/** 接受某命令：把 `/token` 自草稿移除（命令的實際行為由呼叫端執行）。 */
export function applySlash(text: string, s: SlashSuggest): string {
  return text.slice(0, s.start) + text.slice(s.start + 1 + s.query.length);
}
