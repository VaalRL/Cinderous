// 三欄左側欄邏輯（ADR-0079 Q2）：聯絡人＋群組混合、依最近互動排序、
// 搜尋（名稱＋訊息內容）、自訂標籤篩選。純函式、可測。
import type { ChatMessage, Contact, Group, Status } from "@cinder/engine";
import { labelsOf, type GroupPrefsMap } from "./group-labels.js";

export interface SidebarEntry {
  id: string;
  name: string;
  kind: "contact" | "group";
  status: Status | undefined; // 聯絡人才有
  memberCount: number | undefined; // 群組才有
  lastAt: number; // 最近互動時間（毫秒；無互動＝0）
  labels: string[];
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
    name: x.name,
    kind: "contact",
    status: x.status,
    memberCount: undefined,
    lastAt: lastInteraction(x.pubkey, convos),
    labels: labelsOf(prefs, x.pubkey),
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
