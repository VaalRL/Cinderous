// 三欄左側欄邏輯（ADR-0079 Q2）：聯絡人＋群組混合、依最近互動排序、
// 搜尋（名稱＋訊息內容）、自訂標籤篩選。純函式、可測。
import type { ChatMessage, Contact, Group, Status } from "@cinderous/engine";
import { contactLabel } from "@cinderous/engine";
import { labelsOf, type GroupPrefsMap } from "./group-labels.js";

export interface SidebarEntry {
  id: string;
  name: string;
  kind: "contact" | "group";
  status: Status | undefined; // 聯絡人才有
  memberCount: number | undefined; // 群組才有
  lastAt: number; // 最近互動時間（毫秒；無互動＝0）
  labels: string[];
  /** 對方廣播的企業頭銜（ADR-0158；聯絡人才有）——顯示為 chip--role，與私標色彩區隔。 */
  title?: string;
  /** 對方狀態訊息與正在聽（ADR-0214；聯絡人才有）——供統一列的情境切換副線。 */
  statusMessage?: string;
  nowPlaying?: string;
}

/** 某對話末則訊息的預覽文字（ADR-0214，經典/三欄共用）；檔案以 `📎 檔名` 佔位；無訊息回空字串。 */
export function messagePreview(id: string, convos: Record<string, ChatMessage[]>): string {
  const msgs = convos[id];
  if (!msgs || msgs.length === 0) return "";
  const last = msgs[msgs.length - 1]!;
  return last.file ? `📎 ${last.file.name}` : last.text;
}

/** 某對話的最近互動時間＝其訊息中最大時間戳；無訊息回 0。 */
export function lastInteraction(id: string, convos: Record<string, ChatMessage[]>): number {
  const msgs = convos[id];
  if (!msgs) return 0;
  let max = 0;
  for (const m of msgs) if (m.at > max) max = m.at;
  return max;
}

/** 聯絡人與群組合成單一清單（含最近互動時間與標籤）。 */
export function buildEntries(
  contacts: Contact[],
  groups: Group[],
  convos: Record<string, ChatMessage[]>,
  prefs: GroupPrefsMap,
): SidebarEntry[] {
  const c: SidebarEntry[] = contacts.map((x) => ({
    id: x.pubkey,
    name: contactLabel(x), // ADR-0148：本地暱稱恒優先（顯示、搜尋、排序皆用暱稱）
    kind: "contact",
    status: x.status,
    memberCount: undefined,
    lastAt: lastInteraction(x.pubkey, convos),
    labels: labelsOf(prefs, x.pubkey),
    ...(x.title ? { title: x.title } : {}), // ADR-0158：企業頭銜
    ...(x.statusMessage ? { statusMessage: x.statusMessage } : {}), // ADR-0214：狀態訊息上列
    ...(x.nowPlaying ? { nowPlaying: x.nowPlaying } : {}),
  }));
  const g: SidebarEntry[] = groups.map((x) => ({
    id: x.id,
    name: x.name,
    kind: "group",
    status: undefined,
    memberCount: x.members.length,
    lastAt: lastInteraction(x.id, convos),
    labels: labelsOf(prefs, x.id),
  }));
  return [...c, ...g];
}

/** 名稱或任一則訊息內容命中查詢（空查詢＝全中；大小寫不敏感）。 */
export function matchesQuery(entry: SidebarEntry, query: string, convos: Record<string, ChatMessage[]>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.name.toLowerCase().includes(q)) return true;
  const msgs = convos[entry.id];
  return !!msgs && msgs.some((m) => m.text?.toLowerCase().includes(q));
}

/** 依最近互動排序（新→舊）；無互動者殿後、同分依名稱。不改動輸入。 */
export function sortEntries(entries: SidebarEntry[]): SidebarEntry[] {
  return [...entries].sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name));
}

/** 篩選（標籤 → 查詢）後依最近互動排序。 */
export function visibleEntries(
  entries: SidebarEntry[],
  query: string,
  activeLabel: string | undefined,
  convos: Record<string, ChatMessage[]>,
): SidebarEntry[] {
  return sortEntries(
    entries.filter((e) => (!activeLabel || e.labels.includes(activeLabel)) && matchesQuery(e, query, convos)),
  );
}
