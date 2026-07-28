// 對話內搜尋（ADR-0256）：主頻道訊息的關鍵字搜尋與命中巡覽。純函式、可測。
//
// 比對用**可見文字**（splitAssetManifest 剝掉行內資產 manifest，ADR-0220——否則會搜到
// manifest 內部的 JSON）；檔案訊息比對檔名；已收回/已過期顯示的是占位文字，不參與搜尋。
// 範圍＝熱區（主視窗持有的最近訊息）；封存搜尋另行處理（冷熱分離，ADR-0111）。
import { splitAssetManifest } from "@cinderous/core";
import type { ChatMessage } from "@cinderous/engine";

export interface SearchHit {
  id: string;
  /** 在主頻道（channel）陣列中的索引（舊→新）。 */
  index: number;
}

/** 大小寫不敏感搜尋主頻道；空查詢＝無命中。回傳依時間舊→新。 */
export function searchChannel(
  channel: ChatMessage[],
  query: string,
  opts: { unsent?: Set<string>; expired?: Set<string> } = {},
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchHit[] = [];
  channel.forEach((m, index) => {
    if (opts.unsent?.has(m.id) || opts.expired?.has(m.id)) return; // 占位文字不參與
    if (m.file) {
      if (m.file.name.toLowerCase().includes(q)) out.push({ id: m.id, index });
      return;
    }
    if (splitAssetManifest(m.text).text.toLowerCase().includes(q)) out.push({ id: m.id, index });
  });
  return out;
}

/** 命中巡覽（環繞）：dir=-1 往較舊、+1 往較新；total=0 回 0。 */
export function stepHit(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + dir + total) % total;
}

/**
 * 封存訊息比對（ADR-0256 階段 3）：文字或檔名、大小寫不敏感；q 需先 trim+lowercase
 * （掃描迴圈每塊上千則，正規化一次由呼叫端做）。空 q＝不命中。
 */
export function matchesStored(m: { text: string; file?: { name: string } }, q: string): boolean {
  if (!q) return false;
  if (m.file) return m.file.name.toLowerCase().includes(q);
  return splitAssetManifest(m.text).text.toLowerCase().includes(q);
}
